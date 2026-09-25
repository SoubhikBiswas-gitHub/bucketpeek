import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FragmentsTooLarge, indexFragments, MAX_SEGMENT_BYTES } from "@/lib/server/fmp4";
import { httpReader } from "@/lib/server/http-reader";
import type { ByteReader, Mp4Layout } from "@/lib/server/mp4";

const MB = 1024 * 1024;
const INIT = 64;

// A file of zeros with a few boxes placed in it. Reads over 16 MB are refused and remembered.
function crafted(size: number, boxes: { at: number; bytes: Uint8Array }[]): ByteReader & { largest: number } {
  const r = {
    size,
    largest: 0,
    async read(offset: number, length: number) {
      r.largest = Math.max(r.largest, length);
      if (length > 16 * MB) throw new Error(`read of ${length} bytes`);
      const out = new Uint8Array(Math.max(0, Math.min(size, offset + length) - offset));
      for (const b of boxes) {
        for (let i = 0; i < b.bytes.length; i++) {
          const p = b.at + i - offset;
          if (p >= 0 && p < out.length) out[p] = b.bytes[i];
        }
      }
      return out;
    },
  };
  return r;
}

function box(type: string, ...parts: number[][]): number[] {
  const body = parts.flat();
  const size = 8 + body.length;
  return [size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...[...type].map((c) => c.charCodeAt(0)), ...body];
}
const u32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u64 = (n: number) => [...u32(Math.floor(n / 2 ** 32)), ...u32(n >>> 0)];

// One 3 s keyframe fragment of track 1, followed by an mdat of `mdatSize` bytes (only its header is placed).
function fragment(mdatSize: number): { at: number; bytes: Uint8Array }[] {
  const moof = box(
    "moof",
    box("mfhd", u32(0), u32(1)),
    box("traf", box("tfhd", u32(0x020000), u32(1)), box("tfdt", u32(0), u32(0)), box("trun", u32(0x100), u32(1), u32(3000))),
  );
  return [
    { at: INIT, bytes: new Uint8Array(moof) },
    { at: INIT + moof.length, bytes: new Uint8Array([...u32(mdatSize), ...[..."mdat"].map((c) => c.charCodeAt(0))]) },
  ];
}

const layout = (size: number) =>
  ({
    size,
    moov: { offset: 0, size: INIT, atEnd: false, scattered: false },
    fragmented: true,
    tracks: [{ id: 1, kind: "video", codec: "avc1", timescale: 1000 }],
    mvex: { defaults: new Map(), duration: null },
    duration: 3,
    video: null,
    audio: null,
    interleave: { jumps: 0, perMinute: 0, maxJump: 0 },
  }) as unknown as Mp4Layout;

describe("fragment index limits", () => {
  it("doesn't read an mfra index bigger than 16 MB", async () => {
    const size = 100 * MB;
    const mfro = new Uint8Array(box("mfro", u32(0), u32(50 * MB)));
    const r = crafted(size, [{ at: size - 16, bytes: mfro }]);
    await indexFragments(r, layout(size), () => {});
    expect(r.largest).toBeLessThanOrEqual(16 * MB);
  });

  it("doesn't read a moof that claims a huge 64-bit size; the file is converted instead", async () => {
    const size = 2 * 1024 * MB;
    const huge = new Uint8Array([...u32(1), ...[..."moof"].map((c) => c.charCodeAt(0)), ...u64(1024 * MB)]);
    const r = crafted(size, [{ at: INIT, bytes: huge }]);
    await expect(indexFragments(r, layout(size), () => {})).rejects.toBeInstanceOf(FragmentsTooLarge);
    expect(r.largest).toBeLessThanOrEqual(16 * MB);
  });

  it("treats a file whose segments are over 64 MB as not streamable as fragments", async () => {
    const size = 150 * MB;
    const r = crafted(size, fragment(100 * MB));
    await expect(indexFragments(r, layout(size), () => {})).rejects.toBeInstanceOf(FragmentsTooLarge);
  });

  it("indexes the same layout with a small mdat", async () => {
    const size = 2 * MB;
    const r = crafted(size, fragment(MB));
    const first = await indexFragments(r, layout(size), () => {});
    expect(first.segments).toHaveLength(1);
    expect(first.segments[0].size).toBeLessThanOrEqual(MAX_SEGMENT_BYTES);
  });
});

describe("httpReader", () => {
  let server: Server;
  let origin: string;
  const body = Buffer.alloc(1000, 7);

  beforeAll(async () => {
    server = createServer((req, res) => {
      const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
      if (req.url === "/ignores-range" || !m) {
        res.writeHead(200, { "Content-Length": String(body.length) }).end(body);
      } else if (req.url === "/too-long") {
        // Claims a partial response but sends more than was asked for.
        res.writeHead(206, { "Content-Length": String(body.length) }).end(body);
      } else if (req.url === "/chunked-too-long") {
        res.writeHead(206);
        res.write(body.subarray(0, 500));
        res.end(body.subarray(500));
      } else {
        const part = body.subarray(Number(m[1]), Number(m[2]) + 1);
        res.writeHead(206, { "Content-Length": String(part.length) }).end(part);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("reads a byte range", async () => {
    expect((await httpReader(`${origin}/ok`, body.length).read(10, 20)).byteLength).toBe(20);
  });

  it.each(["/ignores-range", "/too-long", "/chunked-too-long"])("refuses %s, which sends more than the range asked for", async (url) => {
    await expect(httpReader(`${origin}${url}`, body.length).read(10, 20)).rejects.toThrow(/more bytes/);
  });

  it("accepts a whole-object answer when the whole object was asked for", async () => {
    expect((await httpReader(`${origin}/ignores-range`, body.length).read(0, body.length)).byteLength).toBe(body.length);
  });
});
