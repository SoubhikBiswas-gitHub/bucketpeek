import { describe, expect, it, vi } from "vitest";
import type { ByteReader, Chunk, Mp4Layout, Track } from "@/lib/server/mp4";
import { buildPlayable, findIndexShift, looksLikeSamples, virtualRange, type VirtualMp4 } from "@/lib/server/playable";

// Hand-built MP4s so these tests need neither ffmpeg nor the mp4 parser.

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};
const u64 = (n: number | bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};
const box = (type: string, ...payload: Uint8Array[]) => {
  const body = concat(...payload);
  return concat(u32(8 + body.byteLength), ascii(type), body);
};
const stco = (offsets: number[]) => box("stco", u32(0), u32(offsets.length), ...offsets.map(u32));
const co64 = (offsets: (number | bigint)[]) => box("co64", u32(0), u32(offsets.length), ...offsets.map(u64));
const moovWith = (...tables: Uint8Array[]) =>
  box("moov", ...tables.map((t) => box("trak", box("mdia", box("minf", box("stbl", t))))));
const FTYP = box("ftyp", ascii("isom"), u32(0));

function readerOf(bytes: Uint8Array): ByteReader {
  return { size: bytes.byteLength, read: async (o, n) => bytes.slice(o, Math.min(bytes.byteLength, o + n)) };
}

// One length-prefixed NAL unit filling the whole chunk.
function sample(size: number): Uint8Array {
  const b = new Uint8Array(size).fill(0x11);
  new DataView(b.buffer).setUint32(0, size - 4);
  b[4] = 0x65;
  return b;
}

function track(chunks: Chunk[], codec = "avc1"): Track {
  return {
    id: 1,
    kind: "video",
    codec,
    timescale: 30,
    duration: chunks.length,
    samples: chunks.length,
    chunks,
    keyframes: [0],
    startShift: 0,
    chunkTable: null,
  };
}

function layoutOf(
  file: Uint8Array,
  moovStart: number,
  o: { faststart?: boolean; video?: Track | null; fragmented?: boolean } = {},
): Mp4Layout {
  return {
    size: file.byteLength,
    moov: { offset: moovStart, size: file.byteLength - moovStart, atEnd: true, scattered: o.faststart ?? true },
    fragmented: o.fragmented ?? false,
    tracks: [],
    mvex: { defaults: new Map(), duration: null },
    duration: 1,
    video: o.video ?? null,
    audio: null,
    interleave: { jumps: 0, perMinute: 0, maxJump: 0 },
  };
}

// Plain file with the index at the end: ftyp, mdat, moov.
function endIndexed(tables: (mdatStart: number, moovStart: number) => Uint8Array[], mdatPayload = new Uint8Array(64).fill(0x42)) {
  const mdat = box("mdat", mdatPayload);
  const moovStart = FTYP.byteLength + mdat.byteLength;
  const file = concat(FTYP, mdat, moovWith(...tables(FTYP.byteLength + 8, moovStart)));
  return { file, moovStart };
}

function assemble(v: VirtualMp4, src: Uint8Array, start = 0, end = v.size - 1): Uint8Array {
  return concat(...virtualRange(v, start, end).map((p) => ("bytes" in p ? p.bytes : src.subarray(p.file[0], p.file[1] + 1))));
}

// Every stco/co64 table in `bytes`, in order, as plain numbers.
function chunkTables(bytes: Uint8Array): number[][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables: number[][] = [];
  for (let at = 4; at + 8 <= bytes.byteLength; at++) {
    const type = String.fromCharCode(...bytes.subarray(at, at + 4));
    if (type !== "stco" && type !== "co64") continue;
    const start = at - 4;
    const count = view.getUint32(start + 12);
    tables.push(
      Array.from({ length: count }, (_, i) =>
        type === "co64" ? Number(view.getBigUint64(start + 16 + 8 * i)) : view.getUint32(start + 16 + 4 * i),
      ),
    );
  }
  return tables;
}

function topLevelBoxes(bytes: Uint8Array): { type: string; size: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { type: string; size: number }[] = [];
  for (let at = 0; at < bytes.byteLength; ) {
    let size = view.getUint32(at);
    if (size === 1) size = Number(view.getBigUint64(at + 8));
    out.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), size });
    at += size;
  }
  return out;
}

// A de-identified recording: SHIFT junk bytes were inserted before the media, and the first BAD
// video chunks' offsets still point at where their data used to be. Chunk sizes are distinct and
// separated by 0xff so only the right shift makes every chunk parse as samples.
const SHIFT = 100;
const BAD = 6;
function damaged() {
  const sizes = Array.from({ length: 12 }, (_, i) => 32 + 8 * i);
  const payload: Uint8Array[] = [new Uint8Array(SHIFT).fill(0xee)];
  const real: number[] = [];
  let at = FTYP.byteLength + 8 + SHIFT;
  for (const size of sizes) {
    real.push(at);
    payload.push(sample(size), new Uint8Array([0xff]));
    at += size + 1;
  }
  const claimed = real.map((o, i) => (i < BAD ? o - SHIFT : o));
  const mdat = box("mdat", ...payload);
  const moovStart = FTYP.byteLength + mdat.byteLength;
  const file = concat(FTYP, mdat, moovWith(stco(claimed)));
  const chunks = claimed.map((offset, i) => ({ offset, size: sizes[i], time: i }));
  return { file, moovStart, sizes, real, claimed, chunks };
}

describe("virtualRange", () => {
  const memory = new Uint8Array([1, 2, 3, 4, 5]);
  // 10 file bytes, 5 in memory, an empty file piece, then 10 more file bytes: 25 in all.
  const v: VirtualMp4 = {
    size: 25,
    pieces: [
      { from: "file", start: 10, end: 20 },
      { from: "memory", bytes: memory },
      { from: "file", start: 30, end: 30 },
      { from: "file", start: 40, end: 50 },
    ],
    fixes: { faststart: true, repair: null },
    memory: 5,
  };

  it("maps the whole file to every non-empty piece in order", () => {
    expect(virtualRange(v, 0, 24)).toEqual([{ file: [10, 19] }, { bytes: memory }, { file: [40, 49] }]);
  });

  it("keeps a range inside one file piece to that piece", () => {
    expect(virtualRange(v, 2, 4)).toEqual([{ file: [12, 14] }]);
  });

  it("splits a range across a piece boundary", () => {
    expect(virtualRange(v, 8, 16)).toEqual([{ file: [18, 19] }, { bytes: memory }, { file: [40, 41] }]);
  });

  it("returns views into the memory piece, not copies", () => {
    const [part] = virtualRange(v, 11, 12);
    expect("bytes" in part && [...part.bytes]).toEqual([2, 3]);
    expect("bytes" in part && part.bytes.buffer).toBe(memory.buffer);
  });

  it("serves exactly a boundary byte on either side", () => {
    expect(virtualRange(v, 9, 9)).toEqual([{ file: [19, 19] }]);
    expect(virtualRange(v, 15, 15)).toEqual([{ file: [40, 40] }]);
    expect(virtualRange(v, 24, 24)).toEqual([{ file: [49, 49] }]);
  });

  it("clamps an end past the file", () => {
    expect(virtualRange(v, 20, 1000)).toEqual([{ file: [45, 49] }]);
  });

  it("returns nothing for an empty or out-of-file range", () => {
    expect(virtualRange(v, 5, 4)).toEqual([]);
    expect(virtualRange(v, 25, 30)).toEqual([]);
  });
});

describe("looksLikeSamples", () => {
  it("accepts NAL units that end exactly at the end", () => {
    expect(looksLikeSamples(sample(40))).toBe(true);
    expect(looksLikeSamples(concat(sample(20), sample(30)))).toBe(true);
  });

  it("rejects empty, truncated, trailing or forbidden-bit data", () => {
    expect(looksLikeSamples(new Uint8Array(0))).toBe(false);
    expect(looksLikeSamples(sample(40).subarray(0, 39))).toBe(false);
    expect(looksLikeSamples(concat(sample(40), new Uint8Array([0, 0])))).toBe(false);
    const forbidden = sample(40);
    forbidden[4] = 0x85;
    expect(looksLikeSamples(forbidden)).toBe(false);
    expect(looksLikeSamples(concat(u32(0), new Uint8Array([0x65])))).toBe(false);
  });
});

describe("findIndexShift", () => {
  it("measures the shift and where the damage stops", async () => {
    const d = damaged();
    const layout = layoutOf(d.file, d.moovStart, { faststart: false, video: track(d.chunks) });
    expect(await findIndexShift(readerOf(d.file), layout)).toEqual({ before: d.claimed[BAD], shift: SHIFT, chunks: BAD });
  });

  it("leaves healthy, fragmented, short or non-H.264 tracks alone", async () => {
    const d = damaged();
    const r = readerOf(d.file);
    const healthy = d.real.map((offset, i) => ({ offset, size: d.sizes[i], time: i }));
    expect(await findIndexShift(r, layoutOf(d.file, d.moovStart, { video: track(healthy) }))).toBeNull();
    expect(await findIndexShift(r, layoutOf(d.file, d.moovStart, { video: track(d.chunks), fragmented: true }))).toBeNull();
    expect(await findIndexShift(r, layoutOf(d.file, d.moovStart, { video: track(d.chunks.slice(0, 7)) }))).toBeNull();
    expect(await findIndexShift(r, layoutOf(d.file, d.moovStart, { video: track(d.chunks, "mp4v") }))).toBeNull();
    expect(await findIndexShift(r, layoutOf(d.file, d.moovStart))).toBeNull();
  });

  it("gives up when the bad chunks' data is nowhere to be found", async () => {
    const d = damaged();
    const file = d.file.slice();
    // Chunk 5 is the one measured; with its data gone no shift can be.
    file.fill(0xee, d.real[5], d.real[5] + d.sizes[5]);
    expect(await findIndexShift(readerOf(file), layoutOf(file, d.moovStart, { video: track(d.chunks) }))).toBeNull();
  });

  it("gives up when the late chunks are broken too", async () => {
    const d = damaged();
    const allBad = d.real.map((o, i) => ({ offset: o - SHIFT, size: d.sizes[i], time: i }));
    expect(await findIndexShift(readerOf(d.file), layoutOf(d.file, d.moovStart, { video: track(allBad) }))).toBeNull();
  });
});

describe("buildPlayable", () => {
  it("returns null for fragmented files without reading them", async () => {
    const { file, moovStart } = endIndexed(() => [stco([24])]);
    const r = readerOf(file);
    const read = vi.spyOn(r, "read");
    expect(await buildPlayable(r, layoutOf(file, moovStart, { fragmented: true }))).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("returns null when the file needs neither fix", async () => {
    const { file, moovStart } = endIndexed(() => [stco([24])]);
    expect(await buildPlayable(readerOf(file), layoutOf(file, moovStart, { faststart: false }))).toBeNull();
  });

  it("moves the index to the front and wraps the rest in one 64-bit mdat", async () => {
    const { file, moovStart } = endIndexed((mdatStart, moovAt) => [stco([mdatStart, mdatStart + 10]), co64([mdatStart + 20, moovAt + 4])]);
    const moovSize = file.byteLength - moovStart;
    const fast = await buildPlayable(readerOf(file), layoutOf(file, moovStart));
    expect(fast).not.toBeNull();
    const v = fast!;
    expect(v.fixes).toEqual({ faststart: true, repair: null });
    expect(v.size).toBe(file.byteLength + 16);
    expect(v.memory).toBe(moovSize);

    const out = assemble(v, file);
    expect(out.byteLength).toBe(v.size);
    expect(topLevelBoxes(out)).toEqual([
      { type: "ftyp", size: 16 },
      { type: "moov", size: moovSize },
      { type: "mdat", size: moovStart },
    ]);
    // Data before the old moov moves up by the moov and the new header; data after it by the header.
    const up = moovSize + 16;
    expect(chunkTables(out)).toEqual([
      [24 + up, 34 + up],
      [44 + up, moovStart + 4 + 16],
    ]);
    for (const was of [24, 34, 44]) expect(out.subarray(was + up, was + up + 8)).toEqual(file.subarray(was, was + 8));
  });

  it("rewrites co64 entries past 4 GiB", async () => {
    const { file, moovStart } = endIndexed(() => [co64([0xfffffff0])]);
    const v = (await buildPlayable(readerOf(file), layoutOf(file, moovStart)))!;
    expect(chunkTables(assemble(v, file))).toEqual([[0xfffffff0 + 16]]);
  });

  it("refuses a 32-bit stco entry that would overflow", async () => {
    const { file, moovStart } = endIndexed(() => [stco([24]), stco([0xfffffff0])]);
    expect(await buildPlayable(readerOf(file), layoutOf(file, moovStart))).toBeNull();
  });

  it("refuses a malformed index", async () => {
    const tooLong = concat(u32(8 + 8 + 4), ascii("stco"), u32(0), u32(5), u32(24));
    const tiny = concat(u32(4), ascii("stco"));
    const overrun = concat(u32(64), ascii("stco"), u32(0), u32(0));
    for (const table of [tooLong, tiny, overrun]) {
      const { file, moovStart } = endIndexed(() => [table]);
      expect(await buildPlayable(readerOf(file), layoutOf(file, moovStart))).toBeNull();
    }
  });

  it("refuses when the layout's moov isn't a moov box, or can't be read whole", async () => {
    const { file, moovStart } = endIndexed(() => [stco([24])]);
    expect(await buildPlayable(readerOf(file), layoutOf(file, moovStart - 8))).toBeNull();
    const short: ByteReader = { size: file.byteLength, read: async (o, n) => file.slice(o, Math.min(file.byteLength - 1, o + n)) };
    expect(await buildPlayable(short, layoutOf(file, moovStart))).toBeNull();
  });

  it("puts the moov first when the file has no ftyp", async () => {
    const mdat = box("mdat", new Uint8Array(40).fill(0x42));
    const lead = box("free", new Uint8Array(8));
    const moovStart = lead.byteLength + mdat.byteLength;
    const file = concat(lead, mdat, moovWith(stco([lead.byteLength + 8])));
    const v = (await buildPlayable(readerOf(file), layoutOf(file, moovStart)))!;
    const out = assemble(v, file);
    expect(topLevelBoxes(out).map((b) => b.type)).toEqual(["moov", "mdat"]);
    const [[entry]] = chunkTables(out);
    expect(out.subarray(entry, entry + 8)).toEqual(file.subarray(lead.byteLength + 8, lead.byteLength + 16));
  });

  it("refuses an ftyp that claims to reach past the moov", async () => {
    const { file, moovStart } = endIndexed(() => [stco([24])]);
    const bad = file.slice();
    new DataView(bad.buffer).setUint32(0, moovStart + 1);
    expect(await buildPlayable(readerOf(bad), layoutOf(bad, moovStart))).toBeNull();
  });

  it("repairs shifted chunk offsets in place when the index needn't move", async () => {
    const d = damaged();
    const v = (await buildPlayable(readerOf(d.file), layoutOf(d.file, d.moovStart, { faststart: false, video: track(d.chunks) })))!;
    expect(v.fixes).toEqual({ faststart: false, repair: { before: d.claimed[BAD], shift: SHIFT, chunks: BAD } });
    expect(v.size).toBe(d.file.byteLength);
    expect(v.pieces.map((p) => p.from)).toEqual(["file", "memory", "file"]);
    const out = assemble(v, d.file);
    expect(chunkTables(out)).toEqual([d.real]);
    d.real.forEach((o, i) => expect(looksLikeSamples(out.subarray(o, o + d.sizes[i]))).toBe(true));
  });

  it("repairs and moves the index in one pass", async () => {
    const d = damaged();
    const moovSize = d.file.byteLength - d.moovStart;
    const v = (await buildPlayable(readerOf(d.file), layoutOf(d.file, d.moovStart, { video: track(d.chunks) })))!;
    expect(v.fixes).toEqual({ faststart: true, repair: { before: d.claimed[BAD], shift: SHIFT, chunks: BAD } });
    const out = assemble(v, d.file);
    expect(topLevelBoxes(out).map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    const [offsets] = chunkTables(out);
    expect(offsets).toEqual(d.real.map((o) => o + moovSize + 16));
    offsets.forEach((o, i) => expect(out.subarray(o, o + d.sizes[i])).toEqual(sample(d.sizes[i])));
  });

  it("still serves faststart when looking for damage fails", async () => {
    const d = damaged();
    const r: ByteReader = {
      size: d.file.byteLength,
      read: async (o, n) => {
        if (o > 0 && o < d.moovStart) throw new Error("network");
        return d.file.slice(o, o + n);
      },
    };
    const v = await buildPlayable(r, layoutOf(d.file, d.moovStart, { video: track(d.chunks) }));
    expect(v?.fixes).toEqual({ faststart: true, repair: null });
  });
});
