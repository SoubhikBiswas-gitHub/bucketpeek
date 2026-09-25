import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import mime from "mime";
import { baseName } from "@/lib/kinds";
import {
  contentDisposition,
  isActiveContentType,
  isSafeContentType,
  parseRange,
  SANDBOX_CSP,
  textResponse,
} from "@/lib/server/http";
import { mockRoot, safeMockPath, verifyMockLink } from "@/lib/server/storage/local";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";

// Serves LENS_MOCK_DIR the way S3 presigned URLs would: signed, expiring links, byte ranges for
// seeking, and 416 for any range on a 0-byte file.

// Reproduces S3 round trips: LENS_MOCK_LATENCY_MS for browsers (told apart by Sec-Fetch-Mode, which
// server-side clients don't send), LENS_MOCK_SERVER_LATENCY_MS for this server's own reads.
function mockLatency(request: Request): number {
  const fromBrowser = request.headers.has("sec-fetch-mode");
  const n = Number(fromBrowser ? process.env.LENS_MOCK_LATENCY_MS : process.env.LENS_MOCK_SERVER_LATENCY_MS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 0;
}

async function serve(request: Request, withBody: boolean): Promise<Response> {
  const root = mockRoot();
  if (!root) return textResponse("Not found", 404);
  const latency = mockLatency(request);
  if (latency) await new Promise((r) => setTimeout(r, latency));

  const link = verifyMockLink(new URL(request.url).searchParams);
  if (!link) return textResponse("This link is invalid or has expired.", 403);
  noteRequest({ key: link.key, range: request.headers.get("range") ?? undefined });

  let file: string;
  try {
    file = await safeMockPath(root, link.key);
  } catch (e) {
    return (e as Error).name === "AccessDenied" ? textResponse("Forbidden", 403) : textResponse("Not found", 404);
  }
  const st = await fs.stat(file).catch(() => null);
  if (!st?.isFile()) return textResponse("Not found", 404);

  const name = baseName(link.key);
  const type = (link.type && isSafeContentType(link.type) ? link.type : mime.getType(name)) || "application/octet-stream";
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const lastModified = st.mtime.toUTCString();
  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Content-Disposition": contentDisposition(link.download ? "attachment" : "inline", name),
    "Last-Modified": lastModified,
    ETag: etag,
    "Cache-Control": "private, max-age=300",
  });
  // This route shares the app's origin, so HTML/SVG/XML must not run as a page here.
  if (isActiveContentType(type)) headers.set("Content-Security-Policy", SANDBOX_CSP);

  const ifRange = request.headers.get("if-range");
  const rangeHeader = ifRange && ifRange !== etag && ifRange !== lastModified ? null : request.headers.get("range");
  const range = parseRange(rangeHeader, st.size);

  if (!range && request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${st.size}`, "Cache-Control": "private, no-store" },
    });
  }

  const { start, end } = range ?? { start: 0, end: st.size - 1 };
  const length = st.size === 0 ? 0 : end - start + 1;
  headers.set("Content-Length", String(length));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${st.size}`);

  const body = withBody && length > 0 ? (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream) : null;
  return new Response(body, { status: range ? 206 : 200, headers });
}

export const GET = withRequestLog((request: Request) => serve(request, true), { quiet: true });

export const HEAD = withRequestLog((request: Request) => serve(request, false), { quiet: true });
