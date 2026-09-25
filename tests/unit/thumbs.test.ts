import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { previewVersion } from "@/lib/previews";
import type { Connection } from "@/lib/types";
import { FIXTURES, makeBucket, type TempBucket } from "./helpers/bucket";

const session = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock("@/lib/server/session", () => ({ getConnection: async () => session.connection }));

import { GET as mockGET } from "@/app/api/mock/route";
import { GET as thumbGET } from "@/app/api/thumb/route";
import {
  createJobQueue,
  frameArgs,
  frameSeekSeconds,
  hasAlpha,
  HEAD_BYTES,
  maxThumbJobs,
  mp4HeadLayout,
  parseDuration,
  thumbContentType,
  thumbId,
} from "@/lib/server/thumbs";
import { scatter, shiftedStart } from "./helpers/mp4-damage";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const VIDEOS = ["episode_0001_pick_and_place.mp4", "episode_0002_conveyor_sort.avi", "episode_0003_forklift_route_b.webm"];
const hasFixtures = VIDEOS.every((v) => existsSync(path.join(FIXTURES, "Factory", v)));

const CONNECTION: Connection = {
  accessKeyId: "AKIAFAKEFAKEFAKE12",
  secretAccessKey: "secret",
  bucket: "deccan-demo",
  region: "ap-south-1",
};

describe("cache ids and seek times", () => {
  it("derives a safe id per bucket, key and version", () => {
    const id = thumbId("b", "Factory/a b.mp4", "10:2026-01-01T00:00:00.000Z");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(thumbId("b", "Factory/a b.mp4", "10:2026-01-01T00:00:00.000Z")).toBe(id);
    expect(thumbId("b", "Factory/a b.mp4", "11:2026-01-01T00:00:00.000Z")).not.toBe(id);
    expect(thumbId("other", "Factory/a b.mp4", "10:2026-01-01T00:00:00.000Z")).not.toBe(id);
    expect(thumbId("b", "Factory/a b.mp4 ", "10:2026-01-01T00:00:00.000Z")).not.toBe(id);
  });

  it("seeks 1 s in, 10% into short clips, and to the start of empty ones", () => {
    expect(frameSeekSeconds(null)).toBe(1);
    expect(frameSeekSeconds(Number.NaN)).toBe(1);
    expect(frameSeekSeconds(3600)).toBe(1);
    expect(frameSeekSeconds(10)).toBe(1);
    expect(frameSeekSeconds(5)).toBeCloseTo(0.5);
    expect(frameSeekSeconds(0.4)).toBeCloseTo(0.04);
    expect(frameSeekSeconds(0)).toBe(0);
  });

  it("reads the length from ffmpeg's input summary", () => {
    expect(parseDuration("Input #0, mov,mp4\n  Duration: 00:00:08.00, start: 0.000000, bitrate: 2927 kb/s")).toBe(8);
    expect(parseDuration("  Duration: 40:00:01.50, start: 0")).toBeCloseTo(144001.5);
    expect(parseDuration("  Duration: N/A, bitrate: N/A")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});

// A box: 4-byte size, 4-byte type, payload.
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const size = 8 + payload.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  let at = 8;
  for (const p of payload) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
const concat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const bytes = (n: number) => new Uint8Array(n);

describe("how a video frame is read", () => {
  const ftyp = box("ftyp", bytes(16));

  it("reads a fragmented MP4 front to back, and seeks anything with sample tables", () => {
    // ffmpeg's empty_moov output: a small moov with mvex, then fragments.
    expect(mp4HeadLayout(concat(ftyp, box("moov", box("mvhd", bytes(100)), box("trak", bytes(400)), box("mvex", box("trex", bytes(24)))), box("moof", bytes(64))))).toBe("fragmented");
    expect(mp4HeadLayout(concat(box("styp", bytes(8)), box("sidx", bytes(32))))).toBe("fragmented");
    expect(mp4HeadLayout(concat(ftyp, box("moov", box("mvhd", bytes(100)), box("trak", bytes(400))), box("mdat", bytes(64))))).toBe("indexed");
    // Index at the end (or behind thousands of free boxes): the mdat comes first.
    expect(mp4HeadLayout(concat(ftyp, box("free", bytes(0)), box("mdat", bytes(64))))).toBe("indexed");
    // A moov larger than the head has sample tables.
    const big = box("moov", box("mvhd", bytes(100)), box("trak", bytes(HEAD_BYTES * 2)));
    expect(mp4HeadLayout(concat(ftyp, big).subarray(0, HEAD_BYTES))).toBe("indexed");
    expect(mp4HeadLayout(new Uint8Array(64).fill(0xab))).toBe("unknown");
    expect(mp4HeadLayout(new Uint8Array(0))).toBe("unknown");
  });

  it("seeks with the index, or reads in one request, or takes the fixed file on stdin", () => {
    const seek = frameArgs({ source: "https://b/x.mp4", at: 1, seekable: true }, "/o.jpg");
    expect(seek).not.toContain("-seekable");
    expect(seek.slice(seek.indexOf("-ss"), seek.indexOf("-ss") + 4)).toEqual(["-ss", "1.000", "-i", "https://b/x.mp4"]);
    expect(seek).toContain("http,https,tcp,tls");
    const linear = frameArgs({ source: "https://b/x.mp4", at: 1, seekable: false }, "/o.jpg");
    expect(linear[linear.indexOf("-seekable") + 1]).toBe("0");
    // ffmpeg can't seek what it can't seek back in: it decodes up to the time instead.
    expect(linear.indexOf("-ss")).toBeGreaterThan(linear.indexOf("-i"));
    const piped = frameArgs({ source: "pipe:0", at: 0, seekable: false }, "/o.jpg");
    expect(piped.slice(piped.indexOf("-protocol_whitelist"), piped.indexOf("-protocol_whitelist") + 4)).toEqual(["-protocol_whitelist", "pipe", "-f", "mov"]);
    expect(piped).not.toContain("http,https,tcp,tls");
    expect(piped).not.toContain("-ss");
    for (const args of [seek, linear, piped]) expect(args.at(-1)).toBe("/o.jpg");
  });

  it("keeps transparency only where the source has it", () => {
    expect(hasAlpha("Stream #0:0: Video: png, rgba(pc, gbr/unknown/unknown), 64x64, 25 fps")).toBe(true);
    expect(hasAlpha("Stream #0:0: Video: gif, pal8, 100x100")).toBe(true);
    expect(hasAlpha("Stream #0:0: Video: webp, yuva420p(pc), 64x64")).toBe(true);
    expect(hasAlpha("Stream #0:0: Video: png, rgb24(pc, gbr/unknown/unknown), 64x64")).toBe(false);
    expect(hasAlpha("Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 4000x3000")).toBe(false);
    expect(hasAlpha("")).toBe(false);
    expect(thumbContentType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(thumbContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(thumbContentType(new Uint8Array([0x47, 0x49]))).toBeNull();
  });

  it("runs more jobs than cores, within bounds, unless told otherwise", () => {
    expect(maxThumbJobs(1)).toBe(2);
    expect(maxThumbJobs(4)).toBe(4);
    expect(maxThumbJobs(64)).toBe(8);
    vi.stubEnv("LENS_THUMB_JOBS", "3");
    expect(maxThumbJobs(64)).toBe(3);
    vi.stubEnv("LENS_THUMB_JOBS", "0");
    expect(maxThumbJobs(64)).toBe(1);
    vi.unstubAllEnvs();
  });
});

describe("job queue", () => {
  const deferred = () => {
    let resolve!: (v: string | null) => void;
    const promise = new Promise<string | null>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("runs at most `limit` jobs at once, in order", async () => {
    const q = createJobQueue(2);
    const d = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const results = d.map((x, i) => q.run(`j${i}`, () => (started.push(i), x.promise)));
    expect(started).toEqual([0, 1]);
    expect(q.queued).toBe(1);
    d[0].resolve("a");
    await results[0];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    d[1].resolve("b");
    d[2].resolve(null);
    expect(await Promise.all(results)).toEqual(["a", "b", null]);
    expect(q.running).toBe(0);
  });

  it("shares one run between requests for the same id", async () => {
    const q = createJobQueue(1);
    const task = vi.fn(async () => "file");
    expect(await Promise.all([q.run("x", task), q.run("x", task)])).toEqual(["file", "file"]);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("drops a queued job once every request for it has gone", async () => {
    const q = createJobQueue(1);
    const blocker = deferred();
    const first = q.run("busy", () => blocker.promise);
    const dropped = vi.fn(async () => "never");
    const a = new AbortController();
    const b = new AbortController();
    const waitA = q.run("scrolled-away", dropped, a.signal);
    const waitB = q.run("scrolled-away", dropped, b.signal);
    a.abort();
    expect(await waitA).toBeNull();
    expect(q.queued).toBe(1); // b still wants it
    b.abort();
    expect(await waitB).toBeNull();
    expect(q.queued).toBe(0);
    blocker.resolve("done");
    expect(await first).toBe("done");
    expect(dropped).not.toHaveBeenCalled();
  });

  it("treats a task that throws as no thumbnail", async () => {
    const q = createJobQueue(1);
    expect(await q.run("boom", async () => Promise.reject(new Error("x")))).toBeNull();
    expect(await q.run("after", async () => "ok")).toBe("ok");
  });
});

describe.skipIf(!hasFfmpeg || !hasFixtures)("GET /api/thumb", () => {
  let bucket: TempBucket;
  let work: string;
  let server: Server;
  let origin: string;
  let prevMockDir: string | undefined;
  // "<key> <range>" for every read the fake bucket served.
  const reads: string[] = [];

  beforeAll(async () => {
    bucket = makeBucket();
    work = mkdtempSync(path.join(os.tmpdir(), "lens-thumbs-"));
    vi.stubEnv("LENS_THUMBS_DIR", path.join(work, "cache"));
    for (const v of VIDEOS) copyFileSync(path.join(FIXTURES, "Factory", v), path.join(bucket.root, v));
    // A clip shorter than the 1 s seek: the first try gets nothing and the retry seeks to 10%.
    execFileSync(FFMPEG, [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "0.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(bucket.root, "short.mp4"),
    ]);
    writeFileSync(path.join(bucket.root, "broken.mp4"), Buffer.alloc(64 * 1024, 0xab));
    const clip = (name: string, size: string, seconds: number, ...extra: string[]) =>
      execFileSync(FFMPEG, [
        "-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30`, "-t", String(seconds),
        "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-pix_fmt", "yuv420p", ...extra, path.join(work, name),
      ]);
    // One fragment per second: ffmpeg seeking it by the index would read every fragment.
    clip("fragmented.mp4", "320x180", 30, "-movflags", "frag_keyframe+empty_moov");
    copyFileSync(path.join(work, "fragmented.mp4"), path.join(bucket.root, "fragmented.mp4"));
    clip("moov_at_end.mp4", "320x180", 8);
    writeFileSync(path.join(bucket.root, "scattered.mp4"), scatter(new Uint8Array(readFileSync(path.join(work, "moov_at_end.mp4"))), 3000));
    clip("hd.mp4", "640x360", 40, "-movflags", "+faststart");
    const hd = new Uint8Array(readFileSync(path.join(work, "hd.mp4")));
    writeFileSync(path.join(bucket.root, "damaged.mp4"), shiftedStart(hd, 300_000, Math.floor(hd.byteLength * 0.6)));
    execFileSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1600x1200", "-frames:v", "1", "-q:v", "2", path.join(bucket.root, "photo.jpg")]);
    execFileSync(FFMPEG, [
      "-v", "error", "-y", "-f", "lavfi", "-i", "color=red@0.5:size=64x48,format=rgba", "-frames:v", "1", path.join(bucket.root, "clear.png"),
    ]);
    writeFileSync(path.join(bucket.root, "corrupt.png"), Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(512, 0xab)]));
    writeFileSync(path.join(bucket.root, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
    copyFileSync(path.join(FIXTURES, "Factory", "summary.pdf"), path.join(bucket.root, "summary.pdf"));
    writeFileSync(path.join(bucket.root, "huge.pdf"), "%PDF-1.4\n");
    truncateSync(path.join(bucket.root, "huge.pdf"), 60 * 1024 * 1024);

    // pdftoppm stand-in: checks it got the downloaded PDF, then "renders" a fixed JPEG.
    const jpeg = path.join(work, "page.jpg");
    execFileSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=white:size=480x620", "-frames:v", "1", jpeg]);
    const fake = path.join(work, "pdftoppm");
    writeFileSync(
      fake,
      `#!/bin/sh
[ "$1" = "-v" ] && exit 0
for a; do prev=$last; last=$a; done
head -c 4 "$prev" | grep -q '%PDF' || exit 1
echo "$@" > "${work}/pdftoppm.args"
cp "${jpeg}" "$last.jpg"
`,
    );
    chmodSync(fake, 0o755);
    vi.stubEnv("PDFTOPPM_PATH", fake);

    prevMockDir = process.env.LENS_MOCK_DIR;
    process.env.LENS_MOCK_DIR = bucket.root;
    // Plays the app's /api/mock route over real HTTP, the way ffmpeg reads presigned S3 URLs.
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", origin);
      reads.push(`${url.searchParams.get("key")} ${req.headers.range ?? ""}`.trim());
      const r = await mockGET(new Request(url, { headers: req.headers.range ? { range: req.headers.range } : {} }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body) Readable.fromWeb(r.body as import("node:stream/web").ReadableStream).pipe(res);
      else res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    if (prevMockDir === undefined) delete process.env.LENS_MOCK_DIR;
    else process.env.LENS_MOCK_DIR = prevMockDir;
    vi.unstubAllEnvs();
    bucket?.cleanup();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  beforeEach(() => {
    session.connection = CONNECTION;
  });

  const thumb = (key: string, params: Record<string, string> = {}, headers: Record<string, string> = {}) =>
    thumbGET(new NextRequest(`${origin}/api/thumb?${new URLSearchParams({ key, ...params })}`, { headers }));
  const widthOf = (bytes: Buffer) => {
    const file = path.join(work, `probe-${Math.random().toString(36).slice(2)}.jpg`);
    writeFileSync(file, bytes);
    const out = execFileSync(FFMPEG.replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", file]);
    return Number(out.toString().trim());
  };

  it.each(VIDEOS)("makes a 480 px JPEG poster frame of %s", async (name) => {
    const r = await thumb(name);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    // Without the version in the URL the browser can't know when it changes.
    expect(r.headers.get("cache-control")).toBe("private, max-age=300");
    const body = Buffer.from(await r.arrayBuffer());
    expect(body.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(widthOf(body)).toBe(480);
  }, 30_000);

  it("lets the browser keep a versioned thumbnail for good, and answers 304 to its ETag", async () => {
    const meta = { size: statSync(path.join(bucket.root, VIDEOS[0])).size, modified: statSync(path.join(bucket.root, VIDEOS[0])).mtime.toISOString() };
    const v = previewVersion(meta);
    const r = await thumb(VIDEOS[0], { v });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const etag = r.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    // A stale version still gets an answer, just not one kept forever.
    expect((await thumb(VIDEOS[0], { v: "1:2020-01-01T00:00:00.000Z" })).headers.get("cache-control")).toBe("private, max-age=300");
    const before = reads.length;
    const again = await thumb(VIDEOS[0], { v }, { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(again.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(await again.text()).toBe("");
    expect(reads.length).toBe(before);
  }, 30_000);

  it("reads a fragmented MP4 in one pass instead of visiting every fragment", async () => {
    const before = reads.length;
    const r = await thumb("fragmented.mp4");
    expect(r.status).toBe(200);
    expect(widthOf(Buffer.from(await r.arrayBuffer()))).toBe(320);
    const mine = reads.slice(before).filter((l) => l.startsWith("fragmented.mp4"));
    // The head check, a first seeking try it cuts short, and the one-pass read (30 fragments otherwise).
    expect(mine.length).toBeLessThanOrEqual(6);
  }, 30_000);

  it("finds the index behind thousands of boxes", async () => {
    const r = await thumb("scattered.mp4");
    expect(r.status).toBe(200);
    expect(widthOf(Buffer.from(await r.arrayBuffer()))).toBe(320);
  }, 30_000);

  it("repairs a damaged index to get a frame the raw file can't give", async () => {
    const r = await thumb("damaged.mp4");
    expect(r.status).toBe(200);
    const body = Buffer.from(await r.arrayBuffer());
    expect(widthOf(body)).toBe(480);
    // The frame matches the undamaged original's.
    const original = execFileSync(FFMPEG, [
      "-v", "error", "-ss", "1", "-i", path.join(work, "hd.mp4"), "-frames:v", "1", "-vf", "scale=480:-2", "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]);
    const probe = path.join(work, "damaged-thumb.jpg");
    writeFileSync(probe, body);
    const got = execFileSync(FFMPEG, ["-v", "error", "-i", probe, "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    expect(got.length).toBe(original.length);
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff += Math.abs(got[i] - original[i]);
    expect(diff / got.length).toBeLessThan(8);
  }, 30_000);

  it("scales photos down to a small JPEG, and keeps a transparent PNG transparent", async () => {
    const photo = await thumb("photo.jpg");
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    const jpeg = Buffer.from(await photo.arrayBuffer());
    expect(widthOf(jpeg)).toBe(480);
    expect(jpeg.length).toBeLessThan(statSync(path.join(bucket.root, "photo.jpg")).size / 4);

    const clear = await thumb("clear.png");
    expect(clear.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await clear.arrayBuffer());
    expect(widthOf(png)).toBe(64);
  }, 30_000);

  it("sends the browser to an image's original when it can't be scaled, never to a signed link", async () => {
    const r = await thumb("corrupt.png");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/api/files/open?key=corrupt.png");
    expect(r.headers.get("cache-control")).toContain("no-store");
    // Vector images are shown from their original by the tile; there is nothing to make.
    expect((await thumb("logo.svg")).status).toBe(204);
  }, 30_000);

  it("serves a second request from the disk cache without reading the bucket", async () => {
    await thumb(VIDEOS[0]);
    const before = reads.length;
    const r = await thumb(VIDEOS[0]);
    expect(r.status).toBe(200);
    expect(reads.length).toBe(before);
  });

  it("still finds a frame in a clip shorter than a second", async () => {
    const r = await thumb("short.mp4");
    expect(r.status).toBe(200);
    expect(widthOf(Buffer.from(await r.arrayBuffer()))).toBe(320);
  }, 30_000);

  it("answers 204 for a file ffmpeg can't read, and doesn't read it again", async () => {
    const r = await thumb("broken.mp4");
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
    const before = reads.length;
    expect((await thumb("broken.mp4")).status).toBe(204);
    expect(reads.length).toBe(before);
    expect(readdirSync(path.join(work, "cache")).some((n) => n.endsWith(".none"))).toBe(true);
  }, 30_000);

  it("renders a PDF's first page with pdftoppm from a downloaded copy", async () => {
    const r = await thumb("summary.pdf");
    expect(r.status).toBe(200);
    expect(widthOf(Buffer.from(await r.arrayBuffer()))).toBe(480);
    expect(existsSync(path.join(work, "pdftoppm.args"))).toBe(true);
    expect(readdirSync(path.join(work, "cache")).filter((n) => n.endsWith(".pdf"))).toEqual([]);
  });

  it("skips PDFs over the size cap without reading them", async () => {
    const before = reads.length;
    expect((await thumb("huge.pdf")).status).toBe(204);
    expect(reads.length).toBe(before);
  });

  it("leaves temporary files behind nowhere", () => {
    expect(readdirSync(path.join(work, "cache")).filter((n) => n.includes(".tmp."))).toEqual([]);
  });

  it("rejects bad requests plainly", async () => {
    expect((await thumb("")).status).toBe(400);
    expect((await thumb("Factory/")).status).toBe(400);
    expect((await thumb("nope.mp4")).status).toBe(404);
    expect((await thumb("a.txt")).status).toBe(415);
    session.connection = null;
    expect((await thumb(VIDEOS[0])).status).toBe(401);
  });
});
