import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyInventory, tallyFiles } from "@/lib/inventory";
import type { BucketHealth, BucketInventory, HealthProblem, HealthProblemKind } from "@/lib/types";
import { httpReader } from "./http-reader";
import { inspectMp4, Mp4Error, topLevel, type ByteReader } from "./mp4";
import { redact } from "./errors";
import { healthScans } from "./limits";
import { log } from "./log";
import { findIndexShift, looksLikeSamples } from "./playable";
import { ensurePrivateDir } from "./private-dir";
import { storageFor, type Storage } from "./storage";
import type { Connection } from "@/lib/types";

/**
 * Bucket health: a one-time check of every video in a bucket, run in the background the first time
 * the bucket is opened, saved on the server, and shown until someone asks for a new scan.
 *
 * Per video, a few small reads: the box layout, and the first bytes of the media data. Only files
 * that look wrong get the deep check (their index, and whole chunks) that tells damage apart from a
 * file that simply starts with audio. It reports what no viewer can fix, for the people who can:
 * empty uploads, files without an index, and damaged indexes (and whether Deccan Lens repairs them).
 */

const ROOT = process.env.LENS_HEALTH_DIR
  ? path.resolve(process.env.LENS_HEALTH_DIR)
  : path.join(process.env.LENS_HLS_DIR ? path.resolve(process.env.LENS_HLS_DIR) : path.join(os.tmpdir(), "deccan-lens-hls"), "health");
const LIST_CONCURRENCY = 16;
const CHECK_CONCURRENCY = 32;
const MP4_LIKE = new Set(["mp4", "m4v", "mov"]);
/** Largest index read for the deep check. */
const DEEP_MOOV_BYTES = 32 * 1024 * 1024;
const MAX_CHUNK_READ = 4 * 1024 * 1024;

type Progress = Extract<BucketHealth, { status: "running" }>["progress"];

const g = globalThis as unknown as { __lensHealth?: Map<string, { progress: Progress; done: Promise<void> }> };
const running = (g.__lensHealth ??= new Map());

const hlog = log.child({ scope: "health" });

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
// Per access key: a key that reads only part of the bucket gets a report of that part, and can't
// overwrite the report another key sees.
export const reportId = (c: Pick<Connection, "bucket" | "region" | "accessKeyId">) =>
  sha256(`${c.region}/${c.bucket}/${sha256(c.accessKeyId)}`).slice(0, 24);
const fileOf = (id: string) => path.join(ROOT, `${id}.json`);

async function readReport(id: string): Promise<Extract<BucketHealth, { status: "done" }> | null> {
  try {
    const r = JSON.parse(await fs.readFile(fileOf(id), "utf8")) as BucketHealth;
    return r.status === "done" ? r : null;
  } catch {
    return null;
  }
}

/**
 * The bucket's health: the saved report, the scan in progress, or none yet. `start` begins a scan
 * when there is no report (the first visit); `rescan` begins one regardless.
 */
export async function bucketHealth(
  c: Connection,
  { start = false, rescan = false, origin }: { start?: boolean; rescan?: boolean; origin: string },
): Promise<BucketHealth> {
  const id = reportId(c);
  const live = running.get(id);
  if (live) return { status: "running", progress: { ...live.progress } };
  const saved = rescan ? null : await readReport(id);
  if (saved) return saved;
  if (!start && !rescan) return { status: "none" };
  // Another request may have started the scan while the report was being read.
  const started = running.get(id);
  if (started) return { status: "running", progress: { ...started.progress } };
  const progress: Progress = { startedAt: new Date().toISOString(), folders: 0, videos: 0, checked: 0, inventory: emptyInventory() };
  hlog.info("scan started", { bucket: c.bucket, report: id, rescan });
  const done = healthScans
    .run(() => scan(storageFor(c), id, progress, origin, c.bucket))
    .catch(async (e) => {
      hlog.error("scan failed", { bucket: c.bucket, report: id, folders: progress.folders, videos: progress.videos, checked: progress.checked, err: e });
      const failed: BucketHealth = { status: "failed", error: redact(e instanceof Error ? e.message : String(e)), at: new Date().toISOString() };
      await save(id, failed).catch(() => {});
    })
    .finally(() => running.delete(id));
  running.set(id, { progress, done });
  return { status: "running", progress: { ...progress } };
}

async function save(id: string, report: BucketHealth): Promise<void> {
  await ensurePrivateDir(ROOT);
  const tmp = `${fileOf(id)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(report), { mode: 0o600 });
  await fs.rename(tmp, fileOf(id));
}

/** Runs `tasks` at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, each: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await each(items[next++]);
    }),
  );
}

interface Video {
  key: string;
  size: number;
  ext: string;
}

async function listBucket(storage: Storage, progress: Progress, bucket: string): Promise<{ videos: Video[]; inventory: BucketInventory }> {
  const done = hlog.time("listing done", { bucket });
  const videos: Video[] = [];
  // Counted into the progress, so the overview fills in while the listing runs, at no extra requests.
  const inventory = (progress.inventory ??= emptyInventory());
  const queue = [""];
  let active = 0;
  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      while (active < LIST_CONCURRENCY && queue.length) {
        const prefix = queue.shift()!;
        active++;
        (async () => {
          let cursor: string | null | undefined;
          do {
            const page = await storage.list(prefix, 5000, cursor);
            for (const f of page.folders) queue.push(f.prefix);
            progress.folders += page.folders.length;
            for (const f of page.files) if (f.kind === "video") videos.push({ key: f.key, size: f.size, ext: f.ext.toLowerCase() });
            progress.videos = videos.length;
            tallyFiles(inventory, page.files);
            cursor = page.truncated ? page.nextCursor : null;
          } while (cursor);
        })()
          .then(() => {
            active--;
            pump();
          }, reject);
      }
      if (!active && !queue.length) resolve();
    };
    pump();
  });
  done({ folders: progress.folders, videos: videos.length });
  return { videos, inventory };
}

/** First bytes of media data read as a length-prefixed NAL unit, as a first video sample usually does. */
function startsWithNal(b: Uint8Array): boolean {
  if (b.byteLength < 8) return false;
  const length = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0);
  return length > 0 && length < 16 * 1024 * 1024 && !(b[4] & 0x80) && (b[4] & 0x1f) !== 0;
}

async function check(storage: Storage, v: Video, origin: string): Promise<HealthProblem | null> {
  const problem = (kind: HealthProblemKind, detail: string): HealthProblem => ({ key: v.key, size: v.size, kind, detail });
  if (v.size === 0) return problem("empty", "The file is 0 bytes.");
  // Other containers (AVI, MKV…) play through conversion; their structure isn't checked here.
  if (!MP4_LIKE.has(v.ext)) return null;
  // Signed-URL range reads (lighter than SDK calls), each range read once: the layout check and the
  // box walk ask for the same headers.
  const base = httpReader(new URL(await storage.signedUrl(v.key, { expiresIn: 3600 }), origin).toString(), v.size);
  const seen = new Map<string, Promise<Uint8Array>>();
  const r: ByteReader = {
    size: v.size,
    read: (o, n) => {
      const k = `${o}:${n}`;
      let hit = seen.get(k);
      if (!hit) seen.set(k, (hit = base.read(o, n)));
      return hit;
    },
  };
  try {
    const layout = await inspectMp4(r, { maxMoovBytes: 0 });
    if (layout.fragmented) return null;
    const boxes = await topLevel(r, 0, { limit: 8 });
    const mdat = boxes.find((b) => b.type === "mdat");
    if (!mdat || startsWithNal(await r.read(mdat.start + mdat.headerSize, 16))) return null;

    // Looks wrong at a glance (or starts with audio): check the first video chunk itself.
    const full = await inspectMp4(r, { maxMoovBytes: DEEP_MOOV_BYTES });
    const first = full.video?.chunks.find((c) => c.size > 0);
    if (!first || first.size > MAX_CHUNK_READ || (full.video?.codec !== "avc1" && full.video?.codec !== "hvc1")) return null;
    if (looksLikeSamples(await r.read(first.offset, first.size))) return null;
    const shift = await findIndexShift(r, full);
    return shift
      ? problem("repairable", `The index points ${shift.shift.toLocaleString("en-US")} bytes off for the first ${shift.chunks.toLocaleString("en-US")} chunks. Deccan Lens corrects this when playing; re-export the file to fix it for every player.`)
      : problem("damaged", "The index doesn’t point at video data, and the damage isn’t one Deccan Lens can correct.");
  } catch (e) {
    if (e instanceof Mp4Error && e.code === "no-index") return problem("no-index", e.message);
    return problem("unreadable", e instanceof Error ? e.message.slice(0, 200) : "The file couldn’t be read.");
  }
}

async function scan(storage: Storage, id: string, progress: Progress, origin: string, bucket: string): Promise<void> {
  const listStart = performance.now();
  const { videos, inventory } = await listBucket(storage, progress, bucket);
  const listMs = Math.round(performance.now() - listStart);
  progress.checkingSince = new Date().toISOString();
  const checkStart = performance.now();
  const problems: HealthProblem[] = [];
  let bytes = 0;
  let failed = 0;
  await pool(videos, CHECK_CONCURRENCY, async (v) => {
    bytes += v.size;
    const p = await check(storage, v, origin).catch((e: unknown) => {
      failed++;
      hlog.warn("check threw", { bucket, key: v.key, size: v.size, err: e });
      return null;
    });
    if (p) problems.push(p);
    progress.checked++;
    if (progress.checked % 500 === 0) hlog.info("scan progress", { bucket, checked: progress.checked, videos: videos.length, problems: problems.length });
  });
  const checkMs = Math.round(performance.now() - checkStart);
  problems.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  const count = (k: HealthProblemKind) => problems.filter((p) => p.kind === k).length;
  const totals = {
    folders: progress.folders,
    videos: videos.length,
    bytes,
    empty: count("empty"),
    noIndex: count("no-index"),
    repairable: count("repairable"),
    damaged: count("damaged"),
    unreadable: count("unreadable"),
  };
  await save(id, {
    status: "done",
    startedAt: progress.startedAt,
    finishedAt: new Date().toISOString(),
    totals,
    problems,
    inventory,
  });
  hlog.info("scan finished", { bucket, report: id, ...totals, checkFailed: failed, listMs, checkMs });
}

// One file's line in the saved check, without starting a scan. Files not in `problems` passed.
export async function fileHealth(c: Connection, key: string): Promise<import("@/lib/file-details").FileHealth> {
  const id = reportId(c);
  if (running.has(id)) return { status: "running" };
  const saved = await readReport(id);
  if (!saved) return { status: "none" };
  return { status: "done", startedAt: saved.startedAt, finishedAt: saved.finishedAt, problem: saved.problems.find((p) => p.key === key) ?? null };
}
