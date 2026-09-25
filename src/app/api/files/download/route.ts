import { fileRedirect } from "../redirect";
import { withRequestLog } from "@/lib/server/request-log";

// GET /api/files/download?key=… → 302 to a presigned URL that downloads the file under its own name.
export const GET = withRequestLog((request: Request) => fileRedirect(request, "download"));
