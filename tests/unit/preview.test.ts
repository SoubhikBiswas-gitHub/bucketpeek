import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ffmpeg = vi.hoisted(() => ({ available: true }));
vi.mock("@/lib/server/convert", () => ({ ffmpegAvailable: async () => ffmpeg.available }));

import { buildPreview, looksBinary, prettyJson, TABLE_PREVIEW_ROWS, TEXT_PREVIEW_BYTES } from "@/lib/server/preview";
import { LocalStorage } from "@/lib/server/storage/local";
import type { Storage } from "@/lib/server/storage";
import type { FileMeta, Preview } from "@/lib/types";
import { makeBucket, type TempBucket } from "./helpers/bucket";

const BUCKET = { bucket: "deccan-physical-ai-corpus", region: "ap-south-1" };

const csvRows = (n: number) => ["id,name", ...Array.from({ length: n }, (_, i) => `${i},row ${i}`)].join("\n") + "\n";

let bucket: TempBucket;
let storage: LocalStorage;

beforeAll(() => {
  bucket = makeBucket({
    "t/data.csv": 'id,name,note\n1,alpha,"has, comma"\n2,beta,"multi\nline"\n',
    "t/data.tsv": "a\tb\n1\t2\n",
    "t/semi.csv": "a;b;c\n1;2;3\n",
    "t/exact.csv": csvRows(TABLE_PREVIEW_ROWS),
    "t/many.csv": csvRows(TABLE_PREVIEW_ROWS + 50),
    "t/header_only.csv": "a,b,c\n",
    "j/pretty.json": '{"a":[1,2],"b":{"c":null}}',
    "j/bigint.json": '{"id":12345678901234567890,"t":1.50,"e":1e400,"ok":1}',
    "j/invalid.json": "{not json",
    "j/huge.json": JSON.stringify({ items: Array.from({ length: 40000 }, (_, i) => ({ i, s: "abcdefgh" })) }),
    "j/primitive.json": "42",
    "d/README.md": "# Title\n\nBody",
    "d/load.py": "import json\nprint(1)\n",
    "d/capture.log": "\u001b[32mINFO\u001b[0m started\n",
    "d/bin.txt": Buffer.from([0x68, 0x69, 0x00, 0x01, 0x02]),
    "d/ctrl.log": Buffer.from(Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 0x01 : 0x41))),
    "d/utf16.txt": Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]),
    "e/empty.csv": "",
    "e/empty.json": "",
    "e/empty.md": "",
    "e/empty.py": "",
    "m/pic.png": "png",
    "m/pic.svg": "<svg/>",
    "m/song.mp3": "mp3",
    "m/doc.pdf": "%PDF",
    "m/ep.mp4": "mp4",
    "m/ep.avi": "avi",
    "m/c.zip": "zip",
    "m/blob.bin": "bin",
  });
  storage = new LocalStorage(bucket.root);
});
afterAll(() => bucket.cleanup());
beforeEach(() => {
  ffmpeg.available = true;
});

const preview = async (key: string) => buildPreview(storage, await storage.head(key), BUCKET);
type Of<T extends Preview["type"]> = Extract<Preview, { type: T }> extends never ? Extract<Preview, { text: string }> : Extract<Preview, { type: T }>;

describe("table previews", () => {
  it("parses header and rows, honoring quotes and newlines in cells", async () => {
    const p = (await preview("t/data.csv")) as Of<"table">;
    expect(p.type).toBe("table");
    expect(p.header).toEqual(["id", "name", "note"]);
    expect(p.rows).toEqual([
      ["1", "alpha", "has, comma"],
      ["2", "beta", "multi\nline"],
    ]);
    expect(p).toMatchObject({ truncated: false, rowsTruncated: false });
  });

  it("uses tabs for TSV and detects other delimiters", async () => {
    expect(await preview("t/data.tsv")).toMatchObject({ header: ["a", "b"], rows: [["1", "2"]] });
    expect(await preview("t/semi.csv")).toMatchObject({ header: ["a", "b", "c"], rows: [["1", "2", "3"]] });
  });

  it("does not flag a file with exactly the row limit", async () => {
    const p = (await preview("t/exact.csv")) as Of<"table">;
    expect(p.rows).toHaveLength(TABLE_PREVIEW_ROWS);
    expect(p.rowsTruncated).toBe(false);
  });

  it("caps rows and flags it", async () => {
    const p = (await preview("t/many.csv")) as Of<"table">;
    expect(p.rows).toHaveLength(TABLE_PREVIEW_ROWS);
    expect(p.rows.at(-1)).toEqual([String(TABLE_PREVIEW_ROWS - 1), `row ${TABLE_PREVIEW_ROWS - 1}`]);
    expect(p).toMatchObject({ rowsTruncated: true, truncated: false });
  });

  it("handles a header-only file", async () => {
    expect(await preview("t/header_only.csv")).toMatchObject({ header: ["a", "b", "c"], rows: [], rowsTruncated: false });
  });

  it("drops a row cut in half by the byte limit", async () => {
    const b = makeBucket({ "cut.csv": "a,b\n" + Array.from({ length: 30000 }, (_, i) => `${i},${"y".repeat(30)}`).join("\n") });
    try {
      const s = new LocalStorage(b.root);
      const file = await s.head("cut.csv");
      expect(file.size).toBeGreaterThan(TEXT_PREVIEW_BYTES);
      const p = (await buildPreview(s, file, BUCKET)) as Of<"table">;
      expect(p.truncated).toBe(true);
      expect(p.rowsTruncated).toBe(true);
      for (const row of p.rows) expect(row[1]).toHaveLength(30);
    } finally {
      b.cleanup();
    }
  });
});

describe("json previews", () => {
  it("pretty-prints valid JSON", async () => {
    expect(await preview("j/pretty.json")).toEqual({
      type: "json",
      text: '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}',
      truncated: false,
      lang: "json",
    });
    expect(await preview("j/primitive.json")).toMatchObject({ type: "json", text: "42" });
  });

  it("keeps big integers and number literals exactly as written", async () => {
    const p = (await preview("j/bigint.json")) as Of<"json">;
    expect(p.text).toContain("12345678901234567890");
    expect(p.text).toContain("1.50");
    expect(p.text).toContain("1e400");
    expect(p.text).toContain('"ok": 1');
  });

  it("shows invalid JSON as raw code", async () => {
    expect(await preview("j/invalid.json")).toEqual({ type: "code", text: "{not json", truncated: false, lang: "" });
  });

  it("falls back to raw text when the JSON was truncated", async () => {
    const p = (await preview("j/huge.json")) as Of<"json">;
    expect(p).toMatchObject({ type: "json", truncated: true, lang: "json" });
    expect(p.text.startsWith('{"items":[{"i":0')).toBe(true);
    expect(Buffer.byteLength(p.text)).toBeLessThanOrEqual(TEXT_PREVIEW_BYTES);
  });

  it("prettyJson returns null on invalid input", () => {
    expect(prettyJson("")).toBeNull();
    expect(prettyJson("[1,")).toBeNull();
    expect(prettyJson("[]")).toBe("[]");
  });
});

describe("text previews", () => {
  it("returns markdown, code and log text with a language", async () => {
    expect(await preview("d/README.md")).toEqual({ type: "markdown", text: "# Title\n\nBody", truncated: false, lang: "markdown" });
    expect(await preview("d/load.py")).toMatchObject({ type: "code", lang: "python" });
    expect(await preview("d/capture.log")).toMatchObject({ type: "text", lang: "log" });
  });

  it("decodes UTF-16 text", async () => {
    expect(await preview("d/utf16.txt")).toMatchObject({ type: "text", text: "hi" });
  });

  it("gives up on binary-looking text", async () => {
    expect(await preview("d/bin.txt")).toEqual({ type: "none" });
    expect(await preview("d/ctrl.log")).toEqual({ type: "none" });
  });

  it("handles empty files of every text kind", async () => {
    expect(await preview("e/empty.csv")).toEqual({ type: "text", text: "", truncated: false, lang: "" });
    expect(await preview("e/empty.json")).toEqual({ type: "json", text: "", truncated: false, lang: "json" });
    expect(await preview("e/empty.md")).toMatchObject({ type: "markdown", text: "" });
    expect(await preview("e/empty.py")).toMatchObject({ type: "code", text: "", lang: "python" });
  });

  it("looksBinary tolerates normal text", () => {
    expect(looksBinary("")).toBe(false);
    expect(looksBinary("plain\ttext\r\n\fwith breaks")).toBe(false);
    expect(looksBinary("café naïve")).toBe(false);
    expect(looksBinary("a�".repeat(10))).toBe(true);
  });
});

describe("media previews", () => {
  const url = (p: Preview) => new URL((p as { url: string }).url, "http://lens.local");

  it("links images, audio and PDFs", async () => {
    expect((await preview("m/pic.png")).type).toBe("image");
    expect((await preview("m/pic.svg")).type).toBe("image");
    expect((await preview("m/song.mp3")).type).toBe("audio");
    const pdf = await preview("m/doc.pdf");
    expect(pdf.type).toBe("pdf");
    expect(url(pdf).searchParams.get("type")).toBe("application/pdf");
  });

  it("plays native video directly and converts the rest when ffmpeg exists", async () => {
    expect(await preview("m/ep.mp4")).toMatchObject({ type: "video", mode: "direct", canConvert: true });
    expect(await preview("m/ep.avi")).toMatchObject({ type: "video", mode: "convert", canConvert: true });
    ffmpeg.available = false;
    expect(await preview("m/ep.avi")).toMatchObject({ type: "video", mode: "unsupported", canConvert: false });
    expect(await preview("m/ep.mp4")).toMatchObject({ mode: "direct", canConvert: false });
  });

  it("fixes generic stored content types for media", async () => {
    const signed: unknown[] = [];
    const fake: Storage = {
      list: vi.fn(),
      head: vi.fn(),
      details: vi.fn(),
      readStart: vi.fn(),
      readBytes: vi.fn(),
      signedUrl: async (key, o) => {
        signed.push(o);
        return `https://s3.example/${key}`;
      },
    };
    const base = await storage.head("m/ep.mp4");
    await buildPreview(fake, { ...base, contentType: "binary/octet-stream" } as FileMeta, BUCKET);
    await buildPreview(fake, { ...base, contentType: "video/mp4" } as FileMeta, BUCKET);
    expect(signed).toEqual([{ contentType: "video/mp4" }, {}]);
  });

  it("has no preview for archives and unknown files", async () => {
    expect(await preview("m/c.zip")).toEqual({ type: "none" });
    expect(await preview("m/blob.bin")).toEqual({ type: "none" });
  });
});

describe("failures", () => {
  it("turns storage errors into an error preview", async () => {
    const denied = Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    const fake: Storage = {
      list: vi.fn(),
      head: vi.fn(),
      details: vi.fn(),
      readStart: async () => {
        throw denied;
      },
      readBytes: vi.fn(),
      signedUrl: async () => {
        throw denied;
      },
    };
    const text = await storage.head("d/README.md");
    expect(await buildPreview(fake, text, BUCKET)).toMatchObject({ type: "error", title: "Access denied" });
    const img = await storage.head("m/pic.png");
    expect(await buildPreview(fake, img, BUCKET)).toMatchObject({ type: "error", title: "Access denied" });
  });
});

describe("playback plan cache", () => {
  // ftyp + one mdat to the end: media without an index.
  const noIndex = Buffer.alloc(4096);
  noIndex.writeUInt32BE(16, 0);
  noIndex.write("ftypisom", 4, "latin1");
  noIndex.writeUInt32BE(4096 - 16, 16);
  noIndex.write("mdat", 20, "latin1");

  const fakeStorage = (readBytes: Storage["readBytes"]) => {
    const read = vi.fn(readBytes);
    const s: Storage = { list: vi.fn(), head: vi.fn(), details: vi.fn(), readStart: vi.fn(), readBytes: read, signedUrl: async (key) => `https://s3.example/${key}` };
    return { s, read };
  };

  it("keeps plans for the same key and version in different buckets apart", async () => {
    const base = await storage.head("m/ep.mp4");
    const file = { ...base, key: "shared/clip.mp4", name: "clip.mp4", size: noIndex.length, modified: "2026-01-01T00:00:00.000Z" } as FileMeta;
    const a = fakeStorage(async (_key, offset, length) => new Uint8Array(noIndex.subarray(offset, offset + length)));
    expect(await buildPreview(a.s, file, { bucket: "bucket-a", region: "ap-south-1" })).toMatchObject({ type: "error", title: "This video has no index" });

    // Another bucket's object with the same key, size and time is its own file.
    const b = fakeStorage(async () => {
      throw new Error("unreadable");
    });
    expect(await buildPreview(b.s, file, { bucket: "bucket-b", region: "ap-south-1" })).toMatchObject({ type: "video", mode: "direct" });
    expect(b.read).toHaveBeenCalled();
    expect(await buildPreview(b.s, file, { bucket: "bucket-a", region: "eu-west-1" })).toMatchObject({ type: "video", mode: "direct" });

    // The same bucket still uses its cached plan.
    const again = fakeStorage(async () => {
      throw new Error("not read");
    });
    expect(await buildPreview(again.s, file, { bucket: "bucket-a", region: "ap-south-1" })).toMatchObject({ type: "error" });
    expect(again.read).not.toHaveBeenCalled();
  });
});
