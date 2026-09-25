import "server-only";
import mime from "mime";

// Survives any file name (RFC 6266 / RFC 5987): an ASCII `filename` fallback plus `filename*=UTF-8''…`.
export function contentDisposition(type: "inline" | "attachment", filename: string): string {
  const clean = filename.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "download";
  const fallback = clean.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\%]/g, "_");
  if (fallback === clean) return `${type}; filename="${fallback}"`;
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/x-unknown"]);

// Types a browser would run as a page (and so could script the origin serving them).
const ACTIVE_TYPE = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-javascript|text\/xsl)\b/i;

export function isActiveContentType(type: string): boolean {
  return ACTIVE_TYPE.test(type.trim());
}

// S3 defaults to binary/octet-stream, which says nothing useful.
export function isGenericContentType(type: string | undefined | null): boolean {
  return GENERIC_TYPES.has((type ?? "").split(";")[0].trim().toLowerCase());
}

export function effectiveContentType(name: string, stored?: string | null): string | undefined {
  if (stored && !isGenericContentType(stored)) return stored;
  return mime.getType(name) ?? undefined;
}

// A valid `type/subtype[; params]` value with no header-breaking characters.
export function isSafeContentType(type: string): boolean {
  return type.length <= 200 && /^[\w.+-]+\/[\w.+-]+(\s*;\s*[\w.+-]+=[\w.+"-]+)*$/.test(type);
}

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

// For routes the browser navigates to directly.
export function textResponse(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE, ...headers },
  });
}

export type ByteRange = { start: number; end: number };

// RFC 9110 §14.1.2, single range only: null serves the whole file (no header, malformed, or multiple ranges).
// Like S3, any range on an empty file is unsatisfiable.
export function parseRange(header: string | null | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  if (m[1]) {
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : Number.POSITIVE_INFINITY;
    if (end < start) return null;
    if (start >= size) return "unsatisfiable";
    return { start, end: Math.min(end, size - 1) };
  }
  const suffix = Number(m[2]);
  if (suffix === 0 || size === 0) return "unsatisfiable";
  return { start: Math.max(0, size - suffix), end: size - 1 };
}

// Stops a browser from running a file served from this app's own origin as a page.
export const SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
