import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedUrlOptions } from "@/lib/server/storage/types";
import type { Connection, FileMeta } from "@/lib/types";

// Presigned link lifetimes chosen by /api/files/{open,download}. Storage is faked so a file can be
// any size; routes.test.ts covers the same routes against a real local bucket.

const session = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock("@/lib/server/session", () => ({ getConnection: async () => session.connection }));

const storage = vi.hoisted(() => ({
  size: 0,
  head: vi.fn(),
  signedUrl: vi.fn(),
}));
vi.mock("@/lib/server/storage", () => ({ storageFor: () => storage }));

import { GET as downloadGET } from "@/app/api/files/download/route";
import { GET as openGET } from "@/app/api/files/open/route";

const CONNECTION: Connection = {
  accessKeyId: "AKIAFAKEFAKEFAKE12",
  secretAccessKey: "secret",
  bucket: "deccan-physical-ai-corpus",
  region: "ap-south-1",
};
const KEY = "site-a/cam 1/take.mp4";
const SIGNED = "https://deccan-physical-ai-corpus.s3.ap-south-1.amazonaws.com/signed?X-Amz-Signature=abc";
const GB = 1e9;
const HOUR = 3600;

const meta = (size: number): FileMeta => ({
  key: KEY,
  name: "take.mp4",
  ext: "mp4",
  kind: "video",
  type: "MP4",
  size,
  modified: null,
  contentType: "video/mp4",
});

// `stale` is extra cookie data, like the linkExpiry older cookies still carry.
async function download(size: number, stale: object = {}): Promise<{ r: Response; options: SignedUrlOptions }> {
  session.connection = { ...CONNECTION, ...stale };
  storage.head.mockResolvedValue(meta(size));
  const r = await downloadGET(new Request(`http://127.0.0.1/api/files/download?key=${encodeURIComponent(KEY)}`));
  expect(storage.head).toHaveBeenCalledWith(KEY);
  expect(storage.signedUrl).toHaveBeenCalledTimes(1);
  const [key, options] = storage.signedUrl.mock.calls[0] as [string, SignedUrlOptions];
  expect(key).toBe(KEY);
  return { r, options };
}

beforeEach(() => {
  storage.head.mockReset();
  storage.signedUrl.mockReset().mockResolvedValue(SIGNED);
});

describe("download link lifetime", () => {
  it("gives a small file a 15-minute link and redirects to it", async () => {
    const { r, options } = await download(20 * 1024 * 1024);
    expect(options).toEqual({ download: true, expiresIn: 900 });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(SIGNED);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps the short link at exactly 5 GB", async () => {
    expect((await download(5 * GB)).options.expiresIn).toBe(900);
  });

  it("gives a file over 5 GB a 12-hour link, so a dropped download can resume", async () => {
    for (const size of [5 * GB + 1, 20 * GB, 50 * GB]) {
      storage.signedUrl.mockClear();
      const { r, options } = await download(size);
      expect(options, `${size} bytes`).toEqual({ download: true, expiresIn: 12 * HOUR });
      expect(r.headers.get("location")).toBe(SIGNED);
    }
  });

  it("ignores a link expiry left in an older cookie", async () => {
    expect((await download(20 * GB, { linkExpiry: 600 })).options).toEqual({ download: true, expiresIn: 12 * HOUR });
    storage.signedUrl.mockClear();
    expect((await download(20 * 1024, { linkExpiry: 7 * 24 * HOUR })).options.expiresIn).toBe(900);
  });
});

describe("open link lifetime", () => {
  it("stays at an hour inline, whatever the size", async () => {
    session.connection = CONNECTION;
    storage.head.mockResolvedValue(meta(50 * GB));
    const r = await openGET(new Request(`http://127.0.0.1/api/files/open?key=${encodeURIComponent(KEY)}`));
    expect(storage.signedUrl).toHaveBeenCalledWith(KEY, { contentType: "video/mp4", expiresIn: HOUR });
    expect(r.headers.get("location")).toBe(SIGNED);
  });
});
