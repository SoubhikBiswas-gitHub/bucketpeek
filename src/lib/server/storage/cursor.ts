import "server-only";
import { sign, verifySignature } from "@/lib/server/secret";

/**
 * Listing cursors are opaque to clients: the backend's own position (an S3 continuation
 * token, or the last key a local listing returned) bound to its prefix and signed, so a
 * tampered cursor or one reused for another folder is rejected instead of misbehaving.
 */

const PURPOSE = "list-cursor";
export const MAX_CURSOR_LENGTH = 4096;

export function invalidCursor(): Error {
  return Object.assign(new Error("Invalid list cursor"), { name: "InvalidCursor", $metadata: { httpStatusCode: 400 } });
}

export function encodeCursor(prefix: string, position: string): string {
  const payload = Buffer.from(JSON.stringify([prefix, position]), "utf8").toString("base64url");
  return `${payload}.${sign(PURPOSE, payload)}`;
}

/** The position inside a cursor made by `encodeCursor` for this prefix. Throws InvalidCursor otherwise. */
export function decodeCursor(prefix: string, cursor: string): string {
  if (cursor.length > MAX_CURSOR_LENGTH) throw invalidCursor();
  const dot = cursor.indexOf(".");
  const payload = cursor.slice(0, dot);
  if (dot <= 0 || !verifySignature(PURPOSE, payload, cursor.slice(dot + 1))) throw invalidCursor();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== prefix || typeof parsed[1] !== "string" || !parsed[1]) {
    throw invalidCursor();
  }
  return parsed[1];
}
