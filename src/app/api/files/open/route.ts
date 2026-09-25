import { fileRedirect } from "../redirect";
import { withRequestLog } from "@/lib/server/request-log";

// GET /api/files/open?key=… → 302 to a presigned URL that shows the file inline.
export const GET = withRequestLog((request: Request) => fileRedirect(request, "open"));
