// Every byte downloaded is billed as S3 egress, so a selection can be downloaded only while it fits these;
// copying paths and links stays unlimited.
export interface DownloadLimits {
  // Total size of the selected files, in decimal bytes like the sizes shown.
  maxBytes: number;
  // Browsers throttle, or ask about, many downloads at once.
  maxFiles: number;
}

export const DEFAULT_DOWNLOAD_LIMITS: DownloadLimits = { maxBytes: 1_000_000_000, maxFiles: 50 };

// Lowers the limits in mock mode, so end-to-end tests can reach them with small fixtures.
export const MOCK_LIMITS_COOKIE = "lens-mock-download-limits";

function positive(raw: string | null | undefined): number | null {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseDownloadLimits(env: Readonly<Record<string, string | undefined>>): DownloadLimits {
  const gb = positive(env.LENS_BULK_DOWNLOAD_MAX_GB);
  const files = positive(env.LENS_BULK_DOWNLOAD_MAX_FILES);
  return {
    maxBytes: gb === null ? DEFAULT_DOWNLOAD_LIMITS.maxBytes : Math.max(1, Math.round(gb * 1e9)),
    maxFiles: files === null || files < 1 ? DEFAULT_DOWNLOAD_LIMITS.maxFiles : Math.floor(files),
  };
}

// `override` looks like "maxBytes=1000&maxFiles=2"; anything it doesn't understand is ignored.
export function lowerDownloadLimits(limits: DownloadLimits, override: string): DownloadLimits {
  const p = new URLSearchParams(override);
  const bytes = positive(p.get("maxBytes"));
  const files = positive(p.get("maxFiles"));
  return {
    maxBytes: bytes === null ? limits.maxBytes : Math.min(limits.maxBytes, Math.max(1, Math.round(bytes))),
    maxFiles: files === null || files < 1 ? limits.maxFiles : Math.min(limits.maxFiles, Math.floor(files)),
  };
}
