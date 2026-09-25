import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log";

// Development without SECRET_KEY uses a random secret saved to a private file, so sessions survive
// restarts. Production without it uses a random per-process secret. Never log the secret itself.

export const MIN_SECRET_LENGTH = 32;

const g = globalThis as unknown as { __lensSecret?: { random?: string; dev?: string; warned?: boolean } };
// Kept on globalThis so dev hot reloads don't mint a new random secret.
const processState = () => (g.__lensSecret ??= {});
const slog = log.child({ scope: "secret" });

function warnOnce(message: string): void {
  const state = processState();
  if (state.warned) return;
  state.warned = true;
  slog.warn(message);
}

export function devSecretFile(): string {
  return process.env.LENS_SECRET_FILE ? path.resolve(process.env.LENS_SECRET_FILE) : path.join(process.cwd(), ".lens", "secret");
}

function ownedByMe(st: fs.Stats): boolean {
  const uid = process.getuid?.();
  return uid === undefined || st.uid === uid;
}

function readDevSecret(file: string): string | null {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch {
    return null;
  }
  // Another user who can read or replace the file could forge every session.
  if (!st.isFile() || !ownedByMe(st) || (process.platform !== "win32" && (st.mode & 0o077) !== 0)) {
    throw new Error(`${file} must be a file owned by this user with mode 0600. Delete it to create a new one.`);
  }
  const secret = fs.readFileSync(file, "utf8").trim();
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function devSecret(): string {
  const file = devSecretFile();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || !ownedByMe(st)) throw new Error(`${dir} isn't a directory owned by this user.`);
  const existing = readDevSecret(file);
  if (existing) return existing;
  const secret = randomBytes(32).toString("base64url");
  try {
    fs.writeFileSync(file, secret, { mode: 0o600, flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    // Another process created it first (use theirs), or it holds too short a secret (replace it).
    const theirs = readDevSecret(file);
    if (theirs) return theirs;
    fs.writeFileSync(file, secret, { mode: 0o600 });
  }
  return secret;
}

export function appSecret(): string {
  const secret = process.env.SECRET_KEY;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (secret) warnOnce(`SECRET_KEY is shorter than ${MIN_SECRET_LENGTH} characters and was ignored.`);

  const state = processState();
  if (process.env.NODE_ENV === "production") {
    state.random ??= randomBytes(32).toString("base64url");
    warnOnce("SECRET_KEY is not set. Using a random secret, so everyone is signed out when the server restarts.");
    return state.random;
  }
  state.dev ??= devSecret();
  return state.dev;
}

export function sign(purpose: string, data: string): string {
  const key = createHmac("sha256", appSecret()).update(purpose).digest();
  return createHmac("sha256", key).update(data).digest("base64url");
}

export function verifySignature(purpose: string, data: string, signature: string): boolean {
  const expected = Buffer.from(sign(purpose, data));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
