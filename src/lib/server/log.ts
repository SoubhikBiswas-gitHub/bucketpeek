import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { errorCode, httpStatus, redact } from "./errors";

// Structured server logs. One JSON object per line in production, one readable line in development.
// Every value passes through `clean`: secrets by field name are dropped, strings go through `redact`.

export type Level = "debug" | "info" | "warn" | "error";
// `silent` turns logging off (the unit tests run with it).
export type Threshold = Level | "silent";
export type Fields = Record<string, unknown>;

const RANK: Record<Threshold, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface Timer {
  // Logs `msg` with `ms` (and `fields`) at the timer's level, or at `level`; returns the milliseconds.
  (fields?: Fields, level?: Level): number;
  elapsed(): number;
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  log(level: Level, msg: string, fields?: Fields): void;
  enabled(level: Level): boolean;
  child(fields: Fields & { scope?: string }): Logger;
  time(msg: string, fields?: Fields, level?: Level): Timer;
}

interface Config {
  level?: Threshold;
  format?: "json" | "pretty";
  sink?: (line: string, level: Level) => void;
}

// Survives dev hot reloads, so a test's or an earlier module instance's settings aren't split.
const g = globalThis as unknown as { __lensLog?: { config: Config; context: AsyncLocalStorage<Fields> } };
const shared = (g.__lensLog ??= { config: {}, context: new AsyncLocalStorage<Fields>() });

// For tests: override the level, the format and where lines go. `{}` restores the defaults.
export function configureLog(config: Config): void {
  shared.config = config;
}

function isThreshold(v: unknown): v is Threshold {
  return typeof v === "string" && Object.hasOwn(RANK, v);
}

export function currentLevel(): Threshold {
  if (shared.config.level) return shared.config.level;
  const env = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (isThreshold(env)) return env;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function format(): "json" | "pretty" {
  return shared.config.format ?? (process.env.NODE_ENV === "production" ? "json" : "pretty");
}

// Runs `fn` with `fields` (a request id, say) added to every line logged inside it, across awaits.
export function withLogContext<T>(fields: Fields, fn: () => T): T {
  return shared.context.run({ ...shared.context.getStore(), ...fields }, fn);
}

export function logContext(): Fields | undefined {
  return shared.context.getStore();
}

// Field names whose values are never logged, whatever they hold.
const SECRET_FIELD = /secret|passw|token|^cookies?$|set-?cookie|authori[sz]ation|credential|signature|^sig$|access.?key|session|api.?key/i;
const MAX_DEPTH = 4;
const MAX_ITEMS = 20;

function cleanError(e: Error, depth: number): Fields {
  const meta = (e as { $metadata?: { requestId?: string; extendedRequestId?: string; attempts?: number } }).$metadata;
  const out: Fields = { name: e.name, message: redact(e.message) };
  const code = errorCode(e);
  if (code && code !== e.name) out.code = code;
  const status = httpStatus(e);
  if (status !== undefined) out.status = status;
  if (meta?.requestId) out.awsRequestId = redact(meta.requestId);
  if (meta?.extendedRequestId) out.awsId2 = redact(meta.extendedRequestId);
  if (meta?.attempts && meta.attempts > 1) out.attempts = meta.attempts;
  if (e.stack && !code) out.stack = redact(e.stack.split("\n").slice(1, 6).map((l) => l.trim()).join(" | "));
  if (e.cause !== undefined && e.cause !== e && depth < MAX_DEPTH) out.cause = clean(e.cause, depth + 1);
  return out;
}

// A copy that's safe to print: no secret-named fields, no presigned query strings, no headers.
export function clean(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "string":
      return redact(value);
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
    case "symbol":
      return undefined;
  }
  if (value instanceof Error) return cleanError(value, depth);
  if (value instanceof URL) return redact(value.toString());
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  // Headers and requests carry cookies and auth; they're never logged whole.
  if (typeof Headers !== "undefined" && value instanceof Headers) return "[headers]";
  if (typeof Request !== "undefined" && value instanceof Request) return "[request]";
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[${value.byteLength} bytes]`;
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => clean(v, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`…${value.length - MAX_ITEMS} more`);
    return items;
  }
  const out: Fields = {};
  for (const [k, v] of Object.entries(value as Fields)) {
    if (k === "headers") out[k] = "[headers]";
    else if (SECRET_FIELD.test(k)) out[k] = "[redacted]";
    else {
      const c = clean(v, depth + 1);
      if (c !== undefined) out[k] = c;
    }
  }
  return out;
}

function pretty(v: unknown): string {
  if (typeof v === "string") return /[\s"=]/.test(v) || v === "" ? JSON.stringify(v) : v;
  if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
  return JSON.stringify(v);
}

function line(level: Level, msg: string, fields: Fields): string {
  const time = new Date().toISOString();
  const { scope, ...rest } = fields;
  if (format() === "json") {
    return JSON.stringify({ time, level, msg, ...(scope !== undefined ? { scope } : {}), ...rest });
  }
  const tail = Object.entries(rest)
    .map(([k, v]) => `${k}=${pretty(v)}`)
    .join(" ");
  const where = scope !== undefined ? `[${String(scope)}] ` : "";
  return `${time.slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${where}${msg}${tail ? `  ${tail}` : ""}`;
}

function defaultSink(text: string, level: Level): void {
  // stderr for problems, so a supervisor that splits the streams still sees them apart.
  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  stream.write(`${text}\n`);
}

function emit(level: Level, msg: string, base: Fields, fields?: Fields): void {
  if (RANK[level] < RANK[currentLevel()]) return;
  try {
    const merged = clean({ ...base, ...shared.context.getStore(), ...fields }) as Fields;
    (shared.config.sink ?? defaultSink)(line(level, redact(msg), merged), level);
  } catch {
    // Logging must never break the request it describes.
  }
}

function make(base: Fields): Logger {
  const logger: Logger = {
    debug: (msg, fields) => emit("debug", msg, base, fields),
    info: (msg, fields) => emit("info", msg, base, fields),
    warn: (msg, fields) => emit("warn", msg, base, fields),
    error: (msg, fields) => emit("error", msg, base, fields),
    log: (level, msg, fields) => emit(level, msg, base, fields),
    enabled: (level) => RANK[level] >= RANK[currentLevel()],
    child: (fields) => make({ ...base, ...fields }),
    time(msg, fields, level = "info") {
      const start = performance.now();
      const elapsed = () => Math.round(performance.now() - start);
      const done = ((more?: Fields, at?: Level) => {
        const ms = elapsed();
        emit(at ?? level, msg, base, { ...fields, ...more, ms });
        return ms;
      }) as Timer;
      done.elapsed = elapsed;
      return done;
    },
  };
  return logger;
}

export const log: Logger = make({});
