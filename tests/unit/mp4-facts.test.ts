import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StreamDetails, VideoDetails, VideoResult } from "@/lib/file-details";
import type { ByteReader } from "@/lib/server/mp4";
import { mp4Facts, rational } from "@/lib/server/mp4-facts";
import { videoDetailsFromProbe } from "@/lib/server/probe";
import { clearFactsCache, describeVideo, mergeDetails } from "@/lib/server/video-facts";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
const has = (bin: string, ...args: string[]) => {
  try {
    execFileSync(bin, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const hasFfmpeg = has(FFMPEG, "-hide_banner", "-version") && has(FFPROBE, "-hide_banner", "-version");
const hasX265 = hasFfmpeg && has(FFMPEG, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=1", "-t", "1", "-c:v", "libx265", "-f", "null", "-");

let dir: string;
const file = (name: string) => path.join(dir, name);
const ffmpeg = (...args: string[]) => execFileSync(FFMPEG, ["-v", "error", "-y", ...args]);

// Counts reads, like S3 range requests.
function reader(name: string): ByteReader & { reads: number } {
  const bytes = readFileSync(file(name));
  const r = {
    size: bytes.byteLength,
    reads: 0,
    async read(offset: number, length: number) {
      r.reads++;
      return new Uint8Array(bytes.subarray(offset, Math.min(bytes.byteLength, offset + length)));
    },
  };
  return r;
}

const probe = (name: string): VideoDetails =>
  videoDetailsFromProbe(JSON.parse(String(execFileSync(FFPROBE, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file(name)]))));

// Every fact the fast path gives must be ffprobe's; `required` must be given.
const SAME: (keyof StreamDetails)[] = [
  "type", "codec", "codecLong", "codecString", "codecTag", "profile", "level", "width", "height", "displayAspectRatio",
  "frameRate", "avgFrameRate", "pixelFormat", "colorSpace", "bitDepth", "fieldOrder", "rotation", "sampleRate", "channels",
  "channelLayout", "language", "frames",
];

function expectSameAsFfprobe(fast: VideoDetails, ff: VideoDetails, { fragmented = false } = {}) {
  expect(fast.format.name).toBe(ff.format.name);
  expect(fast.format.streams).toBe(ff.format.streams);
  expect(fast.format.duration).toBeCloseTo(ff.format.duration!, 1);
  expect(Math.abs(fast.format.bitRate! / ff.format.bitRate! - 1)).toBeLessThan(0.01);
  for (const t of fast.format.tags) expect(ff.format.tags).toContainEqual(t);
  expect(fast.streams).toHaveLength(ff.streams.length);
  fast.streams.forEach((s, i) => {
    const f = ff.streams[i];
    for (const k of SAME) if (s[k] !== null && f[k] !== null) expect({ [k]: s[k] }).toEqual({ [k]: f[k] });
    expect(s.duration).toBeCloseTo(f.duration!, 1);
    for (const t of s.tags) expect(f.tags).toContainEqual(t);
    if (!fragmented && s.bitRate !== null) expect(Math.abs(s.bitRate / f.bitRate! - 1)).toBeLessThan(0.01);
  });
  const video = fast.streams.find((s) => s.type === "video")!;
  expect(video).toMatchObject({ codec: expect.any(String), codecString: expect.any(String), width: expect.any(Number), height: expect.any(Number), frameRate: expect.any(String) });
  const audio = fast.streams.find((s) => s.type === "audio");
  if (audio) expect(audio).toMatchObject({ sampleRate: expect.any(Number), channels: expect.any(Number), codecString: expect.any(String) });
}

beforeAll(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(path.join(os.tmpdir(), "lens-facts-"));
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-f", "lavfi", "-i", "sine=sample_rate=44100", "-t", "6",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-c:a", "aac", "-ac", "2", "-movflags", "+faststart", file("faststart.mp4"));
  ffmpeg("-i", file("faststart.mp4"), "-c", "copy", "-movflags", "+frag_keyframe+empty_moov+default_base_moof", file("frag.mp4"));
  // Without default_base_moof, fragments carry absolute base data offsets.
  ffmpeg("-i", file("faststart.mp4"), "-c", "copy", "-movflags", "+frag_keyframe+empty_moov", file("frag_abs.mp4"));
  ffmpeg("-i", file("faststart.mp4"), "-c", "copy", "-movflags", "+frag_keyframe+empty_moov+default_base_moof+skip_trailer", file("frag_no_mfra.mp4"));
  ffmpeg("-display_rotation", "90", "-i", file("faststart.mp4"), "-c", "copy", file("rotated.mp4"));
  ffmpeg("-i", file("faststart.mp4"), "-c", "copy", file("moov_at_end.mov"));
  // Five minutes, index at the end: a quarter-megabyte index, bigger than one read.
  ffmpeg("-stream_loop", "49", "-i", file("faststart.mp4"), "-c", "copy", file("long.mp4"));
  // Full-range BT.709 High profile at NTSC rate, mono 48 kHz, with a non-square pixel aspect.
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=640x480:rate=30000/1001", "-f", "lavfi", "-i", "sine=sample_rate=48000", "-t", "3",
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuvj420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-vf", "setsar=4/3", "-c:a", "aac", "-ac", "1", file("fullrange.mp4"));
  if (hasX265) {
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25", "-t", "2", "-c:v", "libx265", "-preset", "ultrafast", "-tag:v", "hvc1",
      "-x265-params", "log-level=none", file("hevc.mp4"));
  }
}, 60_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg)("mp4Facts", () => {
  it("reads a faststart H.264 + AAC file in a couple of reads", async () => {
    const r = reader("faststart.mp4");
    const fast = await mp4Facts(r);
    expectSameAsFfprobe(fast, probe("faststart.mp4"));
    expect(fast.streams[0]).toMatchObject({ codec: "h264", codecString: "avc1.42c00d", width: 320, height: 180, frameRate: "30/1", frames: 180, rotation: null });
    expect(fast.streams[1]).toMatchObject({ codec: "aac", codecString: "mp4a.40.2", sampleRate: 44100, channels: 2, channelLayout: "stereo" });
    expect(fast.format.duration).toBeCloseTo(6, 2);
    expect(fast.format.tags.map((t) => t.key)).toEqual(["major_brand", "minor_version", "compatible_brands", "encoder"]);
    expect(r.reads).toBeLessThanOrEqual(3);
  });

  it.each(["frag.mp4", "frag_abs.mp4", "frag_no_mfra.mp4"])("reads fragmented %s from the index and two fragments", async (name) => {
    const r = reader(name);
    const fast = await mp4Facts(r);
    expectSameAsFfprobe(fast, probe(name), { fragmented: true });
    expect(fast.streams[0]).toMatchObject({ width: 320, height: 180, frameRate: "30/1", codecString: "avc1.42c00d" });
    expect(fast.streams[0].duration).toBeCloseTo(6, 1);
    expect(r.reads).toBeLessThanOrEqual(4);
  });

  it("walks a big index box by box, skipping its tables", async () => {
    const whole = await mp4Facts(reader("long.mp4"));
    const r = reader("long.mp4");
    const walked = await mp4Facts(r, { wholeMoov: 0 });
    expect(walked).toEqual(whole);
    expectSameAsFfprobe(walked, probe("long.mp4"));
    expect(r.reads).toBeLessThanOrEqual(12);
  });

  it("finds an index at the end behind thousands of boxes", async () => {
    const src = readFileSync(file("moov_at_end.mov"));
    const ftypEnd = src.readUInt32BE(0);
    const pad = Buffer.alloc(3000 * 8);
    for (let i = 0; i < 3000; i++) {
      pad.writeUInt32BE(8, i * 8);
      pad.write("free", i * 8 + 4, "latin1");
    }
    // Chunk offsets go stale, which facts don't need.
    writeFileSync(file("scattered.mov"), Buffer.concat([src.subarray(0, ftypEnd), pad, src.subarray(ftypEnd)]));
    const r = reader("scattered.mov");
    const fast = await mp4Facts(r);
    expect(fast).toEqual({ ...(await mp4Facts(reader("moov_at_end.mov"))), format: { ...fast.format } });
    expect(fast.format.bitRate).toBeGreaterThan(0);
    expect(r.reads).toBeLessThanOrEqual(12);
  });

  it("reports the display rotation", async () => {
    const fast = await mp4Facts(reader("rotated.mp4"));
    const ff = probe("rotated.mp4");
    expectSameAsFfprobe(fast, ff);
    expect(fast.streams[0].rotation).toBe(90);
    expect(ff.streams[0].rotation).toBe(90);
  });

  it("finds an index at the end of a QuickTime file", async () => {
    const fast = await mp4Facts(reader("moov_at_end.mov"));
    const ff = probe("moov_at_end.mov");
    expectSameAsFfprobe(fast, ff);
    expect(fast.format.tags).toContainEqual({ key: "major_brand", value: "qt  " });
  });

  it("reads colour, range, aspect and NTSC rates from the SPS", async () => {
    const fast = await mp4Facts(reader("fullrange.mp4"));
    expectSameAsFfprobe(fast, probe("fullrange.mp4"));
    expect(fast.streams[0]).toMatchObject({
      profile: "High",
      pixelFormat: "yuvj420p",
      colorSpace: "bt709",
      bitDepth: 8,
      fieldOrder: "progressive",
      displayAspectRatio: "16:9",
      frameRate: "30000/1001",
    });
    expect(fast.streams[1]).toMatchObject({ sampleRate: 48000, channels: 1, channelLayout: "mono" });
  });

  it.skipIf(!hasX265)("reads HEVC", async () => {
    const fast = await mp4Facts(reader("hevc.mp4"));
    expectSameAsFfprobe(fast, probe("hevc.mp4"));
    expect(fast.streams[0]).toMatchObject({ codec: "hevc", profile: "Main", frameRate: "25/1", codecString: expect.stringMatching(/^hvc1\.1\.6\.L\d+/) });
  });

  it("refuses files that aren't MP4", async () => {
    const bytes = new TextEncoder().encode("not really a video");
    await expect(mp4Facts({ size: bytes.byteLength, read: async (o, n) => bytes.slice(o, o + n) })).rejects.toThrow();
  });
});

describe("rational", () => {
  it("reduces, and approximates what doesn't fit in 32 bits", () => {
    expect(rational(15360, 512)).toBe("30/1");
    expect(rational(30000, 1001)).toBe("30000/1001");
    expect(rational(0, 1)).toBeNull();
    const [n, d] = rational(2 ** 40 + 1, 2 ** 35)!.split("/").map(Number);
    expect(n / d).toBeCloseTo(32, 6);
    expect(n).toBeLessThan(2 ** 31);
  });
});

describe.skipIf(!hasFfmpeg)("describeVideo", () => {
  beforeEach(() => clearFactsCache());
  const target = (key: string) => ({ bucket: "b", key, version: `${key}:1` });
  const url = async () => "http://127.0.0.1:1/unused";
  const answer = (name: string, ms: number) => () =>
    new Promise<VideoResult>((resolve) => setTimeout(() => resolve({ status: "ok", video: probe(name) }), ms));

  it("answers with the file's own facts when ffprobe is slow", async () => {
    const started = Date.now();
    const r = await describeVideo(target("frag.mp4"), () => reader("frag.mp4"), url, { probe: answer("frag.mp4", 6000) });
    expect(Date.now() - started).toBeLessThan(2500);
    expect(r).toMatchObject({ status: "ok", source: "mp4" });
    if (r.status === "ok") expect(r.video.streams[0]).toMatchObject({ width: 320, height: 180, frameRate: "30/1" });
  });

  it("merges ffprobe's extras when it answers in time", async () => {
    const r = await describeVideo(target("faststart.mp4"), () => reader("faststart.mp4"), url, { probe: answer("faststart.mp4", 10) });
    expect(r).toMatchObject({ status: "ok", source: "mp4+ffprobe" });
    if (r.status === "ok") expect(r.video.streams[1]).toMatchObject({ sampleFormat: "fltp", sampleRate: 44100 });
  });

  it("still answers when ffprobe can't", async () => {
    const r = await describeVideo(target("faststart.mp4"), () => reader("faststart.mp4"), url, {
      probe: async () => ({ status: "unavailable", reason: "ffmpeg isn’t installed." }),
    });
    expect(r).toMatchObject({ status: "ok", source: "mp4" });
  });

  it("waits for ffprobe for other containers and unreadable MP4s", async () => {
    const bytes = new TextEncoder().encode("junk");
    const junk = () => ({ size: bytes.byteLength, read: async (o: number, n: number) => bytes.slice(o, o + n) });
    const slow = answer("faststart.mp4", 2600);
    const started = Date.now();
    expect(await describeVideo(target("clip.mkv"), junk, url, { probe: slow })).toMatchObject({ status: "ok", source: "ffprobe" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(2500);
    expect(await describeVideo(target("bad.mp4"), junk, url, { probe: async () => ({ status: "unavailable", reason: "nope" }) })).toEqual({
      status: "unavailable",
      reason: "nope",
    });
  });

  it("prefers ffprobe's values and fills its gaps", () => {
    const fast = probe("faststart.mp4");
    const ff = probe("faststart.mp4");
    ff.streams[0] = { ...ff.streams[0], width: null, profile: "Other" };
    ff.format.tags = [];
    const merged = mergeDetails(fast, ff);
    expect(merged.streams[0]).toMatchObject({ width: 320, profile: "Other" });
    expect(merged.format.tags).toEqual(fast.format.tags);
  });
});
