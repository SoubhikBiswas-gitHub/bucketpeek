import { describe, expect, it } from "vitest";
import { mseSegment, regionStarts } from "@/lib/server/fmp4";

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u64 = (n: number) => [...u32(Math.floor(n / 2 ** 32)), ...u32(n >>> 0)];
const box = (type: string, ...payload: number[][]) => {
  const body = payload.flat();
  return [...u32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body];
};

interface TrafSpec {
  track: number;
  // Absolute base-data-offset; undefined for none.
  base?: number;
  dataOffset?: number;
  sizes: number[];
}

const traf = ({ track, base, dataOffset, sizes }: TrafSpec) =>
  box(
    "traf",
    box("tfhd", u32(base === undefined ? 0 : 0x1), u32(track), base === undefined ? [] : u64(base)),
    box("tfdt", [1, 0, 0, 0], u64(0)),
    box("trun", u32((dataOffset === undefined ? 0 : 0x1) | 0x200), u32(sizes.length), dataOffset === undefined ? [] : u32(dataOffset), sizes.flatMap(u32)),
  );

// One moof+mdat placed at `fileOffset` in a file, with each track's samples laid out in the mdat.
function fragment(fileOffset: number, tracks: Omit<TrafSpec, "base" | "dataOffset">[], absolute: boolean[]) {
  const samples = tracks.map((t, i) => t.sizes.map((n, j) => Array(n).fill(16 * (i + 1) + j)).flat());
  // Two passes: the moof's size decides where the mdat (and every sample) lands.
  const build = (offsets: number[]) =>
    box("moof", box("mfhd", u32(0), u32(1)), ...tracks.map((t, i) => traf({ ...t, base: absolute[i] ? fileOffset : undefined, dataOffset: offsets[i] })));
  const moofSize = build(tracks.map(() => 0)).length;
  let at = moofSize + 8;
  const offsets = samples.map((s) => ((at += s.length), at - s.length));
  const bytes = [...build(offsets), ...box("mdat", ...samples)];
  return { bytes: new Uint8Array(bytes), samples };
}

// Reads each track's samples back the way Media Source Extensions do: offsets from the moof start.
function mseSamples(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = (at: number) => String.fromCharCode(...bytes.subarray(at + 4, at + 8));
  const out: number[][] = [];
  for (let at = 8; at < v.getUint32(0); at += v.getUint32(at)) {
    if (t(at) !== "traf") continue;
    let dataOffset = 0;
    let sizes: number[] = [];
    for (let k = at + 8; k < at + v.getUint32(at); k += v.getUint32(k)) {
      if (t(k) === "tfhd") {
        const flags = v.getUint32(k + 8);
        expect(flags & 0x1).toBe(0);
        expect(flags & 0x20000).toBe(0x20000);
      }
      if (t(k) === "trun") {
        dataOffset = v.getInt32(k + 16);
        sizes = Array.from({ length: v.getUint32(k + 12) }, (_, i) => v.getUint32(k + 20 + 4 * i));
      }
    }
    const total = sizes.reduce((a, b) => a + b, 0);
    out.push([...bytes.subarray(dataOffset, dataOffset + total)]);
  }
  return out;
}

describe("mseSegment", () => {
  it("rewrites absolute base-data-offset fragments so MSE finds the same samples", () => {
    const { bytes, samples } = fragment(5_000_000, [{ track: 1, sizes: [3, 5] }], [true]);
    const out = mseSegment(bytes as Uint8Array<ArrayBuffer>, 5_000_000);
    expect(out).not.toBeNull();
    expect(out!.byteLength).toBe(bytes.byteLength - 8);
    expect(mseSamples(out!)).toEqual(samples);
  });

  it("shifts a second track without a base offset by the bytes removed from the moof", () => {
    const { bytes, samples } = fragment(123_456, [{ track: 1, sizes: [4, 2] }, { track: 2, sizes: [6] }], [true, false]);
    // Track 2 is written relative to the moof, which is how browsers read a traf without a base.
    const out = mseSegment(bytes as Uint8Array<ArrayBuffer>, 123_456);
    expect(mseSamples(out!)).toEqual(samples);
  });

  it("rewrites every moof in a multi-fragment segment", () => {
    const a = fragment(1000, [{ track: 1, sizes: [3] }], [true]);
    const b = fragment(1000 + a.bytes.byteLength, [{ track: 1, sizes: [7] }], [true]);
    const joined = new Uint8Array([...a.bytes, ...b.bytes]);
    const out = mseSegment(joined as Uint8Array<ArrayBuffer>, 1000)!;
    const first = out.subarray(0, a.bytes.byteLength - 8);
    const second = out.subarray(a.bytes.byteLength - 8);
    expect(mseSamples(first)).toEqual(a.samples);
    expect(mseSamples(second)).toEqual(b.samples);
  });

  it("leaves moof-relative fragments untouched", () => {
    const { bytes } = fragment(0, [{ track: 1, sizes: [3] }], [false]);
    expect(mseSegment(bytes as Uint8Array<ArrayBuffer>, 0)).toBe(bytes);
  });

  it("refuses a run without its own data offset rather than guess", () => {
    const moof = box("moof", box("mfhd", u32(0), u32(1)), traf({ track: 1, base: 0, sizes: [3] }));
    const bytes = new Uint8Array([...moof, ...box("mdat", [1, 2, 3])]);
    expect(mseSegment(bytes as Uint8Array<ArrayBuffer>, 0)).toBeNull();
  });
});

describe("regionStarts", () => {
  const MB = 1024 * 1024;
  it("starts small and doubles, then splits the rest evenly, within 64 regions", () => {
    const starts = regionStarts(1000, 19 * 1024 * MB);
    expect(starts.slice(0, 4)).toEqual([1000, 1000 + 16 * MB, 1000 + 48 * MB, 1000 + 112 * MB]);
    expect(starts.length).toBeLessThanOrEqual(64);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(starts.at(-1)).toBeLessThan(19 * 1024 * MB);
  });

  it("covers a small file with one or a few regions", () => {
    expect(regionStarts(500, 10 * MB)).toEqual([500]);
    expect(regionStarts(0, 40 * MB)).toEqual([0, 16 * MB]);
  });
});
