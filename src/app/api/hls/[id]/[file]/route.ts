import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { afterServe, fragmentRange, getStream, INIT_SEGMENT, PLAYLIST, playlistFor, segmentFile, segmentIndex, StreamError } from "@/lib/server/convert";
import { MAX_SEGMENT_BYTES, mseSegment } from "@/lib/server/fmp4";
import { readCapped } from "@/lib/server/http-reader";
import { log } from "@/lib/server/log";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";
import { getConnection } from "@/lib/server/session";
import { checkStreamAccess } from "@/lib/server/stream-access";
import { sourceUrl } from "../../../convert/source";

// Fragment URLs carry a tag of the file version and the rewrite format, so they can be cached.
const FRAGMENT_CACHE = "private, max-age=3600";
const hlog = log.child({ scope: "hls" });

const Params = z.object({ id: z.string().min(1).max(64), file: z.string().min(1).max(64) });

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

// GET /api/hls/:id/:file → a video's playlist or segments. The playlist covers the whole video;
// a segment that isn't converted yet is converted before the response starts.
export const GET = withRequestLog(async (request: NextRequest, ctx: RouteContext<"/api/hls/[id]/[file]">) => {
  const connection = await getConnection();
  if (!connection) return text("Not connected", 401);

  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return text("Not found", 404);
  const { id, file } = parsed.data;
  noteRequest({ stream: id, file });

  const stream = await getStream(id, connection.bucket);
  if (!stream) return text("Not found", 404);
  const access = await checkStreamAccess(connection, stream);
  if (!access.ok) return text(access.message, access.status);

  if (file === PLAYLIST) {
    return new Response(playlistFor(stream), {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }

  // Fragmented MP4: the segment is a byte range of the original file, fetched from S3 and passed through.
  const range = fragmentRange(stream, file);
  if (range) {
    if (file !== INIT_SEGMENT && range.size > MAX_SEGMENT_BYTES) {
      return text("This part of the video is too large to stream.", 422);
    }
    const source = await sourceUrl(connection, stream.key, request.nextUrl.origin);
    const upstream = await fetch(source, {
      headers: { Range: `bytes=${range.offset}-${range.offset + range.size - 1}` },
      cache: "no-store",
      signal: request.signal,
    }).catch((e: unknown) => {
      if (!request.signal.aborted) hlog.warn("fragment fetch failed", { stream: id, file, err: e });
      return null;
    });
    // Only a 206 carries exactly the requested bytes; a server ignoring Range would send the whole file.
    const length = Number(upstream?.headers.get("content-length") ?? range.size);
    if (!upstream || upstream.status !== 206 || !upstream.body || length > range.size) {
      if (upstream) hlog.warn("fragment upstream not 206", { stream: id, file, status: upstream.status, length, expected: range.size });
      await upstream?.body?.cancel();
      return text("Couldn’t read this part of the video from the bucket.", 502);
    }
    stream.lastRequest = Date.now();
    if (file === INIT_SEGMENT) {
      return new Response(upstream.body, {
        headers: { "Content-Type": "video/mp4", "Content-Length": String(range.size), "Cache-Control": FRAGMENT_CACHE },
      });
    }
    // Buffered, not piped: each moof may need rewriting before the browser will accept it.
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readCapped(upstream, range.size);
    } catch (e) {
      hlog.warn("fragment read failed", { stream: id, file, err: e });
      return text("Couldn’t read this part of the video from the bucket.", 502);
    }
    const body = mseSegment(bytes, range.offset);
    if (!body) {
      hlog.warn("fragment not MSE-safe", { stream: id, file, status: 422, offset: range.offset, size: range.size });
      return text("This part of the video is laid out in a way the browser can’t play.", 422);
    }
    return new Response(body, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(body.byteLength),
        "Cache-Control": FRAGMENT_CACHE,
      },
    });
  }

  const n = segmentIndex(file);
  if (n === null) return text("Not found", 404);

  let filePath: string;
  try {
    filePath = await segmentFile(stream, n, () => sourceUrl(connection, stream.key, request.nextUrl.origin), request.signal);
  } catch (e) {
    if (e instanceof StreamError) return text(e.message, e.status);
    hlog.error("segment failed", { stream: id, segment: n, err: e });
    return text("Couldn’t convert this part of the video.", 500);
  }

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return text("Not found", 404);
  afterServe(stream);
  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp2t",
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
    },
  });
}, { quiet: true });
