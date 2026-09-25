import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURES } from "./helpers/bucket";

type Convert = typeof import("@/lib/server/convert");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const WEBM = path.join(FIXTURES, "Factory/episode_0003_forklift_route_b.webm");

let convert: Convert;
let work: string;
let server: Server;
let origin: string;
const requests: { url: string; range: string | undefined; bytes: number }[] = [];

// Like S3: 200 for the whole object, 206 for a byte range.
function serveFile(req: IncomingMessage, res: ServerResponse, file: string, type: string) {
  const size = statSync(file).size;
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  const start = m ? Number(m[1]) : 0;
  const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  const body = readFileSync(file).subarray(start, end + 1);
  requests.push({ url: req.url ?? "", range: req.headers.range, bytes: body.length });
  res.writeHead(m ? 206 : 200, {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Content-Length": String(body.length),
    ...(m ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  });
  res.end(body);
}

function ffprobeStart(file: string): number {
  const out = execFileSync(FFMPEG.replace(/ffmpeg$/, "ffprobe"), [
    "-v", "error", "-select_streams", "v", "-show_entries", "stream=start_time", "-of", "csv=p=0", file,
  ]).toString();
  return Number(out.trim().split("\n")[0]);
}

beforeAll(async () => {
  work = mkdtempSync(path.join(os.tmpdir(), "lens-hls-"));
  vi.stubEnv("LENS_HLS_DIR", path.join(work, "hls"));
  convert = await import("@/lib/server/convert");

  if (hasFfmpeg) {
    // A minute of MPEG-4 Part 2 in AVI, the kind of file OpenCV writes and browsers can't play.
    execFileSync(FFMPEG, [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-f", "lavfi", "-i", "sine=frequency=440",
      "-t", "60", "-c:v", "mpeg4", "-q:v", "5", "-c:a", "libmp3lame", path.join(work, "long.avi"),
    ]);
    // A real H.264 MP4 whose frame data is overwritten: every frame fails like a non-standard recording does.
    const good = path.join(work, "good.mp4");
    execFileSync(FFMPEG, [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30", "-t", "120",
      "-c:v", "libx264", "-preset", "veryfast", "-g", "30", "-movflags", "+faststart", good,
    ]);
    const data = readFileSync(good);
    data.fill(0xab, data.indexOf("mdat") + 4);
    writeFileSync(path.join(work, "broken.mp4"), data);
  }

  server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/video.webm") && existsSync(WEBM)) serveFile(req, res, WEBM, "video/webm");
    else if (url.startsWith("/long.avi") && hasFfmpeg) serveFile(req, res, path.join(work, "long.avi"), "video/x-msvideo");
    else if (url.startsWith("/broken.mp4") && hasFfmpeg) {
      // Trickles the file out like a slow bucket, so ffmpeg is still reading when the video is judged.
      const data = readFileSync(path.join(work, "broken.mp4"));
      const step = Math.ceil(data.length / 60);
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(data.length) });
      let at = 0;
      const timer = setInterval(() => {
        if (res.destroyed || at >= data.length) {
          clearInterval(timer);
          res.end();
          return;
        }
        res.write(data.subarray(at, (at += step)));
      }, 500);
    } else {
      res.writeHead(403).end("denied");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  vi.unstubAllEnvs();
  rmSync(work, { recursive: true, force: true });
});

const open = (key: string, url = `${origin}/${key}`, version = "1") =>
  convert.openStream({ bucket: "b", key, version, source: url, size: 0 });

async function segment(key: string, n: number, url = `${origin}/${key}`) {
  const s = await convert.getStream(convert.jobId("b", key), "b");
  if (!s) throw new Error("stream not open");
  return convert.segmentFile(s, n, async () => url);
}

describe("ids, names and playlists", () => {
  it("derives stable, safe job ids", () => {
    const id = convert.jobId("bucket", "Factory/a b.avi");
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(convert.jobId("bucket", "Factory/a b.avi")).toBe(id);
    expect(convert.jobId("other", "Factory/a b.avi")).not.toBe(id);
    expect(convert.isJobId(id)).toBe(true);
    for (const bad of ["", "../../etc", "ABCDEF0123456789abcdef01", `${id}0`]) expect(convert.isJobId(bad)).toBe(false);
  });

  it("only accepts segment names it writes", () => {
    expect(convert.segmentIndex("seg_00000.ts")).toBe(0);
    expect(convert.segmentIndex("seg_12345.ts")).toBe(12345);
    expect(convert.segmentIndex("seg_123456.ts")).toBe(123456);
    for (const bad of ["../x", "index.m3u8", "ffmpeg.log", "seg_1.ts", "seg_00001.ts.tmp", "seg_00001.ts/../x"]) {
      expect(convert.segmentIndex(bad)).toBeNull();
    }
  });

  it("splits a duration into segments, dropping a sliver at the end", () => {
    const S = convert.SEGMENT_SECONDS;
    expect(convert.segmentCount(S * 10)).toBe(10);
    expect(convert.segmentCount(S * 10 + 0.03)).toBe(10);
    expect(convert.segmentCount(S * 10 + 1)).toBe(11);
    // 40 hours: the timeline of a ~900 GB recording.
    expect(convert.segmentCount(40 * 3600)).toBe((40 * 3600) / S);
  });

  it("lists the whole video up front as a VOD playlist", () => {
    const S = convert.SEGMENT_SECONDS;
    const text = convert.playlistFor({ duration: S * 2 + 1.5, segments: 3 });
    expect(text).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(text).toContain("#EXT-X-ENDLIST");
    expect(text.match(/#EXTINF/g)).toHaveLength(3);
    expect(text).toContain(`#EXTINF:${S.toFixed(6)},\nseg_00000.ts`);
    expect(text).toContain("#EXTINF:1.500000,\nseg_00002.ts");
  });

  it("doesn't find unknown streams, or streams of another bucket", async () => {
    expect(await convert.getStream(convert.jobId("b", "never"), "b")).toBeNull();
    expect(await convert.getStream("../../etc", "b")).toBeNull();
    const dir = path.join(work, "hls", convert.jobId("b", "theirs"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ bucket: "b", key: "theirs", version: "1", duration: 8 }));
    expect(await convert.getStream(convert.jobId("b", "theirs"), "other-bucket")).toBeNull();
    expect((await convert.getStream(convert.jobId("b", "theirs"), "b"))?.segments).toBe(2);
  });

  it("rejects non-http sources", async () => {
    if (!hasFfmpeg) return;
    await expect(open("file", "file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(open("rel", "/api/mock?key=x")).rejects.toThrow();
  });
});

describe.skipIf(!hasFfmpeg)("on-demand streaming", () => {
  it("reads the length without converting anything", async () => {
    const s = await open("long.avi");
    expect(s.duration).toBeGreaterThan(59);
    expect(s.duration).toBeLessThan(61);
    expect(s.segments).toBe(convert.segmentCount(s.duration));
    expect(readdirSync(path.join(work, "hls", s.id)).filter((n) => n.endsWith(".ts"))).toEqual([]);
  }, 30_000);

  it("converts a segment in the middle first, with timestamps at its place in the video", async () => {
    const before = requests.length;
    const file = await segment("long.avi", 10);
    const S = convert.SEGMENT_SECONDS;
    // Start time = position in the video + a fixed base (10 s) + MPEG-TS's usual 1.4 s delay.
    expect(ffprobeStart(file)).toBeCloseTo(10 * S + 10 + 1.4, 1);
    // Nothing before the seek point was converted.
    const dir = path.join(work, "hls", convert.jobId("b", "long.avi"));
    expect(existsSync(path.join(dir, "seg_00000.ts"))).toBe(false);
    // ffmpeg jumped into the file with a byte range instead of reading it from the start.
    const ranged = requests.slice(before).filter((r) => r.range && !r.range.startsWith("bytes=0-"));
    expect(ranged.length).toBeGreaterThan(0);
  }, 60_000);

  it("lines up segments from separate ffmpeg runs exactly", async () => {
    const S = convert.SEGMENT_SECONDS;
    // Segment 3 comes from a new run (a seek back); 11 continues the run that started at 10.
    const early = await segment("long.avi", 3);
    const next = await segment("long.avi", 11);
    expect(ffprobeStart(early)).toBeCloseTo(3 * S + 11.4, 1);
    expect(ffprobeStart(next)).toBeCloseTo(11 * S + 11.4, 1);
  }, 60_000);

  it("serves the last segment and refuses ones past the end", async () => {
    const s = (await convert.getStream(convert.jobId("b", "long.avi"), "b"))!;
    const last = await segment("long.avi", s.segments - 1);
    expect(existsSync(last)).toBe(true);
    await expect(segment("long.avi", s.segments)).rejects.toMatchObject({ status: 404 });
    await expect(segment("long.avi", -1)).rejects.toMatchObject({ status: 404 });
  }, 60_000);

  it("stops runners nobody is watching", async () => {
    await segment("long.avi", 0);
    await convert.sweepConversions(Date.now() + 5 * 60_000);
    const s = (await convert.getStream(convert.jobId("b", "long.avi"), "b"))!;
    await new Promise((r) => setTimeout(r, 300));
    expect(s.runner === null || s.runner.exitCode !== null).toBe(true);
  }, 60_000);

  it("reports a video ffmpeg can't decode within seconds", async () => {
    await open("broken.mp4");
    const started = Date.now();
    const err = await segment("broken.mp4", 0).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 422 });
    expect((err as Error).message).toMatch(/couldn’t decode the video/);
    // The source takes ~30 s to arrive; the video is judged after ~8 s, not left to spin.
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(convert.streamStatus(convert.jobId("b", "broken.mp4"))).toMatchObject({ failed: true });
    // Opening it again is "try again": the failure is cleared.
    await open("broken.mp4");
    expect(convert.streamStatus(convert.jobId("b", "broken.mp4")).failed).toBe(false);
  }, 60_000);

  it("reports an unreadable source without leaking the link's signature", async () => {
    const err = await open("denied.webm", `${origin}/denied?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE&X-Amz-Signature=topsecret`).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ status: 422 });
    expect((err as Error).message).not.toContain("topsecret");
    expect((err as Error).message).not.toContain("AKIAIOSFODNN7EXAMPLE");
  }, 30_000);

  it("logs ffmpeg's errors without the link's signature, in files only this user can read", async () => {
    await open("signed.avi", `${origin}/long.avi`);
    const link = `${origin}/denied.avi?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260101&X-Amz-Signature=topsecretsignature`;
    await expect(segment("signed.avi", 0, link)).rejects.toMatchObject({ status: 502 });
    await new Promise((r) => setTimeout(r, 300));
    const dir = path.join(work, "hls", convert.jobId("b", "signed.avi"));
    const logs = readdirSync(dir).filter((n) => n.startsWith("ffmpeg-"));
    expect(logs.length).toBeGreaterThan(0);
    for (const name of logs) {
      const text = readFileSync(path.join(dir, name), "utf8");
      expect(text).toMatch(/403/);
      expect(text).toContain(`${origin}/denied.avi`);
      expect(text).not.toContain("topsecretsignature");
      expect(text).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(statSync(path.join(dir, name)).mode & 0o777).toBe(0o600);
    }
  }, 60_000);

  it("waits for a free inspection slot before probing", async () => {
    const { inspections } = await import("@/lib/server/limits");
    vi.stubEnv("LENS_MAX_INSPECTIONS", "1");
    let release!: () => void;
    const busy = inspections.run(() => new Promise<void>((r) => (release = r)));
    const before = requests.length;
    const opened = open("queued.webm", `${origin}/video.webm`);
    await new Promise((r) => setTimeout(r, 300));
    expect(requests.length).toBe(before);
    release();
    await busy;
    expect((await opened).duration).toBeGreaterThan(0);
    expect(requests.length).toBeGreaterThan(before);
    vi.stubEnv("LENS_MAX_INSPECTIONS", "");
  }, 30_000);

  it("probes once and shares it between concurrent opens", async () => {
    const before = requests.length;
    const [a, b] = await Promise.all([open("video.webm"), open("video.webm")]);
    expect(a).toEqual(b);
    const probes = requests.slice(before).length;
    await open("video.webm");
    expect(requests.length - before).toBe(probes); // cached: no new request
  }, 30_000);

  it("throws cached segments away when the object changes", async () => {
    await open("video.webm");
    await segment("video.webm", 0);
    const dir = path.join(work, "hls", convert.jobId("b", "video.webm"));
    expect(existsSync(path.join(dir, "seg_00000.ts"))).toBe(true);
    await open("video.webm", undefined, "2");
    expect(existsSync(path.join(dir, "seg_00000.ts"))).toBe(false);
  }, 30_000);
});

describe("concurrency settings", () => {
  it("defaults to half the cores and honors LENS_MAX_CONVERSIONS", () => {
    const auto = Math.max(1, Math.floor(os.cpus().length / 2));
    vi.stubEnv("LENS_MAX_CONVERSIONS", "");
    expect(convert.maxConcurrentConversions()).toBe(auto);
    vi.stubEnv("LENS_MAX_CONVERSIONS", "3");
    expect(convert.maxConcurrentConversions()).toBe(3);
    vi.stubEnv("LENS_MAX_CONVERSIONS", "0");
    expect(convert.maxConcurrentConversions()).toBe(1);
    vi.stubEnv("LENS_MAX_CONVERSIONS", "lots");
    expect(convert.maxConcurrentConversions()).toBe(auto);
    vi.stubEnv("LENS_MAX_CONVERSIONS", "");
  });
});

describe("pruning", () => {
  it("removes old and excess video folders but keeps the active one", async () => {
    vi.stubEnv("LENS_HLS_KEEP_JOBS", "12");
    const root = path.join(work, "hls-prune");
    vi.stubEnv("LENS_HLS_DIR", root);
    vi.resetModules();
    const fresh: Convert = await import("@/lib/server/convert");
    mkdirSync(root, { recursive: true });
    const now = Date.now() / 1000;
    const ids = Array.from({ length: 16 }, (_, i) => fresh.jobId("prune", String(i)));
    ids.forEach((id, i) => {
      const dir = path.join(root, id);
      mkdirSync(dir, { recursive: true });
      const f = path.join(dir, "seg_00000.ts");
      writeFileSync(f, "ts");
      const t = i === 0 ? now - 2 * 86400 : now - i * 60;
      utimesSync(f, t, t);
    });
    mkdirSync(path.join(root, "not-a-job"), { recursive: true });

    await fresh.pruneConversions(ids[15]);
    const left = new Set(readdirSync(root));
    expect(left.has(ids[0])).toBe(false); // too old
    expect(left.has(ids[15])).toBe(true); // active, though oldest of the recent ones
    expect(left.has(ids[1])).toBe(true); // newest
    expect(left.has("not-a-job")).toBe(true); // never touches unknown folders
    expect([...left].filter((n) => fresh.isJobId(n) && n !== ids[15]).length).toBeLessThanOrEqual(12);
    vi.stubEnv("LENS_HLS_DIR", path.join(work, "hls"));
    vi.stubEnv("LENS_HLS_KEEP_JOBS", "");
  });
});
