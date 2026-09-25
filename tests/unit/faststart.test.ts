import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPlayable, findIndexShift, virtualRange } from "@/lib/server/playable";
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
const text = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at + 4, at + 8));

function readerOf(bytes: Uint8Array): ByteReader {
  return { size: bytes.byteLength, read: async (o, n) => bytes.slice(o, Math.min(bytes.byteLength, o + n)) };
}

// Inserts `count` 8-byte free boxes after the ftyp, like recorders that reserve space, fixing chunk offsets.
function scatter(src: Uint8Array, count: number): Uint8Array {
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const ftypEnd = v.getUint32(0);
  const pad = new Uint8Array(count * 8);
  const pv = new DataView(pad.buffer);
  for (let i = 0; i < count; i++) {
    pv.setUint32(i * 8, 8);
    pad.set([0x66, 0x72, 0x65, 0x65], i * 8 + 4);
  }
  const out = new Uint8Array(src.byteLength + pad.byteLength);
  out.set(src.subarray(0, ftypEnd));
  out.set(pad, ftypEnd);
  out.set(src.subarray(ftypEnd), ftypEnd + pad.byteLength);
  // Every stco entry moves by the padding (ffmpeg writes 32-bit tables for small files).
  const ov = new DataView(out.buffer);
  for (let i = 0; i + 8 < out.byteLength; i++) {
    if (text(out, i - 4 < 0 ? 0 : i - 4) !== "stco" || i < 4) continue;
    const at = i - 4;
    const n = ov.getUint32(at + 12);
    for (let k = 0; k < n; k++) ov.setUint32(at + 16 + 4 * k, ov.getUint32(at + 16 + 4 * k) + pad.byteLength);
  }
  return out;
}

async function virtualBytes(src: Uint8Array) {
  const layout = await inspectMp4(readerOf(src));
  const fast = await buildPlayable(readerOf(src), layout);
  if (!fast) throw new Error("no playable view");
  const assemble = (start: number, end: number) =>
    new Uint8Array(virtualRange(fast, start, end).flatMap((p) => [...("bytes" in p ? p.bytes : src.subarray(p.file[0], p.file[1] + 1))]));
  return { layout, fast, assemble };
}

const frames = (name: string) =>
  execFileSync(FFMPEG, ["-v", "error", "-i", file(name), "-map", "0", "-c", "copy", "-f", "framemd5", "-"]).toString().split("\n").filter((l) => l && !l.startsWith("#"));

beforeAll(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(path.join(os.tmpdir(), "lens-faststart-"));
  execFileSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-f", "lavfi", "-i", "sine", "-t", "8",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-c:a", "aac", file("moov_at_end.mp4")]);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg)("faststart", () => {
  it("finds an index at the end behind hundreds of boxes and plans to serve it faststart", async () => {
    const scattered = scatter(new Uint8Array(readFileSync(file("moov_at_end.mp4"))), 100);
    const layout = await inspectMp4(readerOf(scattered));
    expect(layout.moov.atEnd).toBe(true);
    expect(layout.moov.scattered).toBe(true);
    expect(layout.video?.codec).toBe("avc1");
    expect(planFor(layout).mode).toBe("faststart");
  });

  it("moves the index to the front without changing a single frame", async () => {
    const scattered = scatter(new Uint8Array(readFileSync(file("moov_at_end.mp4"))), 100);
    writeFileSync(file("scattered.mp4"), scattered);
    const { fast, assemble } = await virtualBytes(scattered);
    const whole = assemble(0, fast.size - 1);
    expect(whole.byteLength).toBe(scattered.byteLength + 16);
    // Three top-level boxes, so players don't walk the recorder's per-second boxes.
    const v = new DataView(whole.buffer);
    const ftyp = v.getUint32(0);
    const moov = v.getUint32(ftyp);
    expect([text(whole, 0), text(whole, ftyp), text(whole, ftyp + moov)]).toEqual(["ftyp", "moov", "mdat"]);
    expect(ftyp + moov + Number(v.getBigUint64(ftyp + moov + 8))).toBe(whole.byteLength);
    writeFileSync(file("virtual.mp4"), whole);
    expect(frames("virtual.mp4")).toEqual(frames("scattered.mp4"));
    expect(frames("virtual.mp4").length).toBeGreaterThan(200);
  });

  it("serves any byte range of the virtual file consistently", async () => {
    const scattered = scatter(new Uint8Array(readFileSync(file("moov_at_end.mp4"))), 100);
    const { fast, assemble } = await virtualBytes(scattered);
    const whole = assemble(0, fast.size - 1);
    const memory = fast.pieces.filter((p) => p.from === "memory").reduce((n, p) => n + (p.from === "memory" ? p.bytes.byteLength : 0), 0);
    const head = fast.pieces[0].from === "file" ? fast.pieces[0].end : 0;
    const moovEnd = head + memory;
    for (const [a, b] of [[0, 10], [head - 3, moovEnd + 5], [moovEnd, moovEnd + 1000], [fast.size - 50, fast.size - 1], [12345, 99999]]) {
      expect(assemble(a, b)).toEqual(whole.subarray(a, b + 1));
    }
  });
});

// The de-identification damage: junk bytes inserted at the start of the media data and as many dropped
// further on, with the index unchanged. Early chunks then read junk; late ones are right.
function shiftedStart(src: Uint8Array, junk: number, dropAt: number): Uint8Array {
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let at = 0;
  let mdat = -1;
  while (at + 8 <= src.byteLength) {
    const size = v.getUint32(at);
    if (text(src, at) === "mdat") mdat = at;
    at += size;
  }
  const payload = mdat + 8;
  const noise = new Uint8Array(junk);
  for (let i = 0; i < junk; i++) noise[i] = (i * 2654435761) >>> 24;
  // Keep the mdat's size right so the file still parses: the payload length doesn't change.
  return new Uint8Array([...src.subarray(0, payload), ...noise, ...src.subarray(payload, dropAt), ...src.subarray(dropAt + junk)]);
}

describe.skipIf(!hasFfmpeg)("index repair", () => {
  beforeAll(() => {
    execFileSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "40",
      "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-an", "-movflags", "+faststart", file("hd.mp4")]);
  });

  it("finds the shift and makes the damaged part play again, frame for frame", async () => {
    const src = new Uint8Array(readFileSync(file("hd.mp4")));
    const junk = 300_000;
    const damaged = shiftedStart(src, junk, Math.floor(src.byteLength * 0.6));
    writeFileSync(file("damaged.mp4"), damaged);

    const layout = await inspectMp4(readerOf(damaged));
    const shift = await findIndexShift(readerOf(damaged), layout);
    expect(shift?.shift).toBe(junk);
    expect(shift!.chunks).toBeGreaterThanOrEqual(5);

    const { fast, assemble } = await virtualBytes(damaged);
    expect(fast.fixes.repair?.shift).toBe(junk);
    writeFileSync(file("repaired.mp4"), assemble(0, fast.size - 1));

    // Before the dropped bytes, every frame decodes exactly as in the original.
    const decoded = (name: string) =>
      execFileSync(FFMPEG, ["-v", "quiet", "-i", file(name), "-map", "0:v", "-f", "framemd5", "-"]).toString().split("\n").filter((l) => l && !l.startsWith("#"));
    const original = decoded("hd.mp4");
    const repaired = decoded("repaired.mp4");
    // Every frame before the chunk where the inserted bytes were dropped again (they're partly gone there).
    const good = Math.round(layout.video!.chunks[shift!.chunks - 2].time * 30);
    expect(good).toBeGreaterThan(500);
    expect(repaired.slice(0, good)).toEqual(original.slice(0, good));
    // The damaged file itself decodes none of those.
    const broken = decoded("damaged.mp4");
    expect(broken.slice(0, good)).not.toEqual(original.slice(0, good));
  });

  it("leaves a healthy file alone after a single read", async () => {
    const src = new Uint8Array(readFileSync(file("hd.mp4")));
    let reads = 0;
    const r = { ...readerOf(src), read: (o: number, n: number) => (reads++, readerOf(src).read(o, n)) };
    const layout = await inspectMp4(readerOf(src));
    expect(await findIndexShift(r, layout)).toBeNull();
    expect(reads).toBeLessThanOrEqual(2);
    expect(await buildPlayable(readerOf(src), layout)).toBeNull();
  });
});
