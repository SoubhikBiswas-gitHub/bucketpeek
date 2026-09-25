import "server-only";
import { cookies } from "next/headers";
import { lowerDownloadLimits, MOCK_LIMITS_COOKIE, parseDownloadLimits, type DownloadLimits } from "@/lib/download-limits";
import { isMockMode } from "./storage";

// Read at request time, so a container picks up new values on restart without a rebuild.
// In mock mode only, a cookie can lower them for end-to-end tests.
export async function bulkDownloadLimits(): Promise<DownloadLimits> {
  const limits = parseDownloadLimits(process.env);
  if (!isMockMode()) return limits;
  const override = (await cookies()).get(MOCK_LIMITS_COOKIE)?.value;
  return override ? lowerDownloadLimits(limits, override) : limits;
}
