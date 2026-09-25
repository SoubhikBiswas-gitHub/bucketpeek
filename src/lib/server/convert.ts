import "server-only";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { redact } from "./errors";
import { FragmentsTooLarge, indexFragments, mseSegment, type FragmentIndex } from "./fmp4";
import { httpReader } from "./http-reader";
import { inspections } from "./limits";
import { log } from "./log";
import { ensurePrivateDir } from "./private-dir";
import { inspectMp4, Mp4Error, planFor, type ByteReader } from "./mp4";

/**
 * Streams videos browsers can't decode as HLS, converted by ffmpeg on demand.
 *
 * The playlist covers the whole video from the first request, in fixed SEGMENT_SECONDS segments,
 * so the player shows the full timeline and can seek anywhere. A segment is converted when it is
 * asked for: each video has at most one ffmpeg process (a "runner") that starts at the requested
 * segment and works forward. A request far from where the runner is (a seek) restarts it there.
 * Keyframes are forced on segment boundaries and timestamps are offset to the segment's place in
 * the video, so segments from different runners line up exactly.
 *
 * - Only what is watched is read from the bucket and converted. A runner pauses (SIGSTOP) once
 *   it is RUNAHEAD_SECONDS ahead of the player and continues as the player catches up; pausing
 *   rather than restarting matters for huge files, whose index ffmpeg re-reads on every start
 *   (~160 MB for a 40-hour AVI). It stops when nobody has asked for the video for IDLE_MS.
 * - At most `maxConcurrentConversions()` runners (half the CPU cores, LENS_MAX_CONVERSIONS to
 *   override). A new one takes the slot of a video nobody is loading, or waits for one.
 * - A source ffmpeg can't decode is reported after a few seconds instead of retried forever.
 * - Converted segments are cached in LENS_HLS_DIR and pruned by count (LENS_HLS_KEEP_JOBS,
 *   default 24), age (LENS_HLS_MAX_AGE_HOURS, default 24) and size (LENS_HLS_MAX_GB, default 20).
 */

const run = promisify(execFile);
const ROOT = process.env.LENS_HLS_DIR ? path.resolve(process.env.LENS_HLS_DIR) : path.join(os.tmpdir(), "deccan-lens-hls");
export const PLAYLIST = "index.m3u8";
export const SEGMENT_SECONDS = 4;
const META = "meta.json";
const SAFE_JOB = /^[0-9a-f]{24}$/;
const SEGMENT = /^seg_(\d{5,})\.ts$/;
/** Fragmented MP4 streams: the init segment and byte-range segments of the original file. */
export const INIT_SEGMENT = "init.mp4";
const FRAGMENT = /^frag_(\d{5,})\.m4s$/;
/** Containers that may be fragmented MP4 (checked by reading their boxes). */
const MP4_LIKE = /\.(mp4|m4v|mov)$/i;
/** Largest index read on the server to plan a stream; a bigger one is converted without reading it. */
const MAX_MOOV_READ = 64 * 1024 * 1024;
/** Added to every timestamp so no runner produces negative ones (which ffmpeg would shift unevenly). */
const TS_BASE = 10;
/** A request this close past the runner's position is coming soon; further away it's a seek. */
const FOLLOW_SEGMENTS = Math.ceil(12 / SEGMENT_SECONDS);
const RUNAHEAD_SECONDS = 120;
const RUNAHEAD_SEGMENTS = Math.ceil(RUNAHEAD_SECONDS / SEGMENT_SECONDS);
const IDLE_MS = 60_000;
/** A runner whose video had no request for this long may give its slot to another video. */
const EVICTABLE_MS = 15_000;
const SEGMENT_WAIT_MS = 60_000;
const POLL_MS = 100;
const WATCHDOG_MS = 5_000;
/** Runners that die in a row without writing anything before the video is reported as failed. */
const MAX_FAILURES = 3;
/**
 * A source ffmpeg can't decode prints an error for every frame and never writes a segment. Past both
 * limits with nothing written, the video is reported as failed instead of spinning.
 */
const UNDECODABLE = { errors: 1000, afterMs: 8_000 };
const UNDECODABLE_REASON =
  "ffmpeg couldn’t decode the video in this file, so there is nothing to play. The file may be damaged or written in a non-standard way. Download it and try a desktop player like VLC.";
/** A broken source can print hundreds of errors a second; keep only the start of each log on disk. */
const LOG_MAX_BYTES = 1024 * 1024;

/**
 * Demuxers ffmpeg may use on a source. Media files can embed references to other inputs
 * (HLS playlists, concat scripts); a fixed list of real video containers plus a network-only
 * protocol list keeps a crafted file from reading local files or other hosts.
 */
const DEMUXERS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,ogg,avi,mpeg,mpegts,mpegvideo,asf,flv,mxf,h264,hevc,m4v,dv";
export const INPUT_ARGS = [
  "-rw_timeout", "30000000",
  "-protocol_whitelist", "http,https,tcp,tls",
  "-format_whitelist", DEMUXERS,
];

/** A failure to report to the player, with the HTTP status that fits it. */
export class StreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StreamError";
  }
}

interface Runner {
  proc: ChildProcess;
  /** Its own folder; finished segments are moved from here into the video's folder. */
  dir: string;
  /** First segment it writes. */
  start: number;
  /** First segment it hasn't finished. */
  next: number;
  exitCode: number | null;
  startedAt: number;
  stderrTail: string;
  // Writes a last line that didn't end in a newline.
  flushLog?: () => void;
  stopReason?: string;
  /** Stopped with SIGSTOP because it is far enough ahead of the player. */
  paused: boolean;
}

interface Stream {
  id: string;
  bucket: string;
  key: string;
  /** The object version it was made from (size + modified time). */
  version: string;
  /** "fragments": a fragmented MP4 served as byte ranges of itself; "transcode": converted by ffmpeg. */
  kind: "transcode" | "fragments";
  fragments?: FragmentIndex;
  duration: number;
  segments: number;
  runner: Runner | null;
  /** A runner is being set up (source URL, folder); others wait instead of starting a second one. */
  launching: boolean;
  lastRequest: number;
  lastIndex: number;
  failures: number;
  /**
   * True after a strict decode fails; next run uses -err_detect ignore_err -fflags +discardcorrupt
   * to recover partially-damaged files (e.g. from de-identification tools).
   */
  tolerant?: boolean;
  /** Set when the source can't be converted at all; cleared by opening the video again. */
  failed?: string;
}

interface Meta {
  bucket: string;
  key: string;
  version: string;
  duration: number;
  kind?: Stream["kind"];
  /** Only saved once complete. */
  fragments?: FragmentIndex;
}

type State = {
  streams: Map<string, Stream>;
  opening: Map<string, Promise<Stream>>;
  runnerSeq: number;
  ffmpeg?: Promise<string | null>;
  encoder?: Promise<string[]>;
  hooked?: boolean;
  watchdog?: ReturnType<typeof setInterval>;
};
// Survives dev hot reloads.
const g = globalThis as unknown as { __lensStream?: State };
const state: State = (g.__lensStream ??= { streams: new Map(), opening: new Map(), runnerSeq: 0 });
const clog = log.child({ scope: "convert" });

/** A non-negative number from the environment, or the fallback when unset or invalid. */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function maxConcurrentConversions(): number {
  const auto = Math.max(1, Math.floor(os.cpus().length / 2));
  return Math.max(1, Math.floor(envNumber("LENS_MAX_CONVERSIONS", auto)));
}

const limits = () => ({
  keepJobs: Math.floor(envNumber("LENS_HLS_KEEP_JOBS", 24)),
  maxAgeMs: envNumber("LENS_HLS_MAX_AGE_HOURS", 24) * 3600_000,
  maxCacheBytes: envNumber("LENS_HLS_MAX_GB", 20) * 1024 ** 3,
});

/** The ffmpeg binary to run, or null when it isn't installed. Checked once per process. */
export function ffmpegPath(): Promise<string | null> {
  state.ffmpeg ??= (async () => {
    const bin = process.env.FFMPEG_PATH || "ffmpeg";
    try {
      await run(bin, ["-hide_banner", "-version"], { timeout: 10_000 });
      return bin;
    } catch {
      return null;
    }
  })();
  return state.ffmpeg;
}

/** ffprobe ships next to ffmpeg. */
export function ffprobeFor(ffmpeg: string): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const dir = path.dirname(ffmpeg);
  return dir === "." ? "ffprobe" : path.join(dir, "ffprobe");
}

export async function ffmpegAvailable(): Promise<boolean> {
  return (await ffmpegPath()) !== null;
}

function encoderArgs(bin: string): Promise<string[]> {
  state.encoder ??= (async () => {
    const { stdout } = await run(bin, ["-hide_banner", "-encoders"], { timeout: 10_000 }).catch(() => ({ stdout: "" }));
    return stdout.includes("h264_videotoolbox")
      ? ["-c:v", "h264_videotoolbox", "-b:v", "6M", "-maxrate", "8M", "-bufsize", "12M"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-maxrate", "8M", "-bufsize", "16M"];
  })();
  return state.encoder;
}

export function isJobId(id: string): boolean {
  return SAFE_JOB.test(id);
}

export function jobId(bucket: string, key: string): string {
  return createHash("sha256").update(`${bucket}/${key}`).digest("hex").slice(0, 24);
}

const dirOf = (id: string) => path.join(ROOT, id);
const segName = (n: number) => `seg_${String(n).padStart(5, "0")}.ts`;
const isRunning = (r: Runner | null): r is Runner => r !== null && r.exitCode === null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exists = (p: string) => fs.access(p).then(() => true, () => false);

const ensureRoot = () => ensurePrivateDir(ROOT);

/** Number of segments for a duration. A last sliver under half a second is dropped: ffmpeg may not write it. */
export function segmentCount(duration: number): number {
  const whole = Math.floor(duration / SEGMENT_SECONDS);
  return whole + (duration - whole * SEGMENT_SECONDS >= 0.5 ? 1 : 0);
}

// ---------------------------------------------------------------- opening

/**
 * Length of the video at `source`, from ffprobe. Uses the video stream's duration when the
 * container reports a longer one (e.g. trailing audio), so the playlist never runs past the picture.
 */
async function probeDuration(bin: string, source: string): Promise<number> {
  const started = performance.now();
  let stdout: string;
  try {
    ({ stdout } = await run(
      ffprobeFor(bin),
      ["-v", "error", ...INPUT_ARGS, "-show_entries", "format=duration:stream=codec_type,duration", "-of", "json", source],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? "").trim().split("\n").pop() ?? "";
    clog.warn("ffprobe failed", { stderr: redact(stderr), ms: Math.round(performance.now() - started) });
    throw new StreamError(`ffprobe couldn’t read this file. ${redact(stderr)}`.trim(), 422);
  }
  const info = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; duration?: string }[];
  };
  const video = info.streams?.find((s) => s.codec_type === "video");
  if (!video) throw new StreamError("This file has no video stream.", 422);
  const candidates = [Number(info.format?.duration), Number(video.duration)].filter((n) => Number.isFinite(n) && n > 0);
  if (candidates.length === 0) throw new StreamError("ffprobe couldn’t tell how long this video is, so it can’t be streamed.", 422);
  return Math.min(...candidates);
}

async function readMeta(id: string): Promise<Meta | null> {
  try {
    const m = JSON.parse(await fs.readFile(path.join(dirOf(id), META), "utf8")) as Meta;
    return typeof m.bucket === "string" && typeof m.key === "string" && Number.isFinite(m.duration) && m.duration > 0 ? m : null;
  } catch {
    return null;
  }
}

function toStream(id: string, m: Meta): Stream {
  const kind = m.kind === "fragments" && m.fragments ? "fragments" : "transcode";
  return {
    id,
    bucket: m.bucket,
    key: m.key,
    version: m.version,
    kind,
    fragments: kind === "fragments" ? m.fragments : undefined,
    duration: m.duration,
    segments: kind === "fragments" ? m.fragments!.segments.length : segmentCount(m.duration),
    runner: null,
    launching: false,
    lastRequest: Date.now(),
    lastIndex: 0,
    failures: 0,
  };
}

export interface OpenInput {
  bucket: string;
  key: string;
  /** Changes when the object changes (size + modified time), so stale segments are thrown away. */
  version: string;
  /** Absolute http(s) URL ffprobe can read the source from. */
  source: string;
  /** Object size in bytes. */
  size: number;
}

/**
 * Prepares a video for streaming: probes its length once (cached on disk with its segments)
 * and returns the stream. Opening again clears an earlier failure, so it doubles as "try again".
 */
export async function openStream(input: OpenInput): Promise<{ id: string; duration: number; segments: number }> {
  const id = jobId(input.bucket, input.key);
  // Two requests for the same video (double click, two tabs) share one probe.
  let pending = state.opening.get(id);
  if (!pending) {
    pending = open(id, input).finally(() => state.opening.delete(id));
    state.opening.set(id, pending);
  }
  const s = await pending;
  s.failed = undefined;
  s.failures = 0;
  s.tolerant = undefined;
  s.lastRequest = Date.now();
  return { id, duration: s.duration, segments: s.segments };
}

async function open(id: string, input: OpenInput): Promise<Stream> {
  const bin = await ffmpegPath();
  if (!bin) throw Object.assign(new Error("ffmpeg is not installed"), { name: "FfmpegMissing" });
  const source = new URL(input.source);
  if (source.protocol !== "https:" && source.protocol !== "http:") throw new Error("The video source must be an http(s) URL.");

  const opened = (s: Stream, why: string) => {
    clog.info("stream opened", { stream: id, key: input.key, kind: s.kind, why, segments: s.segments });
    return s;
  };
  const live = state.streams.get(id);
  // Includes a fragmented stream whose fragment walk is still running (its index isn't saved yet).
  if (live && live.version === input.version) return opened(live, "already open");
  const meta = await readMeta(id);
  if (meta && meta.version === input.version && meta.bucket === input.bucket && meta.key === input.key) {
    if (live) return opened(live, "already open");
    const s = toStream(id, meta);
    state.streams.set(id, s);
    return opened(s, "saved on disk");
  }

  // New video, or the object changed since it was converted: start clean.
  if (live) stopRunner(live, "The file changed.");
  state.streams.delete(id);

  let why = MP4_LIKE.test(input.key) ? "empty file" : "not an MP4";
  // A fragmented MP4 streams as it is, without ffmpeg.
  if (MP4_LIKE.test(input.key) && input.size > 0) {
    const fragmented = await inspections.run(async () => {
      const reader = httpReader(source.toString(), input.size);
      const layout = await inspectMp4(reader, { maxMoovBytes: MAX_MOOV_READ }).catch((e: unknown) => {
        // ffprobe would scan the whole file looking for an index that isn't there.
        if (e instanceof Mp4Error && e.code === "no-index") throw new StreamError(e.message, 422);
        return null;
      });
      if (!layout) {
        why = "boxes unreadable";
        return null;
      }
      const mode = planFor(layout).mode;
      if (mode !== "fragments") {
        why = `plan is ${mode}`;
        return null;
      }
      const abort = new AbortController();
      try {
        const s = await openFragments(id, input, layout.duration, (update) => indexFragments(reader, layout, update, { signal: abort.signal }));
        if (await browserCanPlay(reader, s)) return s;
        why = "fragments not MSE-safe";
      } catch (e) {
        if (!(e instanceof FragmentsTooLarge)) throw e;
        why = "fragments too large";
      }
      // Fragments the rewrite can't make MSE-safe, or too big to buffer: convert with ffmpeg instead.
      abort.abort();
      state.streams.delete(id);
      return null;
    });
    if (fragmented) return opened(fragmented, "fragmented MP4");
  }

  const duration = await inspections.run(() => probeDuration(bin, source.toString()));
  await ensureRoot();
  const dir = dirOf(id);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const m: Meta = { bucket: input.bucket, key: input.key, version: input.version, duration, kind: "transcode" };
  await fs.writeFile(path.join(dir, META), JSON.stringify(m));
  const s = toStream(id, m);
  state.streams.set(id, s);
  void pruneConversions(id).catch(() => {});
  return opened(s, why);
}

/**
 * Sets up a fragmented MP4 stream. Returns once the start of the video is indexed; a walk of the
 * remaining fragments keeps extending the playlist, and the index is saved when it completes.
 */
async function openFragments(
  id: string,
  input: OpenInput,
  duration: number,
  index: (update: (i: FragmentIndex) => void) => Promise<FragmentIndex>,
): Promise<Stream> {
  await ensureRoot();
  const dir = dirOf(id);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const meta: Meta = { bucket: input.bucket, key: input.key, version: input.version, duration, kind: "fragments" };
  const s: Stream = { ...toStream(id, meta), kind: "fragments", segments: 0 };
  const update = (i: FragmentIndex) => {
    s.fragments = i;
    s.segments = i.segments.length;
    if (i.complete) {
      const last = i.segments.at(-1);
      if (last) s.duration = Math.max(s.duration, last.time + last.duration);
      void fs.writeFile(path.join(dir, META), JSON.stringify({ ...meta, duration: s.duration, fragments: i })).catch(() => {});
    }
  };
  await index(update);
  if (!s.segments) throw new StreamError("No playable fragments were found in this file.", 422);
  state.streams.set(id, s);
  return s;
}

/** Whether the first segment of a fragmented stream can be served in a form browsers accept. */
async function browserCanPlay(reader: ByteReader, s: Stream): Promise<boolean> {
  const first = s.fragments?.segments[0];
  if (!first) return false;
  // The first moof is enough to tell; its mdat is cut short, which the check tolerates.
  const bytes = await reader.read(first.offset, Math.min(first.size, 64 * 1024)).catch(() => null);
  return bytes !== null && mseSegment(new Uint8Array(bytes), first.offset) !== null;
}

/** Byte range of the original file for a fragmented stream's init segment or segment `name`. */
export function fragmentRange(s: Stream, name: string): { offset: number; size: number } | null {
  if (s.kind !== "fragments" || !s.fragments) return null;
  if (name === INIT_SEGMENT) return { offset: 0, size: s.fragments.initSize };
  const m = FRAGMENT.exec(name);
  const seg = m ? s.fragments.segments[Number(m[1])] : undefined;
  return seg ? { offset: seg.offset, size: seg.size } : null;
}

/**
 * The stream for a playlist or segment request, if `bucket` (the requester's connection) owns it.
 * Reloads it from disk after a server restart.
 */
export async function getStream(id: string, bucket: string): Promise<Stream | null> {
  if (!SAFE_JOB.test(id)) return null;
  let s = state.streams.get(id);
  if (!s) {
    const meta = await readMeta(id);
    if (!meta) return null;
    s = state.streams.get(id) ?? toStream(id, meta);
    state.streams.set(id, s);
  }
  return s.bucket === bucket ? s : null;
}

/** A VOD playlist for the whole video, available before anything is converted. */
export function playlistFor(s: Pick<Stream, "duration" | "segments"> & Partial<Pick<Stream, "kind" | "fragments" | "version">>): string {
  if (s.kind === "fragments" && s.fragments) return fragmentPlaylist(s.fragments, segmentTag(s.version ?? ""));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ];
  for (let n = 0; n < s.segments; n++) {
    const length = Math.min(SEGMENT_SECONDS, s.duration - n * SEGMENT_SECONDS);
    lines.push(`#EXTINF:${Math.max(0.1, length).toFixed(6)},`, segName(n));
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

/** fMP4 playlist over the file's own fragments. EVENT (growing) until the fragment walk completes. */
/** Bump when the bytes served for a fragment change (e.g. how moofs are rewritten), to bypass caches. */
const FRAGMENT_FORMAT = "mse1";

/** Query tag on fragment URLs: new URLs for a changed file or format, so segments can be cached. */
function segmentTag(version: string): string {
  return createHash("sha256").update(`${FRAGMENT_FORMAT}:${version}`).digest("hex").slice(0, 12);
}

function fragmentPlaylist(index: FragmentIndex, tag: string): string {
  const longest = index.segments.reduce((m, seg) => Math.max(m, seg.duration), 1);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${Math.ceil(longest)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXT-X-PLAYLIST-TYPE:${index.complete ? "VOD" : "EVENT"}`,
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-MAP:URI="${INIT_SEGMENT}?v=${tag}"`,
  ];
  index.segments.forEach((seg, n) => lines.push(`#EXTINF:${Math.max(0.01, seg.duration).toFixed(6)},`, `frag_${String(n).padStart(5, "0")}.m4s?v=${tag}`));
  if (index.complete) lines.push("#EXT-X-ENDLIST");
  lines.push("");
  return lines.join("\n");
}

export function streamStatus(id: string): { failed: boolean; error: string } {
  const s = state.streams.get(id);
  return s?.failed ? { failed: true, error: s.failed } : { failed: false, error: "" };
}

// ---------------------------------------------------------------- runners

function stopRunner(s: Stream, reason?: string): void {
  const r = s.runner;
  if (!isRunning(r)) return;
  r.stopReason ??= reason;
  r.proc.kill("SIGKILL");
}

/** Moves the runner's finished segments into the video's folder and advances `next`. */
async function collect(s: Stream, r: Runner): Promise<void> {
  const names = await fs.readdir(r.dir).catch(() => [] as string[]);
  for (const name of names) {
    const m = SEGMENT.exec(name);
    if (!m) continue; // playlist, or a segment still being written (.tmp)
    await fs.rename(path.join(r.dir, name), path.join(dirOf(s.id), name)).catch(() => {});
    r.next = Math.max(r.next, Number(m[1]) + 1);
  }
}

/** Runners of other videos; a video's own runner is replaced, so it never blocks itself. */
function runnersInUse(exceptId: string): number {
  let n = 0;
  for (const s of state.streams.values()) if (s.id !== exceptId && (isRunning(s.runner) || s.launching)) n++;
  return n;
}

/** Frees a slot held by a video nobody is loading. Returns whether one is free now. */
function claimSlot(forId: string, now: number): boolean {
  if (runnersInUse(forId) < maxConcurrentConversions()) return true;
  let victim: Stream | null = null;
  for (const s of state.streams.values()) {
    if (s.id === forId || !isRunning(s.runner) || now - s.lastRequest < EVICTABLE_MS) continue;
    if (!victim || s.lastRequest < victim.lastRequest) victim = s;
  }
  if (!victim) return false;
  clog.info("evicting runner", { stream: victim.id, key: victim.key, for: forId, idleMs: now - victim.lastRequest });
  stopRunner(victim, "Its slot went to another video.");
  // SIGKILL is immediate, but the exit event is async; count the slot as free now.
  victim.runner!.exitCode ??= 137;
  return true;
}

async function launch(s: Stream, start: number, source: string): Promise<void> {
  const bin = await ffmpegPath();
  if (!bin) throw new StreamError("ffmpeg isn’t installed on this machine.", 501);
  const dir = path.join(dirOf(s.id), `run-${++state.runnerSeq}`);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const at = start * SEGMENT_SECONDS;

  // Tolerant mode: ignore decode errors for files that are structurally valid but have corrupt
  // bitstream data (e.g. from de-identification tools that damaged H.264 NAL units).
  const tolerantArgs = s.tolerant ? ["-err_detect", "ignore_err", "-fflags", "+discardcorrupt"] : [];

  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    ...INPUT_ARGS,
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "10",
    ...(at > 0 ? ["-ss", String(at)] : []),
    ...tolerantArgs,
    "-i", source,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale='min(1920,iw)':-2,format=yuv420p",
    ...(await encoderArgs(bin)),
    "-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    "-c:a", "aac", "-b:a", "160k", "-ac", "2",
    "-output_ts_offset", String(at + TS_BASE),
    "-f", "hls", "-hls_time", String(SEGMENT_SECONDS), "-hls_list_size", "0",
    // Segments appear under their final name only once complete.
    "-hls_flags", "temp_file",
    "-start_number", String(start),
    "-hls_segment_filename", path.join(dir, "seg_%05d.ts"),
    path.join(dir, PLAYLIST),
  ];

  const log = createWriteStream(path.join(dir, "..", `ffmpeg-${start}.log`), { mode: 0o600 });
  log.on("error", () => {});
  const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  const r: Runner = { proc, dir, start, next: start, exitCode: null, startedAt: Date.now(), stderrTail: "", paused: false };
  s.runner = r;
  watchStderr(s, r, log);
  clog.info("ffmpeg started", { stream: s.id, key: s.key, start, tolerant: s.tolerant === true });

  let finished = false;
  const finish = async (code: number) => {
    if (finished) return;
    finished = true;
    r.flushLog?.();
    log.end();
    // Collect before marking it stopped, so nobody sees a stale `next` and calls a segment past the end.
    await collect(s, r);
    r.exitCode ??= code;
    const wrote = r.next > r.start;
    if (wrote) { s.failures = 0; s.tolerant = undefined; }
    else if (!r.stopReason || r.stopReason === UNDECODABLE_REASON) s.failures++;
    clog.info("ffmpeg exited", {
      stream: s.id,
      code: r.exitCode,
      segments: r.next - r.start,
      stop: r.stopReason,
      ms: Date.now() - r.startedAt,
      ...(wrote || r.stopReason ? {} : { stderr: lastLine(r.stderrTail) }),
    });
    if (r.stopReason === UNDECODABLE_REASON) {
      if (s.tolerant) {
        // Already tried with error-tolerant flags; the file truly can't be decoded.
        s.failed = UNDECODABLE_REASON;
        clog.warn("video undecodable", { stream: s.id, key: s.key, stderr: lastLine(r.stderrTail) });
      } else {
        // First failure: retry once with -err_detect ignore_err to handle partially-damaged files.
        s.tolerant = true;
        clog.warn("retrying tolerant", { stream: s.id, key: s.key, stderr: lastLine(r.stderrTail) });
      }
    }
    await fs.rm(r.dir, { recursive: true, force: true }).catch(() => {});
  };
  proc.on("exit", (code, signal) => void finish(code ?? (signal ? 137 : 1)));
  proc.on("error", () => void finish(1));
  hookShutdown();
  startWatchdog();
}

/**
 * Logs ffmpeg's stderr (capped), remembers its last lines, and stops a runner whose source can't be
 * decoded. At -loglevel error every line is an error; a healthy conversion prints none.
 */
function watchStderr(s: Stream, r: Runner, log: NodeJS.WritableStream): void {
  let logged = 0;
  let errors = 0;
  let checking = false;
  // ffmpeg prints its input URL, signature included; whole lines are redacted so no URL is split.
  let partial = "";
  const writeLog = (text: string) => {
    if (logged >= LOG_MAX_BYTES || !text) return;
    const part = Buffer.from(redact(text, Infinity)).subarray(0, LOG_MAX_BYTES - logged);
    log.write(part);
    logged += part.length;
  };
  r.flushLog = () => {
    writeLog(partial);
    partial = "";
  };
  r.proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    const lines = (partial + text).split("\n");
    partial = lines.pop() ?? "";
    // A line that never ends is logged in pieces rather than held in memory.
    if (partial.length > 64 * 1024) r.flushLog?.();
    if (lines.length) writeLog(lines.map((l) => `${l}\n`).join(""));
    r.stderrTail = (r.stderrTail + text).slice(-4096);
    for (const c of text) if (c === "\n") errors++;
    if (checking || r.next > r.start || errors < UNDECODABLE.errors || Date.now() - r.startedAt < UNDECODABLE.afterMs) return;
    checking = true;
    // Segments may be written but not collected yet; only a runner with nothing at all is judged.
    void collect(s, r).then(() => {
      checking = false;
      if (r.next === r.start) stopRunner(s, UNDECODABLE_REASON);
    });
  });
}

function lastLine(text: string): string {
  return redact(text.trim().split("\n").filter(Boolean).pop() ?? "");
}

function hookShutdown(): void {
  if (state.hooked) return;
  state.hooked = true;
  const killAll = () => {
    for (const s of state.streams.values()) if (isRunning(s.runner)) s.runner.proc.kill("SIGKILL");
  };
  process.once("exit", killAll);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      killAll();
      // If nobody else handles the signal, restore the default behavior (terminate).
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    });
  }
}

/** Stops runners nobody needs: idle videos, and runners far ahead of the player. */
export async function sweepConversions(now = Date.now()): Promise<void> {
  for (const s of state.streams.values()) {
    const r = s.runner;
    if (!isRunning(r)) continue;
    await collect(s, r);
    if (now - s.lastRequest > IDLE_MS) stopRunner(s, "Nobody was watching.");
    else pace(s);
  }
}

/**
 * Pauses the runner once it is RUNAHEAD_SEGMENTS ahead of the latest request, and continues it when
 * the player is within half that. If the paused connection to the bucket drops meanwhile, ffmpeg
 * reconnects (-reconnect); if its link has expired by then, it fails and the next request starts a
 * new runner with a fresh link.
 */
function pace(s: Stream): void {
  const r = s.runner;
  if (!isRunning(r)) return;
  const ahead = r.next - s.lastIndex;
  if (!r.paused && ahead > RUNAHEAD_SEGMENTS) {
    r.paused = r.proc.kill("SIGSTOP");
  } else if (r.paused && ahead <= RUNAHEAD_SEGMENTS / 2) {
    r.paused = !r.proc.kill("SIGCONT");
  }
}

function startWatchdog(): void {
  if (state.watchdog) return;
  let ticks = 0;
  state.watchdog = setInterval(() => {
    // The cache grows while videos play; check its caps about once a minute.
    if (++ticks % 12 === 0) void pruneConversions().catch(() => {});
    void sweepConversions().then(() => {
      let busy = false;
      for (const s of state.streams.values()) if (isRunning(s.runner)) busy = true;
      if (!busy && state.watchdog) {
        clearInterval(state.watchdog);
        state.watchdog = undefined;
      }
    });
  }, WATCHDOG_MS);
  state.watchdog.unref?.();
}

// ---------------------------------------------------------------- segments

export function segmentIndex(name: string): number | null {
  const m = SEGMENT.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * The path of segment `n`, converting it first if needed. `source` signs a fresh URL for a new
 * runner. Throws StreamError for anything the player should hear about.
 */
export async function segmentFile(
  s: Stream,
  n: number,
  source: () => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  if (!Number.isInteger(n) || n < 0 || n >= s.segments) throw new StreamError("No such segment.", 404);
  const file = path.join(dirOf(s.id), segName(n));
  const deadline = Date.now() + SEGMENT_WAIT_MS;
  s.lastRequest = Date.now();
  s.lastIndex = n;

  for (;;) {
    if (signal?.aborted) throw new StreamError("The request was cancelled.", 499);
    const r = s.runner;
    if (r) await collect(s, r);
    if (await exists(file)) {
      s.lastRequest = Date.now();
      return file;
    }
    if (s.failed) throw new StreamError(s.failed, 422);
    if (Date.now() > deadline) {
      clog.warn("segment timed out", { stream: s.id, segment: n, status: 504, runnerStart: r?.start, runnerNext: r?.next, paused: r?.paused });
      throw new StreamError("Converting this part of the video took too long.", 504);
    }

    const covering = isRunning(r) && n >= r.start && n <= r.next + FOLLOW_SEGMENTS;
    if (covering) pace(s);
    const endedHere = r !== null && r.exitCode === 0 && r.stopReason === undefined && r.start <= n && n >= r.next;
    if (endedHere) {
      // ffmpeg reached the end of the source before this segment: the video is shorter than probed.
      throw new StreamError("This segment is past the end of the video.", 404);
    }
    if (!covering && !s.launching) {
      if (s.failures >= MAX_FAILURES) {
        clog.warn("runner keeps failing", { stream: s.id, segment: n, status: 502, failures: s.failures, stderr: r ? lastLine(r.stderrTail) : undefined });
        throw new StreamError(`ffmpeg stopped before converting this video. ${r ? lastLine(r.stderrTail) : ""}`.trim(), 502);
      }
      if (claimSlot(s.id, Date.now())) {
        s.launching = true;
        try {
          stopRunner(s, "The player moved elsewhere.");
          await ensureRoot();
          await launch(s, n, await source());
        } finally {
          s.launching = false;
        }
        continue;
      }
    }
    await sleep(POLL_MS);
  }
}

/** Stops the runner after serving a segment if it's already far ahead of the player. */
export function afterServe(s: Stream): void {
  pace(s);
}

// ---------------------------------------------------------------- cache

async function dirInfo(id: string): Promise<{ id: string; bytes: number; mtime: number }> {
  const dir = dirOf(id);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const stats = await Promise.all(names.map((n) => fs.stat(path.join(dir, n)).catch(() => null)));
  let bytes = 0;
  let mtime = 0;
  for (const st of stats) {
    if (!st) continue;
    bytes += st.size;
    mtime = Math.max(mtime, st.mtimeMs);
  }
  return { id, bytes, mtime };
}

/** Removes old videos beyond the count, age and size caps. Videos being played are kept. */
export async function pruneConversions(active?: string): Promise<void> {
  const { keepJobs, maxAgeMs, maxCacheBytes } = limits();
  const ids = (await fs.readdir(ROOT).catch(() => [] as string[])).filter((n) => SAFE_JOB.test(n));
  const infos = (await Promise.all(ids.map(dirInfo))).sort((a, b) => b.mtime - a.mtime);
  const now = Date.now();
  let kept = 0;
  let total = 0;
  const removed: string[] = [];
  let removedBytes = 0;
  let trimmedBytes = 0;
  for (const info of infos) {
    const s = state.streams.get(info.id);
    const pinned = info.id === active || (s !== undefined && (isRunning(s.runner) || s.launching || now - s.lastRequest < IDLE_MS));
    if (!pinned && (kept >= keepJobs || now - info.mtime > maxAgeMs || total + info.bytes > maxCacheBytes)) {
      await fs.rm(dirOf(info.id), { recursive: true, force: true }).catch(() => {});
      state.streams.delete(info.id);
      removed.push(info.id);
      removedBytes += info.bytes;
      continue;
    }
    // One very long video being watched for hours can outgrow the whole cache on its own.
    if (s && info.bytes > maxCacheBytes) {
      const freed = await trimSegments(s, info.bytes - maxCacheBytes / 2);
      info.bytes -= freed;
      trimmedBytes += freed;
    }
    kept++;
    total += info.bytes;
  }
  if (removed.length || trimmedBytes) clog.debug("pruned conversions", { removed, removedBytes, trimmedBytes, kept, keptBytes: total });
}

/** Deletes a video's cached segments farthest from the player until `bytes` are freed. Returns bytes freed. */
async function trimSegments(s: Stream, bytes: number): Promise<number> {
  const dir = dirOf(s.id);
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => SEGMENT.test(n));
  const far = names
    .map((name) => ({ name, distance: Math.abs(segmentIndex(name)! - s.lastIndex) }))
    .sort((a, b) => b.distance - a.distance);
  let freed = 0;
  for (const { name, distance } of far) {
    // Never the part being watched and the next few minutes.
    if (freed >= bytes || distance <= RUNAHEAD_SEGMENTS) break;
    const st = await fs.stat(path.join(dir, name)).catch(() => null);
    await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
    freed += st?.size ?? 0;
  }
  return freed;
}
