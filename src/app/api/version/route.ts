import { NO_STORE } from "@/lib/server/http";
import { withRequestLog } from "@/lib/server/request-log";

export const dynamic = "force-dynamic";

// GET /api/version → the commit and image tag this server was built from, to confirm a deploy.
export const GET = withRequestLog((): Response => {
  return Response.json(
    {
      commit: process.env.APP_COMMIT || "unknown",
      version: process.env.APP_VERSION || "unknown",
    },
    { headers: NO_STORE },
  );
}, { quiet: true });
