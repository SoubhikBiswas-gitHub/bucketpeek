import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Connection, TextChunk } from "@/lib/types";

const session = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock("@/lib/server/session", () => ({ getConnection: async () => session.connection }));

import { GET as textGET } from "@/app/api/files/text/route";
import { LocalStorage } from "@/lib/server/storage/local";
import { S3Storage } from "@/lib/server/storage/s3";
import { readTextChunk } from "@/lib/server/text-chunk";
import { makeBucket, type TempBucket } from "./helpers/bucket";

const CONN: Connection = {
  accessKeyId: "AKIAFAKEFAKEFAKE12",
  secretAccessKey: "x",
  bucket: "b",
  region: "ap-south-1",
};

// ASCII, 2-, 3- and 4-byte characters, repeated so chunks cut everywhere.
const MIXED = "line é€🤖 done\n".repeat(200);
const BOM = "﻿start";

let bucket: TempBucket;
let storage: LocalStorage;
let prevMockDir: string | undefined;

beforeAll(() => {
  bucket = makeBucket({ "t/mixed.txt": MIXED, "t/bom.txt": BOM, "t/zero.txt": "", "t/ascii.log": "abcdef" });
  storage = new LocalStorage(bucket.root);
  prevMockDir = process.env.LENS_MOCK_DIR;
  process.env.LENS_MOCK_DIR = bucket.root;
});
afterAll(() => {
  if (prevMockDir === undefined) delete process.env.LENS_MOCK_DIR;
  else process.env.LENS_MOCK_DIR = prevMockDir;
  bucket.cleanup();
});
beforeEach(() => {
  session.connection = CONN;
  vi.restoreAllMocks();
});

async function readAll(key: string, length: number, from = 0): Promise<{ text: string; chunks: TextChunk[] }> {
  const chunks: TextChunk[] = [];
  let offset: number | null = from;
  while (offset !== null && chunks.length < 10_000) {
    const c = await readTextChunk(storage, key, offset, length);
    if (chunks.length) expect(c.offset).toBe(offset);
    chunks.push(c);
    offset = c.nextOffset;
  }
  return { text: chunks.map((c) => c.text).join(""), chunks };
}

describe("readTextChunk", () => {
  it.each([1, 2, 3, 5, 7, 64, 1000, 1 << 20])("reassembles the file exactly with %d-byte chunks", async (length) => {
    const { text, chunks } = await readAll("t/mixed.txt", length);
    expect(text).toBe(MIXED);
    const total = Buffer.byteLength(MIXED);
    for (const c of chunks) {
      expect(c.total).toBe(total);
      expect(c.text).not.toContain("�");
      if (c.nextOffset !== null) {
        expect(c.nextOffset).toBeGreaterThan(c.offset);
        expect(c.nextOffset - c.offset).toBeLessThanOrEqual(length + 3);
        expect(Buffer.byteLength(c.text)).toBe(c.nextOffset - c.offset);
      }
    }
    expect(chunks.at(-1)!.nextOffset).toBeNull();
  });

  it("moves a start inside a character forward to the next character", async () => {
    const bytes = Buffer.from(MIXED);
    const euro = bytes.indexOf(Buffer.from("€"));
    const c = await readTextChunk(storage, "t/mixed.txt", euro + 1, 10);
    expect(c.offset).toBe(euro + 3);
    expect(c.text.startsWith("🤖")).toBe(true);
  });

  it("strips a BOM only at the start of the file", async () => {
    expect((await readTextChunk(storage, "t/bom.txt", 0, 100)).text).toBe("start");
    expect((await readTextChunk(storage, "t/bom.txt", 3, 100)).text).toBe("start");
  });

  it("handles empty files and offsets past the end", async () => {
    expect(await readTextChunk(storage, "t/zero.txt", 0, 10)).toEqual({ text: "", offset: 0, nextOffset: null, total: 0 });
    expect(await readTextChunk(storage, "t/ascii.log", 99, 10)).toEqual({ text: "", offset: 6, nextOffset: null, total: 6 });
    expect(await readTextChunk(storage, "t/ascii.log", 2, 2)).toEqual({ text: "cd", offset: 2, nextOffset: 4, total: 6 });
    expect(await readTextChunk(storage, "t/ascii.log", 4, 100)).toEqual({ text: "ef", offset: 4, nextOffset: null, total: 6 });
  });

  it("reads byte ranges from S3", async () => {
    const data = Buffer.from("héllo world");
    const ranges: string[] = [];
    vi.spyOn(S3Client.prototype, "send").mockImplementation((async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) return { ContentLength: data.length };
      const range = (cmd as GetObjectCommand).input.Range!;
      ranges.push(range);
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range)!;
      return { Body: { transformToByteArray: async () => new Uint8Array(data.subarray(Number(a), Number(b) + 1)) } };
    }) as never);
    const s3 = new S3Storage(CONN);
    const c = await readTextChunk(s3, "k.txt", 2, 3); // offset 2 is inside "é"
    expect(ranges).toEqual(["bytes=2-10"]);
    expect(c).toEqual({ text: "llo", offset: 3, nextOffset: 6, total: data.length });
  });
});

describe("GET /api/files/text", () => {
  const get = async (qs: string) => {
    const r = await textGET(new Request(`http://127.0.0.1:3100/api/files/text?${qs}`));
    return { r, body: await r.json() };
  };

  it("returns a TextChunk with no-store caching", async () => {
    const { r, body } = await get("key=t/ascii.log&offset=1&length=3");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({ text: "bcd", offset: 1, nextOffset: 4, total: 6 });
  });

  it("defaults to offset 0 and 512 KB", async () => {
    const { body } = await get("key=t/mixed.txt");
    expect(body.offset).toBe(0);
    expect(body.text).toBe(MIXED);
    expect(body.nextOffset).toBeNull();
  });

  it("400s for bad input", async () => {
    for (const qs of ["", "key=", "key=t/", "key=t/ascii.log&offset=-1", "key=t/ascii.log&length=0", `key=t/ascii.log&length=${4 * 1024 * 1024 + 1}`]) {
      const { r, body } = await get(qs);
      expect(r.status, qs).toBe(400);
      expect(body.error.status).toBe(400);
    }
  });

  it("401s without a session and 404s for missing files", async () => {
    expect((await get("key=t/nope.txt")).r.status).toBe(404);
    expect((await get(`key=${encodeURIComponent("../outside/secret.txt")}`)).r.status).toBe(403);
    session.connection = null;
    const { r, body } = await get("key=t/ascii.log");
    expect(r.status).toBe(401);
    expect(body.error.title).toBe("Not connected");
  });
});
