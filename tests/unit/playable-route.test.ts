import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { VirtualMp4 } from "@/lib/server/playable";
import type { Connection, FileMeta } from "@/lib/types";

const state = vi.hoisted(() => ({
  connection: null as Connection | null,
  head: null as unknown as (key: string) => Promise<FileMeta>,
  view: null as VirtualMp4 | null,
}));
const playableView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/session", () => ({ getConnection: async () => state.connection }));
vi.mock("@/lib/server/storage", () => ({ storageFor: () => ({ head: (key: string) => state.head(key) }) }));
vi.mock("@/app/api/convert/source", () => ({ sourceUrl: async (_c: Connection, key: string) => `http://bucket.test/${key}` }));
vi.mock("@/lib/server/playable-cache", () => ({ playableView }));

import { GET } from "@/app/api/files/playable/route";

const CONNECTION: Connection = { accessKeyId: "AKIAFAKEFAKEFAKE12", secretAccessKey: "secret", bucket: "bkt", region: "ap-south-1" };
const ORIGIN = "http://127.0.0.1:3100";
// Source bytes 0..39; the fixed file is source [0,10), 5 bytes in memory, then source [20,40): 35 bytes.
const SOURCE = Uint8Array.from({ length: 40 }, (_, i) => i);
const MEMORY = new Uint8Array([200, 201, 202, 203, 204]);
const VIEW: VirtualMp4 = {
  size: 35,
  pieces: [
    { from: "file", start: 0, end: 10 },
    { from: "memory", bytes: MEMORY },
    { from: "file", start: 20, end: 40 },
  ],
  fixes: { faststart: true, repair: null },
  memory: 5,
};
const VIRTUAL = [...SOURCE.subarray(0, 10), ...MEMORY, ...SOURCE.subarray(20, 40)];

const meta = (key: string, modified: string | null): FileMeta => ({
  key,
  name: key.split("/").pop()!,
  ext: "mp4",
  kind: "video",
  type: "MP4",
  size: 40,
  modified,
  contentType: "video/mp4",
});

const fetches: { range: string; signal: AbortSignal }[] = [];
let upstreamStatus = 206;

function fakeFetch(_url: string, init: RequestInit) {
  const range = new Headers(init.headers).get("range") ?? "";
  fetches.push({ range, signal: init.signal! });
  const [a, b] = /^bytes=(\d+)-(\d+)$/.exec(range)!.slice(1).map(Number);
  return Promise.resolve(new Response(SOURCE.slice(a, b + 1), { status: upstreamStatus }));
}

beforeEach(() => {
  state.connection = CONNECTION;
  state.head = async (key) => meta(key, "2026-01-01T00:00:00.000Z");
  playableView.mockImplementation(async () => VIEW);
  fetches.length = 0;
  upstreamStatus = 206;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const get = (headers: Record<string, string> = {}, key: string | null = "v/clip.mp4", signal?: AbortSignal) =>
  GET(new NextRequest(`${ORIGIN}/api/files/playable${key === null ? "" : `?key=${encodeURIComponent(key)}`}`, { headers, signal }));
const bytesOf = async (r: Response) => [...new Uint8Array(await r.arrayBuffer())];

describe("GET /api/files/playable", () => {
  it("asks to reconnect without a session", async () => {
    state.connection = null;
    const r = await get();
    expect(r.status).toBe(401);
    expect(playableView).not.toHaveBeenCalled();
  });

  it.each([null, "", "a\u0000b", "k".repeat(1025)])("answers 404 for the key %j", async (key) => {
    const r = await get({}, key);
    expect(r.status).toBe(404);
    expect(playableView).not.toHaveBeenCalled();
  });

  it("builds the view for this bucket, key and object version", async () => {
    await get();
    expect(playableView).toHaveBeenCalledWith("bkt", "v/clip.mp4", "40:2026-01-01T00:00:00.000Z", "http://bucket.test/v/clip.mp4", 40);
    state.head = async (key) => meta(key, null);
    await get();
    expect(playableView).toHaveBeenLastCalledWith("bkt", "v/clip.mp4", "40:", "http://bucket.test/v/clip.mp4", 40);
  });

  it("answers 422 when the video needs no fix or can't take one", async () => {
    playableView.mockResolvedValue(null);
    const r = await get();
    expect(r.status).toBe(422);
    expect(await r.text()).toMatch(/doesn’t need fixing/);
  });

  it("describes a storage failure without leaking credentials", async () => {
    state.head = async () => {
      throw Object.assign(new Error("gone for AKIAIOSFODNN7EXAMPLE"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    };
    const r = await get();
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("AKIA");
  });

  it("serves the whole fixed file without a range", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("content-length")).toBe("35");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("content-range")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await bytesOf(r)).toEqual(VIRTUAL);
    expect(fetches.map((f) => f.range)).toEqual(["bytes=0-9", "bytes=20-39"]);
  });

  it.each([
    ["bytes=0-4", 0, 4],
    ["bytes=8-16", 8, 16],
    ["bytes=12-", 12, 34],
    ["bytes=-5", 30, 34],
    ["bytes=-100", 0, 34],
    ["bytes=30-1000", 30, 34],
    ["bytes=34-34", 34, 34],
    [" bytes=0-0 ", 0, 0],
  ])("answers %j with 206 for bytes %i-%i", async (range, start, end) => {
    const r = await get({ range });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(`bytes ${start}-${end}/35`);
    expect(r.headers.get("content-length")).toBe(String(end - start + 1));
    expect(await bytesOf(r)).toEqual(VIRTUAL.slice(start, end + 1));
  });

  it("reads only the source bytes a range needs", async () => {
    await bytesOf(await get({ range: "bytes=10-14" }));
    expect(fetches).toEqual([]);
    await bytesOf(await get({ range: "bytes=12-20" }));
    expect(fetches.map((f) => f.range)).toEqual(["bytes=20-25"]);
  });

  it.each(["bytes=35-", "bytes=100-200", "bytes=5-2", "bytes=-0", "bytes=-", "bytes=0-1,4-5", "items=0-1", "bytes=a-b", "bytes 0-1"])(
    "answers %j with 416",
    async (range) => {
      const r = await get({ range });
      expect(r.status).toBe(416);
      expect(r.headers.get("content-range")).toBe("bytes */35");
      expect(fetches).toEqual([]);
    },
  );

  it("fails the body when the bucket doesn't answer with a partial response", async () => {
    upstreamStatus = 200;
    const r = await get();
    expect(r.status).toBe(200);
    await expect(r.arrayBuffer()).rejects.toThrow("The bucket answered 200.");
  });

  it("stops reading the bucket when the player cancels", async () => {
    const r = await get({ range: "bytes=0-34" });
    const reader = r.body!.getReader();
    const first = await reader.read();
    expect([...first.value!]).toEqual(VIRTUAL.slice(0, 10));
    await reader.cancel();
    expect(fetches).toHaveLength(1);
    expect(fetches[0].signal.aborted).toBe(true);
  });

  it("aborts the bucket read when the request is aborted", async () => {
    const client = new AbortController();
    const r = await get({}, "v/clip.mp4", client.signal);
    const reader = r.body!.getReader();
    await reader.read();
    client.abort();
    expect(fetches[0].signal.aborted).toBe(true);
  });
});
