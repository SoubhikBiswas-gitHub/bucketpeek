import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "@/lib/types";

const session = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock("@/lib/server/session", () => ({ getConnection: async () => session.connection }));

import { GET as mockGET, HEAD as mockHEAD } from "@/app/api/mock/route";
import { GET as openGET } from "@/app/api/files/open/route";
import { GET as downloadGET } from "@/app/api/files/download/route";
import { GET as listGET } from "@/app/api/list/route";
import { LocalStorage } from "@/lib/server/storage/local";
import { makeBucket, type TempBucket } from "./helpers/bucket";

const CONNECTION: Connection = {
  accessKeyId: "AKIAFAKEFAKEFAKE12",
  secretAccessKey: "secret",
  bucket: "deccan-physical-ai-corpus",
  region: "ap-south-1",
};
const ORIGIN = "http://127.0.0.1:3100";
const BODY = "0123456789abcdefghij"; // 20 bytes

let bucket: TempBucket;
let storage: LocalStorage;
let prevMockDir: string | undefined;

beforeAll(() => {
  bucket = makeBucket({
    "v/clip.mp4": BODY,
    "v/zero.mp4": "",
    "v/page.html": "<script>alert(1)</script>",
    "v/image.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
    "v/файл 1+1#.txt": "unicode",
    "v/noext": "raw",
  });
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
  session.connection = CONNECTION;
});

const req = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers });

describe("GET /api/mock", () => {
  const link = (key: string, o?: Parameters<LocalStorage["signedUrl"]>[1]) => storage.signedUrl(key, o);

  it("serves the whole file with S3-like headers", async () => {
    const r = await mockGET(req(await link("v/clip.mp4")));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(BODY);
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("content-length")).toBe("20");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("content-disposition")).toBe('inline; filename="clip.mp4"');
    expect(r.headers.get("etag")).toMatch(/^".+"$/);
    expect(r.headers.get("content-security-policy")).toBeNull();
  });

  it.each([
    ["bytes=0-4", "bytes 0-4/20", "01234"],
    ["bytes=15-", "bytes 15-19/20", "fghij"],
    ["bytes=-3", "bytes 17-19/20", "hij"],
    ["bytes=18-100", "bytes 18-19/20", "ij"],
  ])("answers %s with 206", async (range, contentRange, body) => {
    const r = await mockGET(req(await link("v/clip.mp4"), { range }));
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(contentRange);
    expect(r.headers.get("content-length")).toBe(String(body.length));
    expect(await r.text()).toBe(body);
  });

  it.each(["bytes=20-", "bytes=100-200", "bytes=-0"])("answers %s with 416", async (range) => {
    const r = await mockGET(req(await link("v/clip.mp4"), { range }));
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe("bytes */20");
  });

  it("ignores malformed and multi-part ranges", async () => {
    for (const range of ["bytes=5-2", "bytes=0-1,4-5", "lines=1-2"]) {
      const r = await mockGET(req(await link("v/clip.mp4"), { range }));
      expect(r.status, range).toBe(200);
      expect(await r.text()).toBe(BODY);
    }
  });

  it("answers any range on an empty file with 416, like S3", async () => {
    const r = await mockGET(req(await link("v/zero.mp4"), { range: "bytes=0-" }));
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe("bytes */0");
    const whole = await mockGET(req(await link("v/zero.mp4")));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-length")).toBe("0");
    expect(await whole.text()).toBe("");
  });

  it("honors If-Range and If-None-Match", async () => {
    const first = await mockGET(req(await link("v/clip.mp4")));
    const etag = first.headers.get("etag")!;
    expect((await mockGET(req(await link("v/clip.mp4"), { range: "bytes=0-1", "if-range": etag }))).status).toBe(206);
    expect((await mockGET(req(await link("v/clip.mp4"), { range: "bytes=0-1", "if-range": '"stale"' }))).status).toBe(200);
    expect((await mockGET(req(await link("v/clip.mp4"), { "if-none-match": etag }))).status).toBe(304);
  });

  it("supports HEAD without a body", async () => {
    const r = await mockHEAD(req(await link("v/clip.mp4"), { range: "bytes=0-9" }));
    expect(r.status).toBe(206);
    expect(r.headers.get("content-length")).toBe("10");
    expect(r.body).toBeNull();
  });

  it("sets attachment and unicode names for downloads", async () => {
    const r = await mockGET(req(await link("v/файл 1+1#.txt", { download: true })));
    expect(r.status).toBe(200);
    const cd = r.headers.get("content-disposition")!;
    expect(cd.startsWith("attachment;")).toBe(true);
    expect(decodeURIComponent(cd.split("''")[1])).toBe("файл 1+1#.txt");
  });

  it("sandboxes HTML and SVG so they can't script this origin", async () => {
    for (const key of ["v/page.html", "v/image.svg"]) {
      const r = await mockGET(req(await link(key)));
      expect(r.headers.get("content-security-policy"), key).toMatch(/^sandbox/);
    }
    const forcedHtml = await mockGET(req(await link("v/clip.mp4", { contentType: "text/html" })));
    expect(forcedHtml.headers.get("content-type")).toBe("text/html");
    expect(forcedHtml.headers.get("content-security-policy")).toMatch(/^sandbox/);
  });

  it("uses octet-stream for unknown types and ignores unsafe type overrides", async () => {
    expect((await mockGET(req(await link("v/noext")))).headers.get("content-type")).toBe("application/octet-stream");
    const r = await mockGET(req(await link("v/clip.mp4", { contentType: "bad type\r\nx" })));
    expect(r.headers.get("content-type")).toBe("video/mp4");
  });

  it("rejects unsigned, forged and expired links", async () => {
    expect((await mockGET(req("/api/mock?key=v/clip.mp4"))).status).toBe(403);
    const good = new URL(await link("v/clip.mp4"), ORIGIN);
    good.searchParams.set("key", "v/zero.mp4");
    expect((await mockGET(req(good.pathname + good.search))).status).toBe(403);
    const expired = await link("v/clip.mp4", { expiresIn: 1 });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 5000);
      expect((await mockGET(req(expired))).status).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });

  it("404s for missing files and folders, 403s outside the root", async () => {
    expect((await mockGET(req(await link("v/missing.mp4")))).status).toBe(404);
    expect((await mockGET(req(await link("v")))).status).toBe(404);
    expect((await mockGET(req(await link("../outside/secret.txt")))).status).toBe(403);
    expect((await mockGET(req(await link("link.txt")))).status).toBe(403);
  });

  it("is off without LENS_MOCK_DIR", async () => {
    const url = await link("v/clip.mp4");
    delete process.env.LENS_MOCK_DIR;
    try {
      expect((await mockGET(req(url))).status).toBe(404);
    } finally {
      process.env.LENS_MOCK_DIR = bucket.root;
    }
  });
});

describe("GET /api/files/open and /download", () => {
  const location = (r: Response) => new URL(r.headers.get("location")!, ORIGIN);

  it("redirects to a short-lived inline link", async () => {
    const r = await openGET(req(`/api/files/open?key=${encodeURIComponent("v/clip.mp4")}`));
    expect(r.status).toBe(302);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const loc = location(r);
    expect(loc.pathname).toBe("/api/mock");
    expect(loc.searchParams.get("key")).toBe("v/clip.mp4");
    expect(loc.searchParams.get("type")).toBe("video/mp4");
    expect(loc.searchParams.get("download")).toBeNull();
    const ttl = Number(loc.searchParams.get("exp")) - Date.now() / 1000;
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);

    const served = await mockGET(req(loc.pathname + loc.search));
    expect(await served.text()).toBe(BODY);
  });

  it("redirects downloads to an attachment link", async () => {
    const key = "v/файл 1+1#.txt";
    const r = await downloadGET(req(`/api/files/download?key=${encodeURIComponent(key)}`));
    expect(r.status).toBe(302);
    const loc = location(r);
    expect(loc.searchParams.get("key")).toBe(key);
    expect(loc.searchParams.get("download")).toBe("1");
    expect(Number(loc.searchParams.get("exp")) - Date.now() / 1000).toBeLessThanOrEqual(900);
    const served = await mockGET(req(loc.pathname + loc.search));
    expect(served.headers.get("content-disposition")).toMatch(/^attachment;.*filename\*=UTF-8''/);
  });

  it("opens inline with an hour-long link, whatever an old cookie's link expiry says", async () => {
    session.connection = { ...CONNECTION, linkExpiry: 600 } as Connection;
    const loc = location(await openGET(req("/api/files/open?key=v/clip.mp4")));
    const left = Number(loc.searchParams.get("exp")) - Date.now() / 1000;
    expect(left).toBeGreaterThan(3590);
    expect(left).toBeLessThanOrEqual(3600);
  });

  it("shows page-like files as text when opened inline", async () => {
    const loc = location(await openGET(req("/api/files/open?key=v/page.html")));
    expect(loc.searchParams.get("type")).toBe("text/html");
    // LocalStorage reports the real type; generic S3 types are covered in the S3 tests.
  });

  it("sends people without a session to setup", async () => {
    session.connection = null;
    for (const get of [openGET, downloadGET]) {
      const r = await get(req("/api/files/open?key=v/clip.mp4"));
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("/setup");
    }
  });

  it("400s for a missing, empty or folder key", async () => {
    for (const q of ["", "?key=", "?key=v/", `?key=${"x".repeat(1100)}`]) {
      const r = await openGET(req(`/api/files/open${q}`));
      expect(r.status, q).toBe(400);
      expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    }
  });

  it("404s with plain text for unknown keys instead of redirecting", async () => {
    const r = await downloadGET(req("/api/files/download?key=v/nope.mp4"));
    expect(r.status).toBe(404);
    expect(r.headers.get("location")).toBeNull();
    expect(await r.text()).toMatch(/not found/i);
  });

  it("maps other storage errors to plain text", async () => {
    const r = await openGET(req(`/api/files/open?key=${encodeURIComponent("../outside/secret.txt")}`));
    expect(r.status).toBe(403);
    expect(await r.text()).toMatch(/^Access denied\./);
  });
});

describe("GET /api/list", () => {
  it("returns a Listing for a normalized prefix", async () => {
    const r = await listGET(req("/api/list?prefix=%2Fv"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const body = await r.json();
    expect(body.prefix).toBe("v/");
    expect(body.truncated).toBe(false);
    expect(body.files.map((f: { name: string }) => f.name)).toContain("clip.mp4");
  });

  it("lists the root by default and applies the limit", async () => {
    const all = await (await listGET(req("/api/list"))).json();
    expect(all.prefix).toBe("");
    const two = await (await listGET(req("/api/list?limit=2"))).json();
    expect(two.folders.length + two.files.length).toBe(2);
    expect(two.truncated).toBe(true);
  });

  it("400s for a bad limit or prefix", async () => {
    for (const q of ["limit=0", "limit=5001", "limit=abc", "limit=2.5", `prefix=${"x".repeat(1100)}`, "prefix=%00"]) {
      const r = await listGET(req(`/api/list?${q}`));
      expect(r.status, q).toBe(400);
      expect((await r.json()).error).toMatchObject({ status: 400 });
    }
  });

  it("401s with a JSON AppError without a session", async () => {
    session.connection = null;
    const r = await listGET(req("/api/list"));
    expect(r.status).toBe(401);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    expect((await r.json()).error).toMatchObject({ title: "Not connected", status: 401 });
  });

  it("maps storage errors", async () => {
    const r = await listGET(req("/api/list?prefix=linkdir/"));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatchObject({ title: "Access denied" });
  });
});
