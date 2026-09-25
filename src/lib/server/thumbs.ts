import "server-only";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { IMAGE_PREVIEW_MAX_BYTES, PDF_PREVIEW_MAX_BYTES, THUMB_WIDTH } from "@/lib/previews";
import { ffmpegPath, INPUT_ARGS } from "./convert";
import { virtualRange, type VirtualMp4 } from "./playable";

// A file the tool can't read is remembered for FAILED_TTL_MS, so scrolling past it again doesn't read it
// from the bucket again. Timeouts aren't remembered: they may be the network.

const run = promisify(execFile);
const JOB_TIMEOUT_MS = 20_000;
const FAILED_TTL_MS = 6 * 3600_000;
// Part of every cache key: bump it when the output changes (size, format, seek rule).
const FORMAT = `${THUMB_WIDTH}-v2`;
// Past a fade-in or black first frame, before much has to be read.
const FRAME_AT_SECONDS = 1;
// Enough of a tool's stderr for ffmpeg's input summary (duration, pixel format), never sent anywhere.
const STDERR_BYTES = 16 * 1024;
const PRUNE_EVERY = 20;
const SAFE_ID = /^[0-9a-f]{32}$/;
// One read that holds the ftyp and a fragmented file's small moov.
export const HEAD_BYTES = 64 * 1024;
const MP4_EXTS = new Set(["mp4", "m4v", "mov", "3gp"]);
const IMAGE_DEMUXERS = "png_pipe,jpeg_pipe,webp_pipe,gif,gif_pipe,bmp_pipe,mov,mp4";

export type ThumbKind = "video" | "pdf" | "image";

export function thumbId(bucket: string, key: string, version: string): string {
  return createHash("sha256").update(JSON.stringify([bucket, key, version, FORMAT])).digest("hex").slice(0, 32);
}

// A job mostly waits on the bucket, so more run than there are cores to spare; each ffmpeg holds one frame.
export function maxThumbJobs(cpus = os.availableParallelism()): number {
  const n = envNumber("LENS_THUMB_JOBS", Math.min(8, Math.max(2, cpus)));
  return Math.max(1, Math.floor(n));
}

// The length isn't known before ffmpeg opens the file, and probing it first would read the index twice
// (157 MB for a 40-hour MP4), so the first try is FRAME_AT_SECONDS; a shorter clip retries at 10%.
export function frameSeekSeconds(duration: number | null): number {
  if (duration === null || !Number.isFinite(duration)) return FRAME_AT_SECONDS;
  if (duration <= 0) return 0;
  return duration < FRAME_AT_SECONDS * 10 ? duration * 0.1 : FRAME_AT_SECONDS;
}

// From ffmpeg's "Duration: 00:01:02.50, start: …" line.
export function parseDuration(stderr: string): number | null {
  const m = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export type HeadLayout = "fragmented" | "indexed" | "unknown";

// From the first bytes of an MP4. ffmpeg seeks a fragmented file by visiting every moof (one read each:
// 62 reads, 4 s for 2 minutes), so those are read front to back instead.
export function mp4HeadLayout(head: Uint8Array): HeadLayout {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const type = (at: number) => String.fromCharCode(head[at], head[at + 1], head[at + 2], head[at + 3]);
  const boxAt = (at: number, end: number) => {
    if (at + 8 > end) return null;
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return null;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = Infinity;
    const t = type(at + 4);
    return size < header || !/^[\x20-\x7e]{4}$/.test(t) ? null : { type: t, size, header };
  };
  for (let at = 0; ; ) {
    const box = boxAt(at, head.byteLength);
    if (!box) return "unknown";
    if (box.type === "moof" || box.type === "styp" || box.type === "sidx") return "fragmented";
    if (box.type === "mdat") return "indexed";
    if (box.type === "moov") {
      const end = Math.min(head.byteLength, at + box.size);
      for (let c = at + box.header; ; ) {
        const child = boxAt(c, end);
        // A moov bigger than the head has sample tables: fragmented ones are a few KB.
        if (!child) return "indexed";
        if (child.type === "mvex") return "fragmented";
        c += child.size;
      }
    }
    at += box.size;
  }
}

export interface FrameInput {
  // An http(s) URL, or "pipe:0" when the bytes are written to ffmpeg's stdin.
  source: string;
  at: number;
  // False reads the file front to back in one request, decoding up to `at`.
  seekable: boolean;
}

export function frameArgs({ source, at, seekable }: FrameInput, out: string): string[] {
  const ss = ["-ss", at.toFixed(3)];
  const input =
    source === "pipe:0"
      ? ["-protocol_whitelist", "pipe", "-f", "mov", "-i", source]
      : [...INPUT_ARGS, ...(seekable ? ss : ["-seekable", "0"]), "-i", source];
  // Seeking on the input jumps to the keyframe before `at` using the index: ffmpeg reads the
  // index and one GOP, not the video up to `at`. Without seeking, it decodes up to `at` (an input seek fails).
  return [
    "-hide_banner", "-nostdin", "-nostats", "-loglevel", "info",
    ...input,
    ...(!seekable && at > 0 ? ss : []),
    "-map", "0:v:0", "-an", "-sn", "-dn",
    "-frames:v", "1",
    "-vf", `scale='min(${THUMB_WIDTH},iw)':-2`,
    "-c:v", "mjpeg", "-q:v", "5",
    "-f", "image2", "-update", "1", "-y", out,
  ];
}

// The pixel format in ffmpeg's summary of the first video stream, e.g. "Video: png, rgba(pc), 64x64".
export function hasAlpha(stderr: string): boolean {
  const m = /Stream #0:\d+[^:]*: Video: [^,]+, (\w+)/.exec(stderr);
  return m !== null && /^(rgba|bgra|argb|abgr|ya\d|yuva|gbrap|pal8)/.test(m[1]);
}

// Cached thumbnails are JPEG, or PNG for images with transparency.
export function thumbContentType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

export interface JobQueue {
  // Callers with the same id share one run. Resolves null when `signal` aborts first; the run is dropped
  // if nobody else waits and it hasn't started.
  run(id: string, task: () => Promise<string | null>, signal?: AbortSignal): Promise<string | null>;
  readonly running: number;
  readonly queued: number;
}

interface Job {
  id: string;
  task: () => Promise<string | null>;
  waiters: number;
  started: boolean;
  done: Promise<string | null>;
  resolve: (v: string | null) => void;
}

export function createJobQueue(limit: number): JobQueue {
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let running = 0;

  const pump = () => {
    while (running < limit && queue.length > 0) {
      const job = queue.shift()!;
      job.started = true;
      running++;
      job
        .task()
        .catch(() => null)
        .then((v) => {
          running--;
          jobs.delete(job.id);
          job.resolve(v);
          pump();
        });
    }
  };

  return {
    get running() {
      return running;
    },
    get queued() {
      return queue.length;
    },
    run(id, task, signal) {
      let job = jobs.get(id);
      if (!job) {
        let resolve!: (v: string | null) => void;
        const done = new Promise<string | null>((r) => (resolve = r));
        job = { id, task, waiters: 0, started: false, done, resolve };
        jobs.set(id, job);
        queue.push(job);
      }
      const j = job;
      j.waiters++;
      return new Promise((resolve) => {
        let settled = false;
        const settle = (v: string | null) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          resolve(v);
        };
        const onAbort = () => {
          j.waiters--;
          if (j.waiters === 0 && !j.started) {
            queue.splice(queue.indexOf(j), 1);
            jobs.delete(j.id);
            j.resolve(null);
          }
          settle(null);
        };
        void j.done.then(settle);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
        pump();
      });
    },
  };
}

type State = { queue: JobQueue; writes: number; procs: Set<ChildProcess>; pdftoppm?: Promise<string | null>; hooked?: boolean };
// Survives dev hot reloads; a queue from an older version of this file is replaced.
const g = globalThis as unknown as { __lensThumbs?: State; __lensThumbsFormat?: string };
if (g.__lensThumbsFormat !== FORMAT) g.__lensThumbs = undefined;
g.__lensThumbsFormat = FORMAT;
const state: State = (g.__lensThumbs ??= { queue: createJobQueue(maxThumbJobs()), writes: 0, procs: new Set() });

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function thumbsRoot(): string {
  if (process.env.LENS_THUMBS_DIR) return path.resolve(process.env.LENS_THUMBS_DIR);
  // Conversion pruning only touches its own job folders, so this can share the volume.
  if (process.env.LENS_HLS_DIR) return path.join(path.resolve(process.env.LENS_HLS_DIR), "thumbs");
  return path.join(os.tmpdir(), "deccan-lens-thumbs");
}

// The cache folder must be a real directory owned by us: /tmp is shared with other users.
async function ensureRoot(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const st = await fs.lstat(root);
  const uid = process.getuid?.();
  if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) {
    throw new Error(`The thumbnail folder ${root} isn't a directory owned by this user.`);
  }
}

// pdftoppm comes from poppler-utils, which may not be installed.
export function pdftoppmPath(): Promise<string | null> {
  state.pdftoppm ??= (async () => {
    const bin = process.env.PDFTOPPM_PATH || "pdftoppm";
    try {
      await run(bin, ["-v"], { timeout: 10_000 });
      return bin;
    } catch {
      return null;
    }
  })();
  return state.pdftoppm;
}

function hookShutdown(): void {
  if (state.hooked) return;
  state.hooked = true;
  process.once("exit", () => {
    for (const p of state.procs) p.kill("SIGKILL");
  });
}

interface ToolRun {
  code: number | null;
  stderr: string;
}

// Never rejects. `input` is written to stdin until the tool exits.
function runTool(bin: string, args: string[], signal: AbortSignal, input?: (signal: AbortSignal) => AsyncIterable<Uint8Array>): Promise<ToolRun> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve({ code: null, stderr: "" });
    const proc = spawn(bin, args, { stdio: [input ? "pipe" : "ignore", "ignore", "pipe"] });
    state.procs.add(proc);
    hookShutdown();
    const feeding = new AbortController();
    if (input && proc.stdin) {
      proc.stdin.on("error", () => {});
      void pipeline(Readable.from(input(feeding.signal)), proc.stdin).catch(() => {});
    }
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_BYTES) stderr += chunk.toString("utf8").slice(0, STDERR_BYTES - stderr.length);
    });
    const kill = () => proc.kill("SIGKILL");
    signal.addEventListener("abort", kill, { once: true });
    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      feeding.abort();
      signal.removeEventListener("abort", kill);
      state.procs.delete(proc);
      resolve({ code, stderr });
    };
    proc.on("error", () => finish(null));
    proc.on("close", (code) => finish(code));
  });
}

const nonEmpty = (file: string) => fs.stat(file).then((s) => s.isFile() && s.size > 0, () => false);

type Outcome = "ok" | "failed" | "timeout";

async function readHead(source: string, signal: AbortSignal): Promise<HeadLayout> {
  try {
    const res = await fetch(source, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` }, cache: "no-store", signal });
    if (res.status !== 206 && res.status !== 200) {
      await res.body?.cancel();
      return "unknown";
    }
    // A server that ignores Range sends the whole object; the head is all that's needed.
    const reader = res.body!.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    while (got < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.byteLength;
    }
    void reader.cancel().catch(() => {});
    return mp4HeadLayout(Buffer.concat(parts).subarray(0, HEAD_BYTES));
  } catch {
    return "unknown";
  }
}

// The fixed file (index moved to the front, offsets repaired) streamed in order, fetching its file ranges.
function virtualBytes(v: VirtualMp4, source: string) {
  return async function* (signal: AbortSignal): AsyncIterable<Uint8Array> {
    for (const part of virtualRange(v, 0, v.size - 1)) {
      if ("bytes" in part) {
        yield part.bytes;
        continue;
      }
      const [a, b] = part.file;
      const res = await fetch(source, { headers: { Range: `bytes=${a}-${b}` }, cache: "no-store", signal });
      if (res.status !== 206 || !res.body) throw new Error(`The file answered ${res.status} to a byte-range read.`);
      yield* res.body as unknown as AsyncIterable<Uint8Array>;
    }
  };
}

const ok = async (r: ToolRun, out: string) => r.code === 0 && (await nonEmpty(out));

export interface VideoOptions {
  // An MP4 family container: its head is checked for fragments, and a failed read tries the fixed index.
  mp4?: boolean;
  // The file with its index fixed (playable.ts), or null when it needs no fixing or can't be fixed.
  repaired?: () => Promise<VirtualMp4 | null>;
}

export async function makeVideoFrame(bin: string, source: string, out: string, signal: AbortSignal, opts: VideoOptions = {}): Promise<Outcome> {
  const grab = (input: FrameInput, s: AbortSignal, feed?: (s: AbortSignal) => AsyncIterable<Uint8Array>) =>
    runTool(bin, frameArgs(input, out), s, feed);

  // The head is read alongside the first try, so an ordinary file doesn't wait on it.
  const sniff = new AbortController();
  const direct = new AbortController();
  const stop = () => (sniff.abort(), direct.abort());
  signal.addEventListener("abort", stop, { once: true });
  try {
    const layout = opts.mp4 ? readHead(source, sniff.signal) : Promise.resolve<HeadLayout>("unknown");
    const first = grab({ source, at: FRAME_AT_SECONDS, seekable: true }, direct.signal);
    const fragmented = await Promise.race([layout.then((l) => l === "fragmented"), first.then(() => false)]);
    if (fragmented) direct.abort();
    const tried = await first;
    if (!fragmented && (await ok(tried, out))) return "ok";
    if (signal.aborted) return "timeout";

    if (fragmented || (await layout) === "fragmented") {
      for (const at of [FRAME_AT_SECONDS, 0]) {
        if (await ok(await grab({ source, at, seekable: false }, signal), out)) return "ok";
        if (signal.aborted) return "timeout";
      }
      return "failed";
    }

    const duration = parseDuration(tried.stderr);
    const at = frameSeekSeconds(duration);
    // A long video that failed at 1 s is broken, not short; trying again would re-read its index.
    if (duration !== null && at < FRAME_AT_SECONDS) {
      if (await ok(await grab({ source, at, seekable: true }, signal), out)) return "ok";
      if (signal.aborted) return "timeout";
    }

    // A damaged index (bytes inserted before the media) decodes nothing until playable.ts repairs it.
    const fixed = opts.mp4 && opts.repaired ? await opts.repaired().catch(() => null) : null;
    if (signal.aborted) return "timeout";
    if (!fixed) return "failed";
    for (const at of [FRAME_AT_SECONDS, 0]) {
      if (await ok(await grab({ source: "pipe:0", at, seekable: false }, signal, virtualBytes(fixed, source)), out)) return "ok";
      if (signal.aborted) return "timeout";
    }
    return "failed";
  } finally {
    signal.removeEventListener("abort", stop);
    sniff.abort();
  }
}

async function fetchCapped(source: string, maxBytes: number, signal: AbortSignal): Promise<Response | null> {
  const res = await fetch(source, { signal, cache: "no-store" });
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return null;
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body.cancel();
    return null;
  }
  return res;
}

function capped(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      cb(seen > maxBytes ? new Error("The file is larger than it said.") : null, chunk);
    },
  });
}

async function download(source: string, file: string, maxBytes: number, signal: AbortSignal): Promise<boolean> {
  const res = await fetchCapped(source, maxBytes, signal);
  if (!res) return false;
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), capped(maxBytes), createWriteStream(file, { mode: 0o600 }), {
    signal,
  });
  return true;
}

// Not pdf.js in the browser: that needs CORS on the bucket, a ~1 MB library, and re-reads on every visit.
// pdftoppm needs a seekable file (the page index is at the end), so the PDF is downloaded first.
export async function makePdfPage(bin: string, source: string, out: string, signal: AbortSignal): Promise<Outcome> {
  const base = out.replace(/\.jpg$/, "");
  const pdf = `${base}.pdf`;
  try {
    if (!(await download(source, pdf, PDF_PREVIEW_MAX_BYTES, signal))) return signal.aborted ? "timeout" : "failed";
    // pdftoppm writes `${base}.jpg`, which is `out`.
    const r = await runTool(
      bin,
      ["-f", "1", "-l", "1", "-singlefile", "-jpeg", "-jpegopt", "quality=80", "-scale-to-x", String(THUMB_WIDTH), "-scale-to-y", "-1", pdf, base],
      signal,
    );
    if (signal.aborted) return "timeout";
    return r.code === 0 && (await nonEmpty(out)) ? "ok" : "failed";
  } catch {
    return signal.aborted ? "timeout" : "failed";
  } finally {
    await fs.rm(pdf, { force: true }).catch(() => {});
  }
}

// A camera photo is several MB and costs the browser a full-size decode per tile; this is ~20 KB.
// One decode, two encodes: the PNG is kept only when the image has transparency.
export async function makeImageThumb(bin: string, source: string, out: string, signal: AbortSignal): Promise<Outcome> {
  const png = out.replace(/\.jpg$/, ".png");
  const scale = `scale=w='min(${THUMB_WIDTH},iw)':h='min(${THUMB_WIDTH * 2},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  try {
    const res = await fetchCapped(source, IMAGE_PREVIEW_MAX_BYTES, signal);
    if (!res) return signal.aborted ? "timeout" : "failed";
    const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream).pipe(capped(IMAGE_PREVIEW_MAX_BYTES));
    const r = await runTool(
      bin,
      [
        "-hide_banner", "-nostdin", "-nostats", "-loglevel", "info",
        "-protocol_whitelist", "pipe", "-format_whitelist", IMAGE_DEMUXERS,
        "-i", "pipe:0",
        "-map", "0:v:0", "-frames:v", "1", "-vf", scale, "-c:v", "mjpeg", "-q:v", "4", "-f", "image2", "-update", "1", "-y", out,
        "-map", "0:v:0", "-frames:v", "1", "-vf", scale, "-c:v", "png", "-f", "image2", "-update", "1", "-y", png,
      ],
      signal,
      () => body,
    );
    if (signal.aborted) return "timeout";
    if (r.code !== 0) return "failed";
    if (hasAlpha(r.stderr) && (await nonEmpty(png))) await fs.rename(png, out);
    return (await nonEmpty(out)) ? "ok" : "failed";
  } catch {
    return signal.aborted ? "timeout" : "failed";
  } finally {
    await fs.rm(png, { force: true }).catch(() => {});
  }
}

export interface ThumbInput {
  bucket: string;
  key: string;
  // Size + modified time from HeadObject.
  version: string;
  kind: ThumbKind;
  // Lower-case extension, which picks the MP4 handling.
  ext?: string;
  // An absolute http(s) URL the tool can read the object from, signed only when a job runs.
  source: () => Promise<string>;
  // The MP4 with its index fixed, read through `source`.
  repaired?: (source: string) => Promise<VirtualMp4 | null>;
  // The request; when it goes away before the job starts, the job is dropped.
  signal?: AbortSignal;
}

export function thumbPaths(bucket: string, key: string, version: string, root = thumbsRoot()) {
  const id = thumbId(bucket, key, version);
  return { id, file: path.join(root, `${id}.img`), failed: path.join(root, `${id}.none`) };
}

// Null when the tool is missing, the file can't be read, it took too long, or the request went away.
export async function thumbnailFor(input: ThumbInput): Promise<string | null> {
  const bin = input.kind === "pdf" ? await pdftoppmPath() : await ffmpegPath();
  if (!bin) return null;

  const root = thumbsRoot();
  const { id, file, failed } = thumbPaths(input.bucket, input.key, input.version, root);

  if (await nonEmpty(file)) {
    // Pruning removes the least recently used first.
    const now = new Date();
    await fs.utimes(file, now, now).catch(() => {});
    return file;
  }
  const marker = await fs.stat(failed).catch(() => null);
  if (marker && Date.now() - marker.mtimeMs < FAILED_TTL_MS) return null;

  return state.queue.run(
    id,
    async () => {
      await ensureRoot(root);
      if (await nonEmpty(file)) return file;
      const tmp = path.join(root, `${id}.${randomBytes(6).toString("hex")}.tmp.jpg`);
      const signal = AbortSignal.timeout(JOB_TIMEOUT_MS);
      try {
        const source = new URL(await input.source());
        if (source.protocol !== "https:" && source.protocol !== "http:") return null;
        const url = source.toString();
        let outcome: Outcome;
        if (input.kind === "video") {
          const repaired = input.repaired;
          outcome = await makeVideoFrame(bin, url, tmp, signal, {
            mp4: MP4_EXTS.has(input.ext ?? ""),
            repaired: repaired && (() => repaired(url)),
          });
        } else if (input.kind === "image") {
          outcome = await makeImageThumb(bin, url, tmp, signal);
        } else {
          outcome = await makePdfPage(bin, url, tmp, signal);
        }
        if (outcome === "failed") await fs.writeFile(failed, "").catch(() => {});
        if (outcome !== "ok") return null;
        await fs.rename(tmp, file);
        await fs.rm(failed, { force: true }).catch(() => {});
        if (++state.writes % PRUNE_EVERY === 0) void pruneThumbs().catch(() => {});
        return file;
      } catch {
        return null;
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    },
    input.signal,
  );
}

export async function pruneThumbs(now = Date.now()): Promise<void> {
  const root = thumbsRoot();
  const maxBytes = envNumber("LENS_THUMBS_MAX_MB", 256) * 1024 * 1024;
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const kept: { name: string; size: number; mtime: number }[] = [];
  for (const name of names) {
    const id = name.slice(0, 32);
    if (!SAFE_ID.test(id)) continue;
    const full = path.join(root, name);
    const st = await fs.stat(full).catch(() => null);
    if (!st?.isFile()) continue;
    const age = now - st.mtimeMs;
    const stale =
      (name.endsWith(".none") && age > FAILED_TTL_MS) ||
      ((name.includes(".tmp.") || name.endsWith(".pdf")) && age > JOB_TIMEOUT_MS * 3) ||
      // Thumbnails from before the format moved to .img.
      name === `${id}.jpg`;
    if (stale) await fs.rm(full, { force: true }).catch(() => {});
    else if (name.endsWith(".img")) kept.push({ name, size: st.size, mtime: st.mtimeMs });
  }
  kept.sort((a, b) => b.mtime - a.mtime);
  let total = 0;
  for (const t of kept) {
    total += t.size;
    if (total > maxBytes) await fs.rm(path.join(root, t.name), { force: true }).catch(() => {});
  }
}
