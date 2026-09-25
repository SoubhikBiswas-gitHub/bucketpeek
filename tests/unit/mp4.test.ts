import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexFragments, MIN_SEGMENT_SECONDS, type FragmentIndex } from "@/lib/server/fmp4";
import { inspectMp4, planFor, type ByteReader } from "@/lib/server/mp4";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let dir: string;
const file = (name: string) => path.join(dir, name);

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

function ffmpeg(...args: string[]) {
  execFileSync(FFMPEG, ["-v", "error", "-y", ...args]);
}

beforeAll(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(path.join(os.tmpdir(), "lens-mp4-"));
  // 30 s, 2 s GOPs, H.264 + AAC.
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-f", "lavfi", "-i", "sine", "-t", "30",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "60", "-c:a", "aac", "-movflags", "+faststart", file("faststart.mp4"));
  ffmpeg("-i", file("faststart.mp4"), "-c", "copy", file("moov_at_end.mp4"));
  ffmpeg("-i", file("faststart.mp4"), "-c", "copy", "-movflags", "+frag_keyframe+empty_moov+default_base_moof", file("frag_index.mp4"));
  ffmpeg("-i", file("faststart.mp4"), "-c", "copy", "-movflags", "+frag_keyframe+empty_moov+default_base_moof+skip_trailer", file("frag_no_index.mp4"));
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "4", "-c:v", "mpeg4", file("mpeg4.mp4"));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg)("inspectMp4 and planFor", () => {
  it("reads a faststart file in a few small reads and plays it directly", async () => {
    const r = reader("faststart.mp4");
    const layout = await inspectMp4(r);
    expect(layout.moov.atEnd).toBe(false);
    expect(layout.fragmented).toBe(false);
    expect(layout.video?.codec).toBe("avc1");
    expect(layout.audio?.codec).toBe("mp4a");
    expect(layout.duration).toBeCloseTo(30, 0);
    expect(layout.video!.keyframes.length).toBeGreaterThanOrEqual(15);
    expect(layout.video!.keyframes[1] - layout.video!.keyframes[0]).toBeCloseTo(2, 1);
    expect(r.reads).toBeLessThanOrEqual(5);
    expect(planFor(layout)).toEqual({ mode: "direct" });
  });

  it("finds an index at the end without reading the video data", async () => {
    const r = reader("moov_at_end.mp4");
    const layout = await inspectMp4(r);
    expect(layout.moov.atEnd).toBe(true);
    expect(r.reads).toBeLessThanOrEqual(5);
    // A small index at the end is fine for browsers (measured: ~1 s to first frame).
    expect(planFor(layout).mode).toBe("direct");
  });

  it("streams a big index at the end instead, even without reading it", async () => {
    const layout = await inspectMp4(reader("moov_at_end.mp4"), { maxMoovBytes: 1 });
    expect(layout.indexRead).toBe(false);
    const big = { ...layout, moov: { ...layout.moov, size: 50 * 1024 * 1024 } };
    expect(planFor(big).mode).toBe("transcode");
  });

  it("recognizes fragmented files and streams their fragments", async () => {
    for (const name of ["frag_index.mp4", "frag_no_index.mp4"]) {
      const layout = await inspectMp4(reader(name));
      expect(layout.fragmented, name).toBe(true);
      expect(layout.tracks.find((t) => t.kind === "video")?.codec).toBe("avc1");
      expect(planFor(layout).mode, name).toBe("fragments");
    }
  });

  it("converts video browsers can't decode", async () => {
    const plan = planFor(await inspectMp4(reader("mpeg4.mp4")));
    expect(plan.mode).toBe("transcode");
    expect(plan.mode === "transcode" && plan.why).toMatch(/mp4v/);
  });

  it("rejects files that aren't MP4", async () => {
    const r: ByteReader = { size: 64, read: async (_o, l) => new Uint8Array(l).fill(0x41) };
    await expect(inspectMp4(r)).rejects.toThrow();
  });
});

describe.skipIf(!hasFfmpeg)("indexFragments", () => {
  async function index(name: string) {
    const r = reader(name);
    const layout = await inspectMp4(r);
    const updates: FragmentIndex[] = [];
    const first = await indexFragments(r, layout, (i) => updates.push(i));
    // Wait for the background part, if any.
    for (let i = 0; i < 100 && !updates.at(-1)?.complete; i++) await new Promise((res) => setTimeout(res, 20));
    return { r, layout, first, final: updates.at(-1)! };
  }

  function expectCoversFile(i: FragmentIndex, size: number, duration: number) {
    expect(i.complete).toBe(true);
    // Contiguous byte ranges from the end of the init segment to the end of the file.
    let at = i.initSize;
    for (const seg of i.segments) {
      expect(seg.offset).toBe(at);
      at += seg.size;
    }
    expect(at).toBeLessThanOrEqual(size);
    expect(size - at).toBeLessThan(64 * 1024); // at most a trailing index (mfra)
    const total = i.segments.reduce((s, seg) => s + seg.duration, 0);
    expect(total).toBeCloseTo(duration, 0);
    for (const seg of i.segments.slice(0, -1)) expect(seg.duration).toBeGreaterThanOrEqual(MIN_SEGMENT_SECONDS - 0.05);
  }

  it("uses the file's mfra index when present: complete at once, in a few reads", async () => {
    const { r, final, first } = await index("frag_index.mp4");
    expect(first.complete).toBe(true);
    expectCoversFile(final, r.size, 30);
    expect(r.reads).toBeLessThanOrEqual(8);
  });

  it("without an index, starts from the first fragments and completes by probing", async () => {
    const { r, final, first } = await index("frag_no_index.mp4");
    expect(first.complete).toBe(false);
    expect(first.segments.length).toBeGreaterThan(0);
    expectCoversFile(final, r.size, 30);
  });

  it("segments start at fragment boundaries (moof boxes)", async () => {
    const { final } = await index("frag_no_index.mp4");
    const bytes = readFileSync(file("frag_no_index.mp4"));
    for (const seg of final.segments) expect(bytes.subarray(seg.offset + 4, seg.offset + 8).toString("latin1")).toBe("moof");
  });
});
