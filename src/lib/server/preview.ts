import "server-only";
import mime from "mime";
import Papa from "papaparse";
import { langOf, NATIVE_VIDEO_EXTS, TEXT_KINDS } from "@/lib/kinds";
import type { Connection, FileMeta, Preview } from "@/lib/types";
import { describeError } from "./errors";
import { ffmpegAvailable } from "./convert";
import { inspectMp4, Mp4Error, planFor, type Plan } from "./mp4";
import { isGenericContentType } from "./http";
import { log } from "./log";
import { playableUrl } from "./playable-cache";
import type { Storage } from "./storage";
import type { SignedUrlOptions } from "./storage/types";

export const TEXT_PREVIEW_BYTES = 512 * 1024;
export const TABLE_PREVIEW_ROWS = 500;
const plog = log.child({ scope: "preview" });

/** Builds what the viewer needs for one file. Never throws: failures become an error preview. */
export type BucketRef = Pick<Connection, "bucket" | "region">;

export async function buildPreview(storage: Storage, file: FileMeta, bucket: BucketRef): Promise<Preview> {
  try {
    if (TEXT_KINDS.has(file.kind)) return await textPreview(storage, file);

    switch (file.kind) {
      case "image":
      case "audio":
        return { type: file.kind, url: await storage.signedUrl(file.key, mediaOptions(file)) };
      case "pdf":
        return { type: "pdf", url: await storage.signedUrl(file.key, { contentType: "application/pdf" }) };
      case "video": {
        if (file.size === 0) return { type: "error", title: "This video is empty", message: "The file is 0 bytes, so there is nothing to play." };
        const canConvert = await ffmpegAvailable();
        const url = await storage.signedUrl(file.key, mediaOptions(file));
        if (!NATIVE_VIDEO_EXTS.has(file.ext)) return { type: "video", url, mode: canConvert ? "convert" : "unsupported", canConvert };
        const plan = await planPlayback(storage, file, bucket, canConvert);
        if (plan?.mode === "unplayable") return { type: "error", title: plan.title, message: plan.why };
        // Played directly, from this app, with the index moved to the front.
        if (plan?.mode === "faststart") return { type: "video", url: playableUrl(file.key), mode: "direct", canConvert };
        if (plan && plan.mode !== "direct") {
          return { type: "video", url, mode: "convert", canConvert, streamReason: plan.mode === "fragments" ? "fragments" : "layout", why: plan.why };
        }
        return { type: "video", url, mode: "direct", canConvert };
      }
      default:
        return { type: "none" };
    }
  } catch (e) {
    const err = describeError(e);
    plog.warn("preview failed", { key: file.key, kind: file.kind, title: err.title, err: e });
    return { type: "error", title: err.title, message: err.message };
  }
}

const MP4_EXTS = new Set(["mp4", "m4v", "mov"]);
/** Reading the index at page load is only worth it when it's small; the rules that matter need just its size. */
const PLAN_MOOV_BYTES = 1024 * 1024;
const PLAN_TIMEOUT_MS = 3000;
const PLAN_CACHE_SIZE = 500;
type PlaybackPlan = Plan | { mode: "unplayable"; title: string; why: string };
const planCache = new Map<string, PlaybackPlan>();

/**
 * Whether an MP4/MOV plays well straight from S3 (see `planFor`), from a few small reads of its
 * box headers. Cached per object version. Any failure or a slow read means "play it directly", as
 * before, and the player still falls back to the server if the file turns out slow.
 */
async function planPlayback(storage: Storage, file: FileMeta, bucket: BucketRef, canConvert: boolean): Promise<PlaybackPlan | null> {
  if (!MP4_EXTS.has(file.ext) || file.size < 64) return null;
  const cacheKey = `${bucket.region}\n${bucket.bucket}\n${file.key}\n${file.size}\n${file.modified ?? ""}`;
  const cached = planCache.get(cacheKey);
  if (cached) return cached.mode === "unplayable" || cached.mode === "faststart" || canConvert ? cached : null;
  const reader = { size: file.size, read: (offset: number, length: number) => storage.readBytes(file.key, offset, length) };
  const done = plog.time("playback plan", { key: file.key, size: file.size }, "debug");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const layout = await Promise.race([
      inspectMp4(reader, { maxMoovBytes: PLAN_MOOV_BYTES }),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), PLAN_TIMEOUT_MS))),
    ]);
    if (!layout) {
      done({ result: "timed out", timeoutMs: PLAN_TIMEOUT_MS }, "warn");
      return null;
    }
    const plan = planFor(layout);
    done({ mode: plan.mode, why: "why" in plan ? plan.why : undefined });
    remember(cacheKey, plan);
    // Without ffmpeg the player can only try the file directly (faststart needs no ffmpeg).
    return canConvert || plan.mode === "faststart" ? plan : null;
  } catch (e) {
    // Files no player can open: say why at once instead of letting the player spin.
    if (e instanceof Mp4Error && e.code === "no-index") {
      const plan = { mode: "unplayable" as const, title: "This video has no index", why: e.message };
      done({ mode: plan.mode, why: plan.why });
      remember(cacheKey, plan);
      return plan;
    }
    done({ result: "failed", err: e }, "warn");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function remember(key: string, plan: PlaybackPlan): void {
  if (planCache.size >= PLAN_CACHE_SIZE) planCache.delete(planCache.keys().next().value!);
  planCache.set(key, plan);
}

/**
 * Buckets filled by scripts often store media as binary/octet-stream, which Safari refuses
 * to play and some browsers won't render. Serve those with the type the name implies.
 */
function mediaOptions(file: FileMeta): SignedUrlOptions {
  if (!isGenericContentType(file.contentType)) return {};
  const guessed = mime.getType(file.name);
  return guessed ? { contentType: guessed } : {};
}

type TextType = "markdown" | "json" | "code" | "text";

async function textPreview(storage: Storage, file: FileMeta): Promise<Preview> {
  const textType: TextType = file.kind === "markdown" || file.kind === "json" || file.kind === "code" ? file.kind : "text";

  if (file.size === 0) return { type: textType, text: "", truncated: false, lang: langOf(file.key) };

  const { text, truncated } = await storage.readStart(file.key, TEXT_PREVIEW_BYTES);

  if (looksBinary(text)) return { type: "none" };

  if (file.kind === "table") return tablePreview(text, truncated, file.ext === "tsv");

  if (file.kind === "json" && !truncated) {
    const pretty = prettyJson(text);
    return pretty === null
      ? { type: "code", text, truncated, lang: "" }
      : { type: "json", text: pretty, truncated, lang: "json" };
  }

  return { type: textType, text, truncated, lang: langOf(file.key) };
}

function tablePreview(text: string, truncated: boolean, tsv: boolean): Preview {
  // One row beyond header + limit tells us the cap was hit.
  const parsed = Papa.parse<string[]>(text, {
    delimiter: tsv ? "\t" : "",
    preview: TABLE_PREVIEW_ROWS + 2,
    skipEmptyLines: "greedy",
  });
  let rows = parsed.data;
  const hitCap = rows.length > TABLE_PREVIEW_ROWS + 1;
  // A byte-limited read usually cuts the final row in half; drop it unless the cut fell on a line end.
  if (!hitCap && truncated && rows.length > 1 && !/[\r\n]$/.test(text)) rows = rows.slice(0, -1);
  const [header = [], ...body] = rows.slice(0, TABLE_PREVIEW_ROWS + 1);
  return { type: "table", header, rows: body, truncated, rowsTruncated: hitCap };
}

type Reviver = (key: string, value: unknown, context?: { source?: string }) => unknown;
const JSONX = JSON as typeof JSON & { rawJSON?: (text: string) => unknown };

/**
 * Pretty-prints JSON without changing any value. Plain JSON.parse rounds integers above
 * 2^53 (common for IDs and nanosecond timestamps); number literals are kept as written.
 * Returns null when the text isn't valid JSON.
 */
export function prettyJson(text: string): string | null {
  let lossy = false;
  const reviver: Reviver = (_key, value, context) => {
    if (typeof value !== "number" || context?.source === undefined || String(value) === context.source) return value;
    if (JSONX.rawJSON) return JSONX.rawJSON(context.source);
    lossy = true;
    return value;
  };
  try {
    const parse = JSON.parse as (text: string, reviver: Reviver) => unknown;
    const value = parse(text, reviver);
    return lossy ? text : JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

/**
 * NUL bytes, or many control or undecodable characters, in the first few KB
 * almost always mean a binary file with a text extension.
 */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 8000);
  if (!sample) return false;
  if (sample.includes("\u0000")) return true;
  let odd = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    // Tab, LF, FF, CR and ESC (ANSI colors in logs) are normal in text.
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13 && c !== 27) || c === 127) odd++;
  }
  return odd / sample.length > 0.1;
}
