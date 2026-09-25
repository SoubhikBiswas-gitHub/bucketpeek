import type { NextRequest } from "next/server";
import { describeError } from "@/lib/server/errors";
import { textResponse } from "@/lib/server/http";
import { virtualRange, type VirtualMp4 } from "@/lib/server/playable";
import { log } from "@/lib/server/log";
import { playableView } from "@/lib/server/playable-cache";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";
import { getConnection } from "@/lib/server/session";
import { storageFor } from "@/lib/server/storage";
import { KeySchema } from "@/lib/server/validate";
import { sourceUrl } from "../../convert/source";

// "bytes=a-b", "bytes=a-" or "bytes=-n" → inclusive [start, end]; null when there is no header.
function parseRange(header: string | null, size: number): [number, number] | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? [start, end] : "invalid";
}

// GET /api/files/playable?key=… → an MP4 fixed on the fly (see playable.ts), with byte ranges;
// 422 when it doesn't need or can't take fixing, 416 for a bad range. The bucket is never changed.
export const GET = withRequestLog(async (request: NextRequest) => {
  const connection = await getConnection();
  if (!connection) return textResponse("Not connected", 401);
  const parsed = KeySchema.safeParse(request.nextUrl.searchParams.get("key") ?? "");
  if (!parsed.success) return textResponse("Not found", 404);
  const key = parsed.data;
  noteRequest({ key, range: request.headers.get("range") ?? undefined });

  let fast: VirtualMp4 | null;
  let source: string;
  try {
    const meta = await storageFor(connection).head(key);
    source = await sourceUrl(connection, key, request.nextUrl.origin);
    fast = await playableView(connection.bucket, key, `${meta.size}:${meta.modified ?? ""}`, source, meta.size);
  } catch (e) {
    noteRequest({ err: e });
    const err = describeError(e);
    return textResponse(err.message, err.status);
  }
  if (!fast) return textResponse("This video doesn’t need fixing, or can’t be fixed safely.", 422);

  const range = parseRange(request.headers.get("range"), fast.size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fast.size}` } });
  }
  const [start, end] = range ?? [0, fast.size - 1];
  const parts = virtualRange(fast, start, end);

  const upstream = new AbortController();
  request.signal.addEventListener("abort", () => upstream.abort());
  // Pull-based: the bucket is read only as fast as the browser takes bytes, and not at all past
  // what it asked for once it cancels (players cancel open-ended ranges all the time).
  let i = 0;
  let current: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          if (current) {
            const { done, value } = await current.read();
            if (!done) {
              controller.enqueue(value);
              return;
            }
            current = null;
          }
          const part = parts[i++];
          if (!part) {
            controller.close();
            return;
          }
          if ("bytes" in part) {
            controller.enqueue(part.bytes);
            return;
          }
          const [a, b] = part.file;
          const res = await fetch(source, { headers: { Range: `bytes=${a}-${b}` }, cache: "no-store", signal: upstream.signal });
          if (res.status !== 206 || !res.body) throw new Error(`The bucket answered ${res.status}.`);
          current = res.body.getReader();
        }
      } catch (e) {
        if (upstream.signal.aborted) return;
        log.warn("playable stream failed", { scope: "playable", key, start, end, err: e });
        controller.error(e);
      }
    },
    cancel() {
      upstream.abort();
      void current?.cancel().catch(() => {});
    },
  });

  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${fast.size}` } : {}),
      "Cache-Control": "no-store",
    },
  });
}, { quiet: true });
