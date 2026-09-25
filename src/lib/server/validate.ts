import "server-only";
import { z } from "zod";
import { normalizePrefix } from "@/lib/paths";

// S3 keys are at most 1024 bytes of UTF-8.
export const MAX_KEY_BYTES = 1024;

const withinKeyLimit = (s: string) => Buffer.byteLength(s, "utf8") <= MAX_KEY_BYTES;

export const KeySchema = z
  .string({ error: "Choose a file to open." })
  .min(1, "Choose a file to open.")
  .refine(withinKeyLimit, "File keys are at most 1024 bytes long.")
  .refine((k) => !k.includes("\u0000"), "File keys can’t contain NUL characters.");

export const PrefixSchema = z
  .string()
  .optional()
  .transform((p) => p ?? "")
  .refine(withinKeyLimit, "Folder paths are at most 1024 bytes long.")
  .refine((p) => !p.includes("\u0000"), "Folder paths can’t contain NUL characters.")
  .transform(normalizePrefix);

export const LIST_DEFAULT_LIMIT = 1000;
export const LIST_MAX_LIMIT = 5000;

function intParam(name: string, min: number, max: number, fallback: number) {
  return z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return fallback;
      const n = Number(v);
      if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${name} must be a whole number from ${min} to ${max}.` });
        return z.NEVER;
      }
      return n;
    });
}

export const LimitSchema = intParam("limit", 1, LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT);

// Cursors are signed base64url tokens made by the storage layer (see storage/cursor.ts).
export const CursorSchema = z
  .string()
  .optional()
  .transform((v) => v || null)
  .refine((v) => v === null || (v.length <= 4096 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)), "This page link is malformed.");

export const TEXT_CHUNK_DEFAULT = 512 * 1024;
export const TEXT_CHUNK_MAX = 4 * 1024 * 1024;

export const OffsetSchema = intParam("offset", 0, Number.MAX_SAFE_INTEGER, 0);
export const LengthSchema = intParam("length", 1, TEXT_CHUNK_MAX, TEXT_CHUNK_DEFAULT);

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "The request is invalid.";
}
