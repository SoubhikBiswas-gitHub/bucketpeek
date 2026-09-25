// Shared by /api/files/details and the details sheet, so nothing here may be server-only.
import { baseName } from "./kinds";
import { folderOf } from "./paths";
import type { AppError, HealthProblem } from "./types";

export const DETAIL_PARTS = ["s3", "video", "health", "sidecar"] as const;
export type DetailPart = (typeof DETAIL_PARTS)[number];

export interface ObjectChecksum {
  // "CRC32", "CRC32C", "CRC64NVME", "SHA1", "SHA256".
  algorithm: string;
  // Base64, as S3 reports it.
  value: string;
}

export type ObjectTags =
  | { status: "ok"; tags: { key: string; value: string }[] }
  // The keys lack s3:GetObjectTagging.
  | { status: "denied" }
  | { status: "error"; message: string };

// Facts from HeadObject (and GetObjectTagging) beyond the listing's size and date. Every field is
// null when S3 didn't send it; local (mock) storage has none of them and returns all nulls.
export interface ObjectDetails {
  etag: string | null;
  storageClass: string | null;
  versionId: string | null;
  contentEncoding: string | null;
  contentLanguage: string | null;
  cacheControl: string | null;
  contentDisposition: string | null;
  expires: string | null;
  serverSideEncryption: string | null;
  kmsKeyId: string | null;
  bucketKeyEnabled: boolean | null;
  sseCustomerAlgorithm: string | null;
  // Lifecycle expiry ("expiry-date=…, rule-id=…").
  expiration: string | null;
  // Restore state of an archived object ('ongoing-request="false", expiry-date=…').
  restore: string | null;
  archiveStatus: string | null;
  // "FULL_OBJECT" or "COMPOSITE" (multipart).
  checksumType: string | null;
  checksums: ObjectChecksum[];
  // x-amz-meta-* headers, without the prefix.
  metadata: { key: string; value: string }[];
  replicationStatus: string | null;
  objectLockMode: string | null;
  objectLockRetainUntil: string | null;
  objectLockLegalHold: string | null;
  // Parts of a multipart upload, from the ETag's "-N" suffix.
  multipartParts: number | null;
  // null when the storage has no tags at all (local files).
  tags: ObjectTags | null;
}

export interface StreamDetails {
  index: number;
  type: string;
  codec: string | null;
  codecLong: string | null;
  // RFC 6381 codec string (avc1.64001f), when ffprobe reports it.
  codecString: string | null;
  codecTag: string | null;
  profile: string | null;
  level: string | null;
  width: number | null;
  height: number | null;
  displayAspectRatio: string | null;
  // Rational like "30000/1001".
  frameRate: string | null;
  avgFrameRate: string | null;
  pixelFormat: string | null;
  colorSpace: string | null;
  bitDepth: number | null;
  fieldOrder: string | null;
  bitRate: number | null;
  // Degrees, from the display matrix.
  rotation: number | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  sampleFormat: string | null;
  duration: number | null;
  frames: number | null;
  language: string | null;
  tags: { key: string; value: string }[];
}

export interface VideoDetails {
  format: {
    name: string | null;
    longName: string | null;
    duration: number | null;
    bitRate: number | null;
    startTime: number | null;
    streams: number | null;
    tags: { key: string; value: string }[];
  };
  streams: StreamDetails[];
}

// `source` says where the facts came from (the file's own boxes, ffprobe, or both), for debugging only.
export type VideoResult =
  | { status: "ok"; video: VideoDetails; source?: "mp4" | "ffprobe" | "mp4+ffprobe" }
  | { status: "unavailable"; reason: string }
  | { status: "not-video" };

export type FileHealth =
  | { status: "none" }
  | { status: "running" }
  | { status: "done"; startedAt: string; finishedAt: string; problem: HealthProblem | null };

export type SidecarResult =
  | { status: "none"; key: string | null }
  | { status: "ok"; key: string; size: number; data: unknown }
  | { status: "too-big"; key: string; size: number }
  | { status: "invalid"; key: string; size: number; message: string }
  | { status: "error"; key: string; message: string };

export interface DetailResponses {
  s3: ObjectDetails;
  video: VideoResult;
  health: FileHealth;
  sidecar: SidecarResult;
}

export type DetailPayload<P extends DetailPart> = { data: DetailResponses[P] } | { error: AppError };

export const SIDECAR_MAX_BYTES = 64 * 1024;

// The sidecar metadata file for `key`: `<name-without-extension>_METADATA.json` in the same folder,
// or null for a key that is itself a sidecar.
export function sidecarKey(key: string): string | null {
  const name = baseName(key);
  if (!name || /_METADATA\.json$/i.test(name)) return null;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${folderOf(key)}${stem}_METADATA.json`;
}

// A number from ffprobe's strings ("8.000000", "2790315"), or null for "N/A" and junk.
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// "30000/1001" → 29.97…, "25/1" → 25, "30" → 30. Null for "0/0" and junk.
export function parseRational(r: string | null | undefined): number | null {
  if (!r) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:[/:]\s*(\d+(?:\.\d+)?))?\s*$/.exec(r);
  if (!m) return null;
  const num = Number(m[1]);
  const den = m[2] === undefined ? 1 : Number(m[2]);
  if (!den || !Number.isFinite(num)) return null;
  const v = num / den;
  return v > 0 ? v : null;
}

// Up to `digits` decimals, trailing zeros dropped: 29.97002997 → "29.97", 30 → "30".
function trim(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

export function formatFrameRate(r: string | null | undefined): string | null {
  const v = parseRational(r);
  return v === null ? null : `${trim(v, 3)} fps`;
}

// 3723.4 → "1:02:03", 8 → "0:00:08". Rounded to the nearest second.
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatSeconds(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  return trim(seconds, 3);
}

// Bits per second in decimal units: 2927613 → "2.93 Mb/s", 127001 → "127 kb/s".
export function formatBitrate(bps: number | null | undefined): string | null {
  if (bps === null || bps === undefined || !Number.isFinite(bps) || bps <= 0) return null;
  if (bps >= 1e9) return `${trim(bps / 1e9, 2)} Gb/s`;
  if (bps >= 1e6) return `${trim(bps / 1e6, 2)} Mb/s`;
  if (bps >= 1e3) return `${trim(bps / 1e3, 0)} kb/s`;
  return `${Math.round(bps)} b/s`;
}

export function formatSampleRate(hz: number | null | undefined): string | null {
  if (!hz || !Number.isFinite(hz)) return null;
  return hz >= 1000 ? `${trim(hz / 1000, 3)} kHz` : `${hz} Hz`;
}

export function formatChannels(channels: number | null, layout: string | null): string | null {
  if (!channels) return layout;
  return layout ? `${channels} (${layout})` : String(channels);
}

// ffprobe's numeric level in the notation people use: H.264 31 → "3.1", HEVC 93 (level × 30) → "3.1".
// Other codecs keep the raw number. Null when unknown (-99).
export function formatLevel(codec: string | null, level: unknown): string | null {
  const n = toNumber(level);
  if (n === null || n < 0) return null;
  if (codec === "h264") return n % 10 === 0 ? `${n / 10}` : `${Math.floor(n / 10)}.${n % 10}`;
  if (codec === "hevc" || codec === "vvc") return trim(n / 30, 1);
  return String(n);
}

// S3's x-amz-server-side-encryption values in the names the console uses.
export function encryptionLabel(sse: string): string {
  const names: Record<string, string> = { AES256: "SSE-S3", "aws:kms": "SSE-KMS", "aws:kms:dsse": "DSSE-KMS", aws_fsx: "FSx" };
  return names[sse] ? `${names[sse]} (${sse})` : sse;
}

// ETags arrive quoted; people paste them bare.
export function bareEtag(etag: string): string {
  return etag.replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

const PROBLEM_LABELS: Record<HealthProblem["kind"], string> = {
  empty: "Empty",
  "no-index": "No index",
  repairable: "Repaired when played",
  damaged: "Damaged",
  unreadable: "Couldn’t be read",
};
// The bucket check only walks the structure of these; other videos are checked for size alone.
const STRUCTURE_CHECKED = new Set(["mp4", "m4v", "mov"]);

export function healthSummary(
  health: FileHealth,
  file: { ext: string; modified: string | null },
): { label: string; detail: string | null; tone: "ok" | "warn" | "bad" | "none" } {
  if (health.status === "none") return { label: "Not checked yet", detail: null, tone: "none" };
  if (health.status === "running") return { label: "Being checked now", detail: null, tone: "none" };
  if (health.problem) {
    const tone = health.problem.kind === "repairable" ? "warn" : "bad";
    return { label: PROBLEM_LABELS[health.problem.kind] ?? health.problem.kind, detail: health.problem.detail, tone };
  }
  const modified = file.modified ? Date.parse(file.modified) : NaN;
  if (Number.isFinite(modified) && modified > Date.parse(health.startedAt)) {
    return { label: "Not checked yet", detail: "Changed after the last bucket check.", tone: "none" };
  }
  if (!STRUCTURE_CHECKED.has(file.ext.toLowerCase())) {
    return { label: "Not empty", detail: "Only MP4 and MOV files are checked in depth.", tone: "ok" };
  }
  return { label: "Plays fine", detail: null, tone: "ok" };
}

export interface FlatRow {
  label: string;
  value: string;
}

const PRIMITIVE = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const asText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

// Flattens JSON into label/value rows: nested objects become "Parent › child" labels, arrays of plain
// values join with ", ", arrays of objects are numbered ("items › 1 › name"). Stops after `limit` rows.
export function flattenJson(value: unknown, limit = 500): { rows: FlatRow[]; truncated: boolean } {
  const rows: FlatRow[] = [];
  let truncated = false;
  const walk = (v: unknown, path: string[]) => {
    if (rows.length >= limit) {
      truncated = true;
      return;
    }
    const label = path.join(" › ");
    if (PRIMITIVE(v)) {
      rows.push({ label: label || "Value", value: asText(v) });
    } else if (Array.isArray(v)) {
      if (v.length === 0) rows.push({ label: label || "Value", value: "[]" });
      else if (v.every(PRIMITIVE)) rows.push({ label: label || "Value", value: v.map(asText).join(", ") });
      else v.forEach((item, i) => walk(item, [...path, String(i + 1)]));
    } else if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 0) rows.push({ label: label || "Value", value: "{}" });
      for (const [k, child] of entries) walk(child, [...path, k]);
    }
  };
  walk(value, []);
  return { rows, truncated };
}
