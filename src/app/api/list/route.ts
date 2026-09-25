import { describeError } from "@/lib/server/errors";
import { NO_STORE } from "@/lib/server/http";
import { getConnection } from "@/lib/server/session";
import { storageFor } from "@/lib/server/storage";
import { CursorSchema, firstIssue, LimitSchema, PrefixSchema } from "@/lib/server/validate";
import type { AppError, Listing } from "@/lib/types";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";

const NOT_CONNECTED: AppError = {
  title: "Not connected",
  message: "Your session ended. Connect to the bucket again to keep browsing.",
  status: 401,
};

function errorJson(error: AppError): Response {
  return Response.json({ error }, { status: error.status, headers: NO_STORE });
}

// GET /api/list?prefix=&limit=&cursor= → one page of `Listing`; `limit` (1–5000, default 1000) counts
// folders + files. Pass `nextCursor` back as `cursor`; a foreign cursor is 400, no session is 401.
export const GET = withRequestLog(async (request: Request) => {
  const connection = await getConnection();
  if (!connection) return errorJson(NOT_CONNECTED);

  const params = new URL(request.url).searchParams;
  const prefix = PrefixSchema.safeParse(params.get("prefix") ?? undefined);
  const limit = LimitSchema.safeParse(params.get("limit") ?? undefined);
  const cursor = CursorSchema.safeParse(params.get("cursor") ?? undefined);
  if (!prefix.success) return errorJson({ title: "Invalid folder", message: firstIssue(prefix.error), status: 400 });
  if (!limit.success) return errorJson({ title: "Invalid limit", message: firstIssue(limit.error), status: 400 });
  if (!cursor.success) return errorJson({ title: "Page link expired", message: firstIssue(cursor.error), status: 400 });

  try {
    const listing: Listing = await storageFor(connection).list(prefix.data, limit.data, cursor.data);
    noteRequest({ prefix: prefix.data, folders: listing.folders.length, files: listing.files.length, truncated: listing.truncated });
    return Response.json(listing, { headers: NO_STORE });
  } catch (e) {
    noteRequest({ prefix: prefix.data, err: e });
    return errorJson(describeError(e));
  }
});
