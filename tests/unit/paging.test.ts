import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { Connection, Listing } from "@/lib/types";

const session = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock("@/lib/server/session", () => ({ getConnection: async () => session.connection }));

import { GET as listGET } from "@/app/api/list/route";
import { describeError } from "@/lib/server/errors";
import { decodeCursor, encodeCursor } from "@/lib/server/storage/cursor";
import { LocalStorage } from "@/lib/server/storage/local";
import { S3Storage } from "@/lib/server/storage/s3";
import { makeBucket, type TempBucket } from "./helpers/bucket";

const CONN: Connection = {
  accessKeyId: "AKIAFAKEFAKEFAKE12",
  secretAccessKey: "x",
  bucket: "b",
  region: "ap-south-1",
};

let bucket: TempBucket;
let storage: LocalStorage;
let prevMockDir: string | undefined;

beforeAll(() => {
  const many: Record<string, string> = {};
  for (let i = 0; i < 25; i++) many[`many/f${String(i).padStart(2, "0")}.txt`] = "x";
  for (let i = 0; i < 5; i++) many[`many/d${i}/inner.txt`] = "y";
  bucket = makeBucket(many);
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
});
afterEach(() => vi.restoreAllMocks());

async function pageAll(list: (cursor: string | null) => Promise<Listing>): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await list(cursor);
    pages++;
    ids.push(...page.folders.map((f) => f.prefix), ...page.files.map((f) => f.key));
    expect(page.truncated).toBe(Boolean(page.nextCursor));
    cursor = page.nextCursor ?? null;
  } while (cursor && pages < 100);
  return { ids, pages };
}

describe("cursors", () => {
  it("round-trip a position for the same prefix only", () => {
    const c = encodeCursor("a/", "a/b.txt");
    expect(decodeCursor("a/", c)).toBe("a/b.txt");
    for (const prefix of ["b/", "", "a"]) expect(() => decodeCursor(prefix, c)).toThrow(/Invalid list cursor/);
  });

  it("reject tampering and garbage", () => {
    const c = encodeCursor("a/", "a/b.txt");
    const [payload, sig] = c.split(".");
    const forged = Buffer.from(JSON.stringify(["a/", "a/z.txt"])).toString("base64url");
    for (const bad of [`${forged}.${sig}`, `${payload}.x${sig.slice(1)}`, payload, `.${sig}`, "x".repeat(5000)]) {
      expect(() => decodeCursor("a/", bad)).toThrow(/Invalid list cursor/);
    }
    const e = (() => {
      try {
        decodeCursor("a/", "nope.nope");
      } catch (err) {
        return err;
      }
    })();
    expect(describeError(e)).toMatchObject({ title: "Page link expired", status: 400 });
  });
});

describe("LocalStorage paging", () => {
  it("returns every entry exactly once, in order, across pages", async () => {
    const all = await storage.list("many/", 5000);
    expect(all.nextCursor).toBeNull();
    const expected = [...all.folders.map((f) => f.prefix), ...all.files.map((f) => f.key)].sort((a, b) =>
      Buffer.compare(Buffer.from(a), Buffer.from(b)),
    );
    expect(expected).toHaveLength(30);

    for (const size of [1, 7, 29, 30]) {
      const { ids, pages } = await pageAll((c) => storage.list("many/", size, c));
      expect(ids.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))).toEqual(expected);
      expect(new Set(ids).size).toBe(30);
      expect(pages).toBe(Math.ceil(30 / size));
    }
  });

  it("rejects a cursor from another folder", async () => {
    const first = await storage.list("many/", 5);
    await expect(storage.list("", 5, first.nextCursor)).rejects.toMatchObject({ name: "InvalidCursor" });
  });
});

describe("S3Storage paging", () => {
  it("passes the decoded continuation token and returns the next one as a cursor", async () => {
    const tokens: (string | undefined)[] = [];
    vi.spyOn(S3Client.prototype, "send").mockImplementation((async (cmd: ListObjectsV2Command) => {
      tokens.push(cmd.input.ContinuationToken);
      if (!cmd.input.ContinuationToken) {
        return { Contents: [{ Key: "p/a.txt", Size: 1 }, { Key: "p/b.txt", Size: 1 }], IsTruncated: true, NextContinuationToken: "tok-1" };
      }
      return { Contents: [{ Key: "p/c.txt", Size: 1 }], IsTruncated: false };
    }) as never);
    const s3 = new S3Storage(CONN);
    const first = await s3.list("p/", 2);
    expect(first).toMatchObject({ truncated: true });
    expect(decodeCursor("p/", first.nextCursor!)).toBe("tok-1");
    const second = await s3.list("p/", 2, first.nextCursor);
    expect(second).toMatchObject({ truncated: false, nextCursor: null });
    expect(second.files.map((f) => f.key)).toEqual(["p/c.txt"]);
    expect(tokens).toEqual([undefined, "tok-1"]);
    await expect(s3.list("other/", 2, first.nextCursor)).rejects.toMatchObject({ name: "InvalidCursor" });
  });

  it("gives no cursor when S3 repeats a token", async () => {
    vi.spyOn(S3Client.prototype, "send").mockImplementation((async () => ({
      Contents: [],
      IsTruncated: true,
      NextContinuationToken: "same",
    })) as never);
    const s3 = new S3Storage(CONN);
    const page = await s3.list("", 10, encodeCursor("", "same"));
    expect(page).toMatchObject({ truncated: true, nextCursor: null });
  });
});

describe("GET /api/list paging", () => {
  const get = async (qs: string) => {
    const r = await listGET(new Request(`http://127.0.0.1:3100/api/list?${qs}`));
    return { status: r.status, body: await r.json() };
  };

  it("pages through a folder with cursor", async () => {
    const { ids } = await pageAll(async (cursor) => {
      const qs = new URLSearchParams({ prefix: "many/", limit: "4", ...(cursor ? { cursor } : {}) });
      const { status, body } = await get(qs.toString());
      expect(status).toBe(200);
      return body as Listing;
    });
    expect(new Set(ids).size).toBe(30);
  });

  it("defaults to 1000 per page", async () => {
    const { body } = await get("prefix=many/");
    expect(body.folders.length + body.files.length).toBe(30);
    expect(body.nextCursor).toBeNull();
  });

  it("400s for tampered, malformed or foreign cursors", async () => {
    const { body: first } = await get("prefix=many/&limit=3");
    const cursor = first.nextCursor as string;
    for (const qs of [
      `prefix=many/&cursor=${cursor.slice(0, -2)}xx`,
      "prefix=many/&cursor=not-a-cursor",
      `prefix=&cursor=${cursor}`,
    ]) {
      const { status, body } = await get(qs);
      expect(status, qs).toBe(400);
      expect(body.error.title).toBe("Page link expired");
    }
  });
});
