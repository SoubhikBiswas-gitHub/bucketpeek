import type { NextRequest } from "next/server";
import { bucketHealth } from "@/lib/server/health";
import { NO_STORE } from "@/lib/server/http";
import { getConnection } from "@/lib/server/session";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";

const notConnected = () =>
  Response.json({ error: { title: "Not connected", message: "Connect to a bucket first.", status: 401 } }, { status: 401, headers: NO_STORE });

// GET /api/health → the saved report for these credentials, the check in progress, or "none". Read-only.
export const GET = withRequestLog(async (request: NextRequest) => {
  const connection = await getConnection();
  if (!connection) return notConnected();
  const health = await bucketHealth(connection, { origin: request.nextUrl.origin });
  noteRequest({ bucket: connection.bucket, health: health.status });
  return Response.json(health, { headers: NO_STORE });
}, { quiet: true });

// POST /api/health starts the check when there is no report yet (the first visit);
// POST /api/health?rescan=1 checks the bucket again ("Scan again").
export const POST = withRequestLog(async (request: NextRequest) => {
  const connection = await getConnection();
  if (!connection) return notConnected();
  const rescan = request.nextUrl.searchParams.get("rescan") === "1";
  const health = await bucketHealth(connection, { start: true, rescan, origin: request.nextUrl.origin });
  noteRequest({ bucket: connection.bucket, health: health.status, rescan });
  return Response.json(health, { headers: NO_STORE });
});
