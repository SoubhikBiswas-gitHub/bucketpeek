import "server-only";
import mime from "mime";
import { describeError, isNotFound } from "@/lib/server/errors";
import { isActiveContentType, isGenericContentType, NO_STORE, textResponse } from "@/lib/server/http";
import { noteRequest } from "@/lib/server/request-log";
import { getConnection } from "@/lib/server/session";
import { storageFor } from "@/lib/server/storage";
import type { SignedUrlOptions } from "@/lib/server/storage/types";
import { firstIssue, KeySchema } from "@/lib/server/validate";
import type { FileMeta } from "@/lib/types";

/** Inline links back media elements, which keep re-requesting ranges while playing. */
const OPEN_SECONDS = 3600;
/** A download starts right away, so its link can be much shorter. */
const DOWNLOAD_SECONDS = 900;
// Big downloads run for hours, and the browser resumes a dropped one with the same link.
const BIG_DOWNLOAD_BYTES = 5e9;
const BIG_DOWNLOAD_SECONDS = 12 * 3600;

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...NO_STORE } });
}

/**
 * The Content-Type to serve a file inline with. A stored type wins; a generic one
 * (binary/octet-stream) is replaced by a guess from the name, except that page-like
 * types (HTML, XML, scripts) are shown as text rather than run.
 */
function inlineType(file: FileMeta): string | undefined {
  if (!isGenericContentType(file.contentType)) return file.contentType;
  const guess = mime.getType(file.name);
  if (!guess) return undefined;
  return isActiveContentType(guess) && guess !== "image/svg+xml" ? "text/plain; charset=utf-8" : guess;
}

/**
 * GET /api/files/{open,download}?key=… redirects to a short-lived presigned URL.
 * These are browser navigations and `<img src>`s, so failures are small plain-text pages.
 */
export async function fileRedirect(request: Request, mode: "open" | "download"): Promise<Response> {
  const connection = await getConnection();
  if (!connection) return redirectTo("/setup");

  const parsed = KeySchema.safeParse(new URL(request.url).searchParams.get("key") ?? "");
  if (!parsed.success) return textResponse(firstIssue(parsed.error), 400);
  const key = parsed.data;
  if (key.endsWith("/")) return textResponse("This is a folder, not a file.", 400);
  noteRequest({ key });

  const storage = storageFor(connection);
  let file: FileMeta;
  try {
    // Check first: a presigned URL to a missing key lands on an XML error page from S3.
    file = await storage.head(key);
  } catch (e) {
    noteRequest({ err: e });
    if (isNotFound(e)) return textResponse("File not found. It may have been moved or deleted.", 404);
    const err = describeError(e);
    return textResponse(`${err.title}. ${err.message}`, err.status);
  }

  const options: SignedUrlOptions =
    mode === "download"
      ? { download: true, expiresIn: file.size > BIG_DOWNLOAD_BYTES ? BIG_DOWNLOAD_SECONDS : DOWNLOAD_SECONDS }
      : { contentType: inlineType(file), expiresIn: OPEN_SECONDS };

  noteRequest({ size: file.size, expiresIn: options.expiresIn });
  try {
    return redirectTo(await storage.signedUrl(key, options));
  } catch (e) {
    noteRequest({ err: e });
    const err = describeError(e);
    return textResponse(`${err.title}. ${err.message}`, err.status);
  }
}
