import "server-only";
import { execFile } from "node:child_process";
import { formatLevel, toNumber, type StreamDetails, type VideoDetails, type VideoResult } from "@/lib/file-details";
import { ffmpegPath, ffprobeFor, INPUT_ARGS } from "./convert";
import { redact } from "./errors";
import { log } from "./log";

// ffprobe reads only the container's header and index over a presigned URL (a few range GETs),
// and results stay in memory per bucket + key + version, so reopening the sheet costs nothing.

// ffprobe gets this long; the sheet shows "unavailable" after it rather than waiting.
export const PROBE_TIMEOUT_MS = 10_000;
const CACHE_MAX = 500;

type State = { cache: Map<string, VideoDetails>; inflight: Map<string, Promise<VideoResult>> };
// Survives dev hot reloads.
const g = globalThis as unknown as { __lensProbe?: State };
const state: State = (g.__lensProbe ??= { cache: new Map(), inflight: new Map() });
const plog = log.child({ scope: "ffprobe" });

export interface ProbeTarget {
  bucket: string;
  key: string;
  // Changes when the object does (size + modified time).
  version: string;
}

const cacheKey = (t: ProbeTarget) => JSON.stringify([t.bucket, t.key, t.version]);

function remember(id: string, video: VideoDetails): void {
  state.cache.delete(id);
  state.cache.set(id, video);
  while (state.cache.size > CACHE_MAX) state.cache.delete(state.cache.keys().next().value!);
}

// The video's container and stream facts. `source` makes the URL ffprobe reads (only called on a
// cache miss). Never throws: a missing ffprobe, a timeout or an unreadable file is "unavailable".
export async function probeVideo(target: ProbeTarget, source: () => Promise<string>): Promise<VideoResult> {
  const id = cacheKey(target);
  const hit = state.cache.get(id);
  if (hit) {
    remember(id, hit);
    return { status: "ok", video: hit };
  }
  let pending = state.inflight.get(id);
  if (!pending) {
    const done = plog.time("probe", { bucket: target.bucket, key: target.key });
    pending = (async (): Promise<VideoResult> => {
      const bin = await ffmpegPath();
      if (!bin) {
        done({ result: "no ffmpeg" }, "warn");
        return { status: "unavailable", reason: "ffmpeg isn’t installed on the machine running Deccan Lens." };
      }
      const result = await runProbe(ffprobeFor(bin), await source());
      if (result.status === "ok") {
        remember(id, result.video);
        done({ result: "ok", format: result.video.format.name, streams: result.video.streams.length }, "debug");
      } else done({ result: result.status, reason: "reason" in result ? result.reason : undefined }, "warn");
      return result;
    })()
      .catch((e): VideoResult => {
        done({ result: "failed", err: e }, "error");
        return { status: "unavailable", reason: e instanceof Error ? redact(e.message) : "ffprobe failed." };
      })
      .finally(() => state.inflight.delete(id));
    state.inflight.set(id, pending);
  }
  return pending;
}

function runProbe(ffprobe: string, url: string): Promise<VideoResult> {
  return new Promise((resolve) => {
    execFile(
      ffprobe,
      ["-v", "error", ...INPUT_ARGS, "-show_format", "-show_streams", "-of", "json", url],
      { timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const e = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
          if (e.code === "ENOENT") return resolve({ status: "unavailable", reason: "ffprobe isn’t installed next to ffmpeg." });
          if (e.killed || e.signal) {
            return resolve({ status: "unavailable", reason: `ffprobe took longer than ${PROBE_TIMEOUT_MS / 1000} seconds.` });
          }
          const last = String(stderr ?? "").trim().split("\n").pop() ?? "";
          return resolve({ status: "unavailable", reason: `ffprobe couldn’t read this file. ${redact(last)}`.trim() });
        }
        try {
          resolve({ status: "ok", video: videoDetailsFromProbe(JSON.parse(String(stdout))) });
        } catch {
          resolve({ status: "unavailable", reason: "ffprobe’s answer couldn’t be read." });
        }
      },
    );
  });
}

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  codec_tag_string?: string;
  mime_codec_string?: string;
  profile?: string;
  level?: number | string;
  width?: number;
  height?: number;
  display_aspect_ratio?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  color_space?: string;
  bits_per_raw_sample?: string | number;
  field_order?: string;
  bit_rate?: string | number;
  sample_rate?: string | number;
  channels?: number;
  channel_layout?: string;
  sample_fmt?: string;
  duration?: string | number;
  nb_frames?: string | number;
  tags?: Record<string, unknown>;
  side_data_list?: { side_data_type?: string; rotation?: number | string }[];
}

interface ProbeJson {
  format?: {
    format_name?: string;
    format_long_name?: string;
    duration?: string | number;
    bit_rate?: string | number;
    start_time?: string | number;
    nb_streams?: number;
    tags?: Record<string, unknown>;
  };
  streams?: ProbeStream[];
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() && v !== "unknown" && v !== "N/A" ? v : null);
const positive = (v: unknown): number | null => {
  const n = toNumber(v);
  return n !== null && n > 0 ? n : null;
};
const frameRate = (r: string | undefined) => (r && r !== "0/0" ? r : null);

function tagList(tags: Record<string, unknown> | undefined): { key: string; value: string }[] {
  return Object.entries(tags ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([key, v]) => ({ key, value: typeof v === "string" ? v : JSON.stringify(v) }));
}

function rotationOf(s: ProbeStream): number | null {
  const matrix = s.side_data_list?.find((d) => d.side_data_type === "Display Matrix");
  const r = toNumber(matrix?.rotation) ?? toNumber(s.tags?.rotate);
  return r === null ? null : r === 0 ? 0 : r;
}

function streamOf(s: ProbeStream, i: number): StreamDetails {
  const codec = text(s.codec_name);
  const language = text(s.tags?.language);
  return {
    index: typeof s.index === "number" ? s.index : i,
    type: text(s.codec_type) ?? "data",
    codec,
    codecLong: text(s.codec_long_name),
    codecString: text(s.mime_codec_string),
    codecTag: text(s.codec_tag_string) && !/^\[\d+\]/.test(s.codec_tag_string!) ? s.codec_tag_string! : null,
    profile: text(s.profile),
    level: formatLevel(codec, s.level),
    width: positive(s.width),
    height: positive(s.height),
    displayAspectRatio: text(s.display_aspect_ratio) && s.display_aspect_ratio !== "0:1" ? s.display_aspect_ratio! : null,
    frameRate: frameRate(s.r_frame_rate),
    avgFrameRate: frameRate(s.avg_frame_rate),
    pixelFormat: text(s.pix_fmt),
    colorSpace: text(s.color_space),
    bitDepth: positive(s.bits_per_raw_sample),
    fieldOrder: text(s.field_order),
    bitRate: positive(s.bit_rate),
    rotation: rotationOf(s),
    sampleRate: positive(s.sample_rate),
    channels: positive(s.channels),
    channelLayout: text(s.channel_layout),
    sampleFormat: text(s.sample_fmt),
    duration: positive(s.duration),
    frames: positive(s.nb_frames),
    language: language === "und" ? null : language,
    tags: tagList(s.tags),
  };
}

// ffprobe's `-show_format -show_streams -of json` output as the sheet shows it.
export function videoDetailsFromProbe(json: ProbeJson): VideoDetails {
  const f = json.format ?? {};
  return {
    format: {
      name: text(f.format_name),
      longName: text(f.format_long_name),
      duration: positive(f.duration),
      bitRate: positive(f.bit_rate),
      startTime: toNumber(f.start_time),
      streams: typeof f.nb_streams === "number" ? f.nb_streams : null,
      tags: tagList(f.tags),
    },
    streams: (json.streams ?? []).map(streamOf),
  };
}

// For tests.
export function clearProbeCache(): void {
  state.cache.clear();
  state.inflight.clear();
}
