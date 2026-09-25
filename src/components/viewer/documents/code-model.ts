// Shared by the server highlighter and the client renderers, so these shapes must stay serializable.

// `style` indexes `CodeTokens.styles`; -1 is the default color.
export type CodeToken = [text: string, style: number];

export interface CodeStyle {
  color?: string;
  italic?: boolean;
  bold?: boolean;
}

export interface CodeTokens {
  styles: CodeStyle[];
  lines: CodeToken[][];
}

export type PlainReason = "large" | "unsupported";

export interface CodeData {
  tokens: CodeTokens | null;
  // Normalized newlines, no trailing newline. Null when `tokens` is set.
  text: string | null;
  lineCount: number;
  // Tabs count as 4; sizes the horizontal scroll area.
  maxLineLength: number;
  langLabel: string;
  // Null when highlighted, or when the file has no language.
  plainReason: PlainReason | null;
  log: boolean;
  // Prose-like text (plain text, logs, very long lines) starts wrapped; code starts unwrapped.
  wrapDefault: boolean;
}

// Highlighting above these limits would slow the page more than it helps.
export const HIGHLIGHT_MAX_CHARS = 150_000;
export const HIGHLIGHT_MAX_LINES = 5_000;
export const VIRTUALIZE_AT_LINES = 2_000;
export const TAB_WIDTH = 4;

export function normalizeNewlines(text: string): string {
  const t = text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
  return t.endsWith("\n") ? t.slice(0, -1) : t;
}

export function splitLines(text: string): string[] {
  return text.split("\n");
}

export function visualLength(line: string): number {
  let n = line.length;
  for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) === 9) n += TAB_WIDTH - 1;
  return n;
}

export function measureLines(lines: string[]): number {
  let max = 0;
  for (const l of lines) {
    // Cheap upper bound first; only count tabs on lines that could win.
    if (l.length * TAB_WIDTH <= max) continue;
    const len = visualLength(l);
    if (len > max) max = len;
  }
  return max;
}

export function lineTextOf(line: CodeToken[]): string {
  let s = "";
  for (const t of line) s += t[0];
  return s;
}

export function codeText(data: CodeData): string {
  if (data.text !== null) return data.text;
  return (data.tokens?.lines ?? []).map(lineTextOf).join("\n");
}

export type LogLevel = "error" | "warn";

// Upper-case level words, plus structured forms like level=error or "level":"warn".
const ERROR_WORD = /\b(ERROR|ERR|FATAL|CRITICAL|CRIT|PANIC)\b|^Traceback\b/;
const WARN_WORD = /\b(WARN|WARNING)\b/;
const ERROR_FIELD = /\blevel"?\s*[=:]\s*"?(error|fatal|critical)\b/i;
const WARN_FIELD = /\blevel"?\s*[=:]\s*"?(warn|warning)\b/i;

export function logLevelOf(line: string): LogLevel | null {
  // Only look at the start of very long lines: levels live in the prefix.
  const head = line.length > 400 ? line.slice(0, 400) : line;
  if (ERROR_WORD.test(head) || ERROR_FIELD.test(head)) return "error";
  if (WARN_WORD.test(head) || WARN_FIELD.test(head)) return "warn";
  return null;
}

// Indexes match `logSegments`.
export const LOG_STYLES: CodeStyle[] = [
  { color: "var(--syntax-muted)" },
  { color: "var(--syntax-error)", bold: true },
  { color: "var(--syntax-warning)" },
  { color: "var(--syntax-info)" },
  { color: "var(--syntax-muted)" },
];

const LOG_PREFIX = /^(\[?\d{4}-\d{2}-\d{2}[T ][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?\]?|\[?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?)?(\s*)/;
const LOG_LEVEL = /\b(FATAL|CRITICAL|CRIT|PANIC|ERROR|ERR|WARNING|WARN|INFO|NOTICE|DEBUG|TRACE)\b/;
const LEVEL_STYLE: Record<string, number> = {
  FATAL: 1, CRITICAL: 1, CRIT: 1, PANIC: 1, ERROR: 1, ERR: 1,
  WARNING: 2, WARN: 2,
  INFO: 3, NOTICE: 3,
  DEBUG: 4, TRACE: 4,
};

// Cheap log coloring for files too large for Shiki.
export function logSegments(line: string): CodeToken[] {
  const out: CodeToken[] = [];
  const pre = LOG_PREFIX.exec(line);
  let rest = line;
  if (pre && pre[1]) {
    out.push([pre[1], 0]);
    if (pre[2]) out.push([pre[2], -1]);
    rest = line.slice(pre[0].length);
  }
  const head = rest.length > 200 ? rest.slice(0, 200) : rest;
  const m = LOG_LEVEL.exec(head);
  if (!m) {
    out.push([rest, -1]);
    return out;
  }
  if (m.index) out.push([rest.slice(0, m.index), -1]);
  out.push([m[0], LEVEL_STYLE[m[0]]]);
  out.push([rest.slice(m.index + m[0].length), -1]);
  return out;
}

export function plainCodeData(raw: string, base: CodeData): CodeData {
  const text = normalizeNewlines(raw);
  const lines = splitLines(text);
  return {
    ...base,
    tokens: null,
    text,
    lineCount: text.length ? lines.length : 0,
    maxLineLength: measureLines(lines),
    plainReason: base.plainReason ?? (base.tokens ? "large" : null),
  };
}
