import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import { describeError, isNotFound } from "@/lib/server/errors";
import { NO_STORE, textResponse } from "@/lib/server/http";
import { playableView } from "@/lib/server/playable-cache";
import { getConnection } from "@/lib/server/session";
import { storageFor } from "@/lib/server/storage";
import { thumbContentType, thumbId, thumbnailFor } from "@/lib/server/thumbs";
import { firstIssue, KeySchema } from "@/lib/server/validate";
import { openHref } from "@/lib/paths";
import { previewVersion, thumbKindOf } from "@/lib/previews";
import type { FileMeta } from "@/lib/types";
import { sourceUrl } from "../convert/source";

// The tile keeps its icon (tool missing, unreadable file, timeout). Not an error, so nothing is logged.
const noPreview = () => new Response(null, { status: 204, headers: NO_STORE });

// A URL carrying the object's current version names one thumbnail forever, so the browser never asks again.
const FOREVER = "private, max-age=31536000, immutable";
const UNPINNED = "private, max-age=300";

// GET /api/thumb?key=…&v=… → a 480 px JPEG (PNG for transparent images) of a video frame, PDF page or image,
// cached per object version; 204 for none; 304 for If-None-Match. An image the server can't scale
// redirects to its original, as tiles showed before.
// A video costs a few hundred KB of reads (a tail index: ~4 MB per hour); a PDF or image is read whole.
export async function GET(request: NextRequest) {
  const connection = await getConnection();
  if (!connection) return textResponse("Not connected", 401);

  const parsed = KeySchema.safeParse(request.nextUrl.searchParams.get("key") ?? "");
  if (!parsed.success) return textResponse(firstIssue(parsed.error), 400);
  const key = parsed.data;
  if (key.endsWith("/")) return textResponse("This is a folder, not a file.", 400);

  // HEAD even when the browser holds a copy: it is what checks this session may read the object.
  let meta: FileMeta;
  try {
    meta = await storageFor(connection).head(key);
  } catch (e) {
    if (isNotFound(e)) return textResponse("File not found. It may have been moved or deleted.", 404);
    const err = describeError(e);
    return textResponse(`${err.title}. ${err.message}`, err.status);
  }
  if (meta.kind !== "video" && meta.kind !== "pdf" && meta.kind !== "image") {
    return textResponse("Only videos, PDFs and images have thumbnails.", 415);
  }
  const kind = thumbKindOf(meta);
  if (!kind) return noPreview();

  const version = previewVersion(meta);
  const etag = `"${thumbId(connection.bucket, key, version)}"`;
  const cache = request.nextUrl.searchParams.get("v") === version ? FOREVER : UNPINNED;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cache } });
  }

  const file = await thumbnailFor({
    bucket: connection.bucket,
    key,
    version,
    kind,
    ext: meta.ext,
    source: () => sourceUrl(connection, key, request.nextUrl.origin),
    repaired: (source) => playableView(connection.bucket, key, version, source, meta.size),
    signal: request.signal,
  });
  // A few dozen KB; reading it whole means pruning can't cut a response short.
  const body = file ? await fs.readFile(file).catch(() => null) : null;
  const type = body ? thumbContentType(body) : null;
  if (!body || !type) {
    return kind === "image" ? new Response(null, { status: 302, headers: { Location: openHref(key), ...NO_STORE } }) : noPreview();
  }

  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Length": String(body.length), "Cache-Control": cache, ETag: etag },
  });
}
