import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VirtualMp4 } from "@/lib/server/playable";

const mocks = vi.hoisted(() => ({
  httpReader: vi.fn(),
  inspectMp4: vi.fn(),
  buildPlayable: vi.fn(),
}));
vi.mock("@/lib/server/http-reader", () => ({ httpReader: mocks.httpReader }));
vi.mock("@/lib/server/mp4", () => ({ inspectMp4: mocks.inspectMp4, MAX_FASTSTART_INDEX: 32 * 1024 * 1024 }));
vi.mock("@/lib/server/playable", () => ({ buildPlayable: mocks.buildPlayable }));

import { playableUrl, playableView } from "@/lib/server/playable-cache";

const MB = 1024 * 1024;
const cache = () => (globalThis as unknown as { __lensPlayable: Map<string, Promise<VirtualMp4 | null>> }).__lensPlayable;
const idOf = (key: string, version = "v1", bucket = "b") => `${bucket}\n${key}\n${version}`;
const view = (memory: number): VirtualMp4 => ({ size: 1, pieces: [], fixes: { faststart: true, repair: null }, memory });

// Memory of the view built for each key, by key.
let memoryByKey: Record<string, number>;

beforeEach(() => {
  cache().clear();
  memoryByKey = {};
  mocks.httpReader.mockImplementation((url: string, size: number) => ({ url, size, read: async () => new Uint8Array() }));
  mocks.inspectMp4.mockImplementation(async (reader: { url: string }) => ({ indexRead: true, source: reader.url }));
  mocks.buildPlayable.mockImplementation(async (_reader: unknown, layout: { source: string }) =>
    view(memoryByKey[new URL(layout.source).pathname.slice(1)] ?? 1),
  );
});

const open = (key: string, version = "v1", bucket = "b") => playableView(bucket, key, version, `http://src.test/${key}`, 1000);

describe("playableView", () => {
  it("reads the source through an HTTP reader with the faststart index cap", async () => {
    memoryByKey.a = 7;
    const v = await open("a");
    expect(v?.memory).toBe(7);
    expect(mocks.httpReader).toHaveBeenCalledWith("http://src.test/a", 1000);
    expect(mocks.inspectMp4).toHaveBeenCalledWith(expect.objectContaining({ url: "http://src.test/a" }), { maxMoovBytes: 32 * MB });
  });

  it("is null without building when the index is too big to read", async () => {
    mocks.inspectMp4.mockResolvedValue({ indexRead: false });
    expect(await open("a")).toBeNull();
    expect(mocks.buildPlayable).not.toHaveBeenCalled();
  });

  it("builds once per bucket, key and version, sharing the promise", async () => {
    const first = open("a");
    expect(open("a")).toBe(first);
    await first;
    expect(open("a")).toBe(first);
    expect(mocks.inspectMp4).toHaveBeenCalledTimes(1);

    await Promise.all([open("a", "v2"), open("b"), open("a", "v1", "other")]);
    expect(mocks.inspectMp4).toHaveBeenCalledTimes(4);
  });

  it("turns a failed inspection or build into a cached null", async () => {
    mocks.inspectMp4.mockRejectedValueOnce(new Error("bucket unreachable"));
    expect(await open("a")).toBeNull();
    mocks.buildPlayable.mockRejectedValueOnce(new Error("bad index"));
    expect(await open("b")).toBeNull();
    expect(await open("a")).toBeNull();
    expect(mocks.inspectMp4).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest views once the kept indexes pass 256 MB", async () => {
    Object.assign(memoryByKey, { old: 200 * MB, mid: 50 * MB, new: 10 * MB });
    await open("old");
    await open("mid");
    await new Promise((resolve) => setImmediate(resolve));
    expect([...cache().keys()]).toEqual([idOf("old"), idOf("mid")]);
    await open("new");
    await vi.waitFor(() => expect([...cache().keys()]).toEqual([idOf("mid"), idOf("new")]));
  });

  it("keeps a recently used view over an older unused one", async () => {
    Object.assign(memoryByKey, { a: 100 * MB, b: 100 * MB, c: 100 * MB });
    await open("a");
    await open("b");
    await open("a");
    await open("c");
    await vi.waitFor(() => expect([...cache().keys()]).toEqual([idOf("a"), idOf("c")]));
    await open("a");
    expect(mocks.inspectMp4).toHaveBeenCalledTimes(3);
  });

  it("drops a single view bigger than the whole cap", async () => {
    memoryByKey.huge = 300 * MB;
    expect((await open("huge"))?.memory).toBe(300 * MB);
    await vi.waitFor(() => expect(cache().size).toBe(0));
  });

  it("counts views that need no fix as free", async () => {
    mocks.buildPlayable.mockResolvedValueOnce(null);
    await open("none");
    memoryByKey.big = 250 * MB;
    await open("big");
    // Eviction runs on already-settled promises, so one macrotask lets it finish.
    await new Promise((resolve) => setImmediate(resolve));
    expect([...cache().keys()]).toEqual([idOf("none"), idOf("big")]);
  });
});

describe("playableUrl", () => {
  it("encodes the key as one query parameter", () => {
    expect(playableUrl("a b/c&d=é#.mp4")).toBe("/api/files/playable?key=a%20b%2Fc%26d%3D%C3%A9%23.mp4");
  });
});
