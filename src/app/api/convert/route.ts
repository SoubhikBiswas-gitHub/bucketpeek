import type { NextRequest } from "next/server";
import { playableUrl, playableView } from "@/lib/server/playable-cache";
import { z } from "zod";
import { ffmpegAvailable, openStream, PLAYLIST, StreamError } from "@/lib/server/convert";
import { describeError, isNotFound } from "@/lib/server/errors";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";
import { getConnection } from "@/lib/server/session";
import { storageFor } from "@/lib/server/storage";
import type { ConvertJob } from "@/lib/types";
import { errorJson, NOT_CONNECTED } from "./respond";
import { sourceUrl } from "./source";

const Query = z.object({
  key: z
    .string()
    .min(1, "A file key is required.")
    .max(1024, "S3 keys are at most 1024 bytes.")
    .refine((k) => !k.endsWith("/"), "This key is a folder, not a file."),
});

// POST /api/convert?key=… prepares a video for on-demand streaming and returns its playlist.
// Only the video's length is read here; segments are converted as the player requests them.
export const POST = withRequestLog(async (request: NextRequest) => {
  const connection = await getConnection();
  if (!connection) return errorJson(NOT_CONNECTED, 401);

  const parsed = Query.safeParse({ key: request.nextUrl.searchParams.get("key") ?? "" });
  if (!parsed.success) {
    return errorJson({ title: "Invalid file", message: parsed.error.issues[0]?.message ?? "Invalid key." }, 400);
  }
  const { key } = parsed.data;
  noteRequest({ key });

  if (!(await ffmpegAvailable())) {
    return errorJson(
      {
        title: "Conversion isn’t available",
        message: "ffmpeg isn’t installed on the machine running Deccan Lens. Install it (brew install ffmpeg) and restart the app.",
      },
      501,
    );
  }

  let version: string;
  let size: number;
  try {
    // Fail fast with a clear message instead of letting ffprobe report an HTTP error.
    const meta = await storageFor(connection).head(key);
    if (meta.kind !== "video") {
      return errorJson({ title: "Not a video", message: "Only video files can be converted for playback." }, 415);
    }
    version = `${meta.size}:${meta.modified ?? ""}`;
    size = meta.size;
  } catch (e) {
    if (isNotFound(e)) {
      return errorJson({ title: "File not found", message: "This file isn’t in the bucket anymore. It may have been moved or deleted." }, 404);
    }
    const err = describeError(e);
    noteRequest({ err: e });
    return errorJson(err, err.status);
  }

  try {
    const source = await sourceUrl(connection, key, request.nextUrl.origin);
    // An MP4 the browser couldn't play because of its layout or a damaged index plays fixed, from
    // this app, without converting (ffmpeg would fail on a damaged index too).
    if (/\.(mp4|m4v|mov)$/i.test(key)) {
      const view = await playableView(connection.bucket, key, version, source, size);
      if (view) {
        noteRequest({ mode: "fixed" });
        const job: ConvertJob = { id: "", playlist: "", duration: 0, direct: playableUrl(key) };
        return Response.json(job, { headers: { "Cache-Control": "no-store" } });
      }
    }
    const s = await openStream({ bucket: connection.bucket, key, version, source, size });
    noteRequest({ mode: "stream", stream: s.id, duration: s.duration });
    const job: ConvertJob = { id: s.id, playlist: `/api/hls/${s.id}/${PLAYLIST}`, duration: s.duration };
    return Response.json(job, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof Error && e.name === "FfmpegMissing") {
      return errorJson({ title: "Conversion isn’t available", message: "ffmpeg isn’t installed on this machine." }, 501);
    }
    if (e instanceof StreamError) return errorJson({ title: "This video can’t be streamed", message: e.message }, e.status);
    const err = describeError(e);
    noteRequest({ err: e });
    return errorJson({ title: "Couldn’t prepare the video", message: err.message, detail: err.detail }, 500);
  }
});
