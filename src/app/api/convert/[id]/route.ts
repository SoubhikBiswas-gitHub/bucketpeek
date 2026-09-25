import { z } from "zod";
import { getStream, isJobId, streamStatus } from "@/lib/server/convert";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";
import { getConnection } from "@/lib/server/session";
import { checkStreamAccess } from "@/lib/server/stream-access";
import { errorJson, NOT_CONNECTED } from "../respond";

// ffmpeg prefixes errors with the input URL. That's a long presigned link (or an internal path): drop it.
function withoutUrls(line: string): string {
  return line.replace(/(?:https?:\/\/|\/api\/mock\?)\S+?(?=:\s|\s|$)/g, "Source file").trim();
}

const Params = z.object({ id: z.string().refine(isJobId, "Unknown conversion.") });

const UNKNOWN = { title: "Unknown conversion", message: "This conversion doesn’t exist." };

// GET /api/convert/:id returns `ConvertStatus`: whether the video turned out not to be convertible.
// The player asks after a fatal error, to say why.
export const GET = withRequestLog(async (_request: Request, ctx: RouteContext<"/api/convert/[id]">) => {
  const connection = await getConnection();
  if (!connection) return errorJson(NOT_CONNECTED, 401);

  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) return errorJson(UNKNOWN, 404);

  const stream = await getStream(parsed.data.id, connection.bucket);
  if (!stream) return errorJson(UNKNOWN, 404);
  const access = await checkStreamAccess(connection, stream);
  if (!access.ok) return errorJson(access.status === 404 ? UNKNOWN : { title: "Couldn’t check this video", message: access.message }, access.status);

  const status = streamStatus(stream.id);
  if (status.error) status.error = withoutUrls(status.error);
  noteRequest({ stream: stream.id, failed: status.failed });
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
});
