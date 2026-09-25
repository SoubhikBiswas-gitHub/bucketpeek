import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "@/lib/types";

const session = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock("@/lib/server/session", () => ({ getConnection: async () => session.connection }));

// What the caller's own credentials get back from S3.
const bucket = vi.hoisted(() => ({
  head: null as unknown as (key: string) => Promise<{ size: number; modified: string | null }>,
  signedUrl: null as unknown as (key: string) => Promise<string>,
  heads: [] as { accessKeyId: string; key: string }[],
}));
vi.mock("@/lib/server/storage", () => ({
  storageFor: (c: Connection) => ({
    head: (key: string) => {
      bucket.heads.push({ accessKeyId: c.accessKeyId, key });
      return bucket.head(key);
    },
    signedUrl: (key: string) => bucket.signedUrl(key),
  }),
}));

type Hls = typeof import("@/app/api/hls/[id]/[file]/route");
type Status = typeof import("@/app/api/convert/[id]/route");
type Convert = typeof import("@/lib/server/convert");
type Access = typeof import("@/lib/server/stream-access");

const OWNER: Connection = {
  accessKeyId: "AKIAOWNEROWNEROWNER1",
  secretAccessKey: "owner-secret",
  bucket: "deccan-physical-ai-corpus",
  region: "ap-south-1",
};
const OUTSIDER: Connection = { ...OWNER, accessKeyId: "AKIAOUTSIDEROUTSIDE1", secretAccessKey: "outsider-secret" };
const KEY = "restricted/clip.avi";
const MODIFIED = "2026-01-01T00:00:00.000Z";
const SEGMENT = "converted segment bytes";
const FRAG_KEY = "restricted/fragmented.mp4";

let work: string;
let hls: Hls;
let status: Status;
let convert: Convert;
let access: Access;
let id: string;

const denied = () => Object.assign(new Error("Forbidden"), { name: "Forbidden", $metadata: { httpStatusCode: 403 } });

beforeAll(async () => {
  work = mkdtempSync(path.join(os.tmpdir(), "lens-access-"));
  vi.stubEnv("LENS_HLS_DIR", work);
  convert = await import("@/lib/server/convert");
  hls = await import("@/app/api/hls/[id]/[file]/route");
  status = await import("@/app/api/convert/[id]/route");
  access = await import("@/lib/server/stream-access");
  // A video converted earlier, left in the cache.
  id = convert.jobId(OWNER.bucket, KEY);
  mkdirSync(path.join(work, id), { recursive: true });
  writeFileSync(path.join(work, id, "meta.json"), JSON.stringify({ bucket: OWNER.bucket, key: KEY, version: `${SEGMENT.length}:${MODIFIED}`, duration: 8, kind: "transcode" }));
  writeFileSync(path.join(work, id, "seg_00000.ts"), SEGMENT);
  // A fragmented MP4 whose second segment is too big to buffer.
  const frag = convert.jobId(OWNER.bucket, FRAG_KEY);
  mkdirSync(path.join(work, frag), { recursive: true });
  const fragments = {
    initSize: 100,
    segments: [
      { offset: 100, size: 1000, time: 0, duration: 2 },
      { offset: 1100, size: 200 * 1024 * 1024, time: 2, duration: 2 },
    ],
    complete: true,
  };
  writeFileSync(
    path.join(work, frag, "meta.json"),
    JSON.stringify({ bucket: OWNER.bucket, key: FRAG_KEY, version: `${SEGMENT.length}:${MODIFIED}`, duration: 4, kind: "fragments", fragments }),
  );
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(work, { recursive: true, force: true });
});
beforeEach(() => {
  access.forgetStreamAccess();
  bucket.heads = [];
  session.connection = OWNER;
  bucket.head = async () => ({ size: SEGMENT.length, modified: MODIFIED });
  bucket.signedUrl = async (key) => `https://s3.example/${key}?X-Amz-Signature=abc`;
});

const get = (file: string, streamId = id) =>
  hls.GET(new NextRequest(`http://127.0.0.1:3000/api/hls/${streamId}/${file}`), { params: Promise.resolve({ id: streamId, file }) });
const getStatus = (streamId = id) =>
  status.GET(new Request(`http://127.0.0.1:3000/api/convert/${streamId}`), { params: Promise.resolve({ id: streamId }) });

describe("GET /api/hls/:id/:file", () => {
  it("serves a cached segment to credentials that can read the object", async () => {
    const r = await get("seg_00000.ts");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(SEGMENT);
    expect(bucket.heads).toEqual([{ accessKeyId: OWNER.accessKeyId, key: KEY }]);
  });

  it("refuses the playlist and segments to credentials S3 denies, though the id is guessable", async () => {
    session.connection = OUTSIDER;
    bucket.head = async () => {
      throw denied();
    };
    for (const file of [convert.PLAYLIST, "seg_00000.ts"]) {
      const r = await get(file);
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain(SEGMENT);
    }
    expect(bucket.heads.every((h) => h.accessKeyId === OUTSIDER.accessKeyId)).toBe(true);
  });

  it("refuses a cache made from another version of the object", async () => {
    bucket.head = async () => ({ size: SEGMENT.length + 1, modified: MODIFIED });
    expect((await get("seg_00000.ts")).status).toBe(404);
  });

  it("remembers an allowed check for a minute per set of credentials", async () => {
    for (let i = 0; i < 5; i++) expect((await get("seg_00000.ts")).status).toBe(200);
    expect(bucket.heads).toHaveLength(1);
    // Other credentials are checked on their own.
    session.connection = OUTSIDER;
    bucket.head = async () => {
      throw denied();
    };
    expect((await get("seg_00000.ts")).status).toBe(404);
    expect(bucket.heads).toHaveLength(2);
    // And a denial isn't remembered: access granted later works at once.
    bucket.head = async () => ({ size: SEGMENT.length, modified: MODIFIED });
    expect((await get("seg_00000.ts")).status).toBe(200);
  });

  it("checks again once the minute is over", async () => {
    const stream = (await convert.getStream(id, OWNER.bucket))!;
    expect(await access.checkStreamAccess(OWNER, stream, 1_000)).toEqual({ ok: true });
    expect(await access.checkStreamAccess(OWNER, stream, 30_000)).toEqual({ ok: true });
    expect(bucket.heads).toHaveLength(1);
    bucket.head = async () => {
      throw denied();
    };
    expect(await access.checkStreamAccess(OWNER, stream, 62_000)).toMatchObject({ ok: false, status: 404 });
  });

  it("doesn't pass an unexpected error's message (which may hold a signed link) to the browser", async () => {
    bucket.signedUrl = async () => {
      throw new Error("failed https://s3.example/clip.avi?X-Amz-Signature=deadbeefcafe");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // Segment 1 isn't converted yet, so the route signs a link for ffmpeg, which fails here.
    const r = await get("seg_00001.ts");
    expect(r.status).toBe(500);
    const body = await r.text();
    expect(body).not.toContain("deadbeef");
    expect(body).not.toContain("https://");
    expect(String(log.mock.calls[0]?.[0])).not.toContain("deadbeefcafe");
  });
});

describe("fragment segments", () => {
  it("refuses a segment over the size cap before fetching or buffering it", async () => {
    const signed: string[] = [];
    bucket.signedUrl = async (key) => {
      signed.push(key);
      return `http://127.0.0.1:9/${key}`;
    };
    const r = await get("frag_00001.m4s", convert.jobId(OWNER.bucket, FRAG_KEY));
    expect(r.status).toBe(422);
    expect(signed).toEqual([]);
  });
});

describe("GET /api/convert/:id", () => {
  it("answers for credentials that can read the object", async () => {
    const r = await getStatus();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ failed: false, error: "" });
  });

  it("is unknown to credentials S3 denies", async () => {
    session.connection = OUTSIDER;
    bucket.head = async () => {
      throw denied();
    };
    expect((await getStatus()).status).toBe(404);
  });

  it("is unknown for a stream that doesn't exist", async () => {
    expect((await getStatus(convert.jobId(OWNER.bucket, "nope.avi"))).status).toBe(404);
  });
});
