import { DETAIL_PARTS, type DetailPart } from "@/lib/file-details";
import { describeError, isNotFound } from "@/lib/server/errors";
import { NO_STORE } from "@/lib/server/http";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";
import { getConnection } from "@/lib/server/session";
import { firstIssue, KeySchema } from "@/lib/server/validate";
import type { AppError } from "@/lib/types";
import { loadPart } from "./parts";

function errorJson(error: AppError): Response {
  return Response.json({ error }, { status: error.status, headers: NO_STORE });
}

// GET /api/files/details?key=…&part=s3|video|health|sidecar → { data } for that part, or { error }.
// One request per part, so the sheet shows S3 facts while ffprobe is still reading the video.
export const GET = withRequestLog(async (request: Request) => {
  const connection = await getConnection();
  if (!connection) {
    return errorJson({ title: "Not connected", message: "Your session ended. Connect to the bucket again.", status: 401 });
  }

  const url = new URL(request.url);
  const key = KeySchema.safeParse(url.searchParams.get("key") ?? "");
  if (!key.success) return errorJson({ title: "No file selected", message: firstIssue(key.error), status: 400 });
  if (key.data.endsWith("/")) return errorJson({ title: "This is a folder", message: "Choose a file.", status: 400 });
  const part = url.searchParams.get("part") ?? "";
  if (!(DETAIL_PARTS as readonly string[]).includes(part)) {
    return errorJson({ title: "Unknown part", message: `part must be one of ${DETAIL_PARTS.join(", ")}.`, status: 400 });
  }

  noteRequest({ key: key.data, part });
  try {
    return Response.json({ data: await loadPart(part as DetailPart, connection, key.data, url.origin) }, { headers: NO_STORE });
  } catch (e) {
    if (isNotFound(e)) {
      return errorJson({ title: "File not found", message: "This file isn’t in the bucket anymore. It may have been moved or deleted.", status: 404 });
    }
    noteRequest({ err: e });
    return errorJson(describeError(e));
  }
});
