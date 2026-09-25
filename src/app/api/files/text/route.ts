import { describeError, isNotFound } from "@/lib/server/errors";
import { NO_STORE } from "@/lib/server/http";
import { getConnection } from "@/lib/server/session";
import { storageFor } from "@/lib/server/storage";
import { readTextChunk } from "@/lib/server/text-chunk";
import { firstIssue, KeySchema, LengthSchema, OffsetSchema } from "@/lib/server/validate";
import type { AppError, TextChunk } from "@/lib/types";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";

function errorJson(error: AppError): Response {
  return Response.json({ error }, { status: error.status, headers: NO_STORE });
}

// GET /api/files/text?key=&offset=0&length=(512 KB, max 4 MB) → `TextChunk`, never splitting a UTF-8
// character (may run 3 bytes over); `nextOffset` is null at the end. 400 bad input, 401, 404.
// With `v` (tiles) the answer is cached by the browser.
export const GET = withRequestLog(async (request: Request) => {
  const connection = await getConnection();
  if (!connection) {
    return errorJson({ title: "Not connected", message: "Your session ended. Connect to the bucket again to keep reading.", status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const key = KeySchema.safeParse(params.get("key") ?? "");
  const offset = OffsetSchema.safeParse(params.get("offset") ?? undefined);
  const length = LengthSchema.safeParse(params.get("length") ?? undefined);
  if (!key.success) return errorJson({ title: "No file selected", message: firstIssue(key.error), status: 400 });
  if (key.data.endsWith("/")) return errorJson({ title: "This is a folder", message: "Choose a file to read.", status: 400 });
  if (!offset.success) return errorJson({ title: "Invalid offset", message: firstIssue(offset.error), status: 400 });
  if (!length.success) return errorJson({ title: "Invalid length", message: firstIssue(length.error), status: 400 });

  try {
    const chunk: TextChunk = await readTextChunk(storageFor(connection), key.data, offset.data, length.data);
    noteRequest({ key: key.data, offset: offset.data, chars: chunk.text.length });
    // Tiles pass the object version (size and modified time) as `v`, which a changed file never keeps.
    const pinned = params.has("v") ? { "Cache-Control": "private, max-age=31536000, immutable" } : NO_STORE;
    return Response.json(chunk, { headers: pinned });
  } catch (e) {
    noteRequest({ key: key.data, err: e });
    if (isNotFound(e)) {
      return errorJson({ title: "File not found", message: "This file isn’t in the bucket anymore. It may have been moved or deleted.", status: 404 });
    }
    return errorJson(describeError(e));
  }
});
