import "server-only";
import { createHash } from "node:crypto";
import type { Connection } from "@/lib/types";
import { describeError, isNotFound } from "./errors";
import { storageFor } from "./storage";

// A stream id is derived from bucket and key, so anyone who can guess a key can name its stream.
// Cached segments are served only to credentials that can read that version of the object now.

const ALLOW_MS = 60_000;
const MAX_ENTRIES = 5000;

const g = globalThis as unknown as { __lensStreamAccess?: Map<string, number> };
const allowed = (g.__lensStreamAccess ??= new Map());

export type StreamAccess = { ok: true } | { ok: false; status: number; message: string };

const credentialsOf = (c: Connection) =>
  createHash("sha256").update(`${c.accessKeyId}\n${c.secretAccessKey}\n${c.region}\n${c.bucket}`).digest("hex");

export async function checkStreamAccess(c: Connection, stream: { id: string; key: string; version: string }, now = Date.now()): Promise<StreamAccess> {
  const entry = `${credentialsOf(c)}\n${stream.id}\n${stream.version}`;
  const until = allowed.get(entry);
  if (until !== undefined && until > now) return { ok: true };
  allowed.delete(entry);

  let version: string;
  try {
    const meta = await storageFor(c).head(stream.key);
    version = `${meta.size}:${meta.modified ?? ""}`;
  } catch (e) {
    const err = describeError(e);
    if (isNotFound(e) || err.status === 403 || err.status === 401) return { ok: false, status: 404, message: "Not found" };
    return { ok: false, status: err.status >= 500 ? err.status : 502, message: err.message };
  }
  // The object changed since it was converted: these segments aren't of the file the caller can read.
  if (version !== stream.version) return { ok: false, status: 404, message: "Not found" };

  if (allowed.size >= MAX_ENTRIES) allowed.delete(allowed.keys().next().value!);
  allowed.set(entry, now + ALLOW_MS);
  return { ok: true };
}

export function forgetStreamAccess(): void {
  allowed.clear();
}
