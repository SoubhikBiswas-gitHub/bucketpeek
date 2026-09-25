import { chmodSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeError, isNotFound } from "@/lib/server/errors";
import { LocalStorage, mockRoot, resolveMockPath, safeMockPath, verifyMockLink } from "@/lib/server/storage/local";
import { FIXTURES, makeBucket, type TempBucket } from "./helpers/bucket";

let bucket: TempBucket;
let storage: LocalStorage;

beforeAll(() => {
  bucket = makeBucket();
  storage = new LocalStorage(bucket.root);
});
afterAll(() => bucket.cleanup());

describe("LocalStorage.list", () => {
  it("lists one level in S3 byte order, folders and files apart, skipping dotfiles and symlinks", async () => {
    const l = await storage.list("", 100);
    expect(l.prefix).toBe("");
    expect(l.truncated).toBe(false);
    expect(l.folders).toEqual([
      { name: "a-b", prefix: "a-b/" },
      { name: "empty_dir", prefix: "empty_dir/" },
      { name: "sub", prefix: "sub/" },
    ]);
    expect(l.files.map((f) => f.key)).toEqual(["B.txt", "a.txt", "empty.txt", "space name.txt", "ünï.txt"]);
    expect(l.files.find((f) => f.key === "a.txt")).toMatchObject({ name: "a.txt", ext: "txt", kind: "text", type: "TXT", size: 5 });
    expect(l.files[0].modified).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("lists nested prefixes with full keys", async () => {
    const l = await storage.list("sub/", 100);
    expect(l.folders).toEqual([{ name: "deeper", prefix: "sub/deeper/" }]);
    expect(l.files.map((f) => f.key)).toEqual(["sub/inner.json"]);
    expect((await storage.list("sub/deeper/", 100)).files[0]).toMatchObject({ key: "sub/deeper/x.csv", kind: "table" });
  });

  it("treats a partial prefix like S3 does", async () => {
    const l = await storage.list("a", 100);
    expect(l.folders.map((f) => f.prefix)).toEqual(["a-b/"]);
    expect(l.files.map((f) => f.key)).toEqual(["a.txt"]);
    expect((await storage.list("sub/in", 100)).files.map((f) => f.key)).toEqual(["sub/inner.json"]);
  });

  it("caps folders + files together and reports truncation only when more exist", async () => {
    const three = await storage.list("", 3);
    expect(three.folders.length + three.files.length).toBe(3);
    expect(three.truncated).toBe(true);
    // In byte order the first three are B.txt, a-b/, a.txt.
    expect(three.files.map((f) => f.key)).toEqual(["B.txt", "a.txt"]);
    expect(three.folders.map((f) => f.name)).toEqual(["a-b"]);

    const exact = await storage.list("", 8);
    expect(exact.folders.length + exact.files.length).toBe(8);
    expect(exact.truncated).toBe(false);
    expect((await storage.list("", 7)).truncated).toBe(true);
  });

  it("returns an empty listing for missing folders, files and empty folders", async () => {
    for (const p of ["nope/", "a.txt/", "empty_dir/"]) {
      expect(await storage.list(p, 10)).toEqual({ prefix: p, folders: [], files: [], truncated: false, nextCursor: null });
    }
  });

  it("refuses to list outside the root", async () => {
    await expect(storage.list("../", 10)).rejects.toMatchObject({ name: "AccessDenied" });
    await expect(storage.list("linkdir/", 10)).rejects.toMatchObject({ name: "AccessDenied" });
  });
});

describe("LocalStorage.head", () => {
  it("describes a file with a content type", async () => {
    const f = await storage.head("sub/inner.json");
    expect(f).toMatchObject({ key: "sub/inner.json", name: "inner.json", kind: "json", size: 7, contentType: "application/json" });
    expect((await storage.head("ünï.txt")).name).toBe("ünï.txt");
    expect((await storage.head("space name.txt")).size).toBe(6);
  });

  it("throws NotFound for missing files and folders", async () => {
    for (const key of ["missing.txt", "sub", "sub/", "", "a.txt/child"]) {
      const e = await storage.head(key).catch((err: unknown) => err);
      expect(isNotFound(e), key).toBe(true);
      expect(describeError(e).status).toBe(404);
    }
  });

  it("rejects traversal, absolute paths, NUL bytes and symlinks out of the root", async () => {
    for (const key of ["../outside/secret.txt", "sub/../../outside/secret.txt", "/etc/passwd", "a\u0000b", "link.txt", "linkdir/secret.txt"]) {
      await expect(storage.head(key), key).rejects.toMatchObject({ name: "AccessDenied" });
    }
  });
});

describe("LocalStorage.readStart", () => {
  it("reads the whole small file", async () => {
    expect(await storage.readStart("a.txt", 1024)).toEqual({ text: "lower", truncated: false });
    expect(await storage.readStart("empty.txt", 1024)).toEqual({ text: "", truncated: false });
  });

  it("truncates at the byte limit without splitting characters", async () => {
    expect(await storage.readStart("a.txt", 3)).toEqual({ text: "low", truncated: true });
    // "ünï.txt" holds "unicode"; test a multibyte body via a dedicated bucket.
    const b = makeBucket({ "multi.txt": "aé€🤖" });
    try {
      const s = new LocalStorage(b.root);
      expect(await s.readStart("multi.txt", 2)).toEqual({ text: "a", truncated: true });
      expect(await s.readStart("multi.txt", 3)).toEqual({ text: "aé", truncated: true });
      expect(await s.readStart("multi.txt", 6)).toEqual({ text: "aé€", truncated: true });
    } finally {
      b.cleanup();
    }
  });

  it("refuses symlinks and missing files", async () => {
    await expect(storage.readStart("link.txt", 10)).rejects.toMatchObject({ name: "AccessDenied" });
    await expect(storage.readStart("missing.txt", 10)).rejects.toMatchObject({ name: "NotFound" });
    await expect(storage.readStart("sub", 10)).rejects.toMatchObject({ name: "NotFound" });
  });
});

describe("LocalStorage.signedUrl", () => {
  const params = (url: string) => new URL(url, "http://lens.local").searchParams;

  it("signs links that verify, for an hour by default", async () => {
    const url = await storage.signedUrl("sub/inner.json");
    expect(url.startsWith("/api/mock?")).toBe(true);
    const p = params(url);
    expect(verifyMockLink(p)).toEqual({ key: "sub/inner.json", download: false, type: "" });
    const exp = Number(p.get("exp"));
    expect(exp - Date.now() / 1000).toBeGreaterThan(3590);
    expect(exp - Date.now() / 1000).toBeLessThanOrEqual(3600);
    expect(verifyMockLink(p, (exp + 1) * 1000)).toBeNull();
  });

  it("covers download and type in the signature", async () => {
    const dl = params(await storage.signedUrl("a.txt", { download: true, expiresIn: 60 }));
    expect(verifyMockLink(dl)).toEqual({ key: "a.txt", download: true, type: "" });
    const typed = params(await storage.signedUrl("a.txt", { contentType: "text/plain" }));
    expect(verifyMockLink(typed)?.type).toBe("text/plain");

    for (const [name, value] of [["key", "b.txt"], ["type", "text/html"], ["download", "1"], ["exp", "9999999999"], ["sig", "x"]]) {
      const forged = new URLSearchParams(typed);
      forged.set(name, value);
      expect(verifyMockLink(forged), name).toBeNull();
    }
    expect(verifyMockLink(new URLSearchParams("key=a.txt"))).toBeNull();
  });

  it("round-trips awkward keys", async () => {
    for (const key of ["a b/c#d?.txt", "ünï/файл+1%.json"]) {
      expect(verifyMockLink(params(await storage.signedUrl(key)))?.key).toBe(key);
    }
  });
});

describe("mock path helpers", () => {
  it("resolves inside the root only", () => {
    expect(resolveMockPath(bucket.root, "a.txt")).toBe(`${bucket.root}/a.txt`);
    expect(resolveMockPath(bucket.root, "")).toBe(bucket.root);
    expect(() => resolveMockPath(bucket.root, "../x")).toThrow(/escapes/);
    expect(() => resolveMockPath(bucket.root, "/etc/passwd")).toThrow(/escapes/);
    expect(() => resolveMockPath(`${bucket.root}`, "../bucket-evil/x")).toThrow(/escapes/);
  });

  it("follows symlinks only within the root", async () => {
    await expect(safeMockPath(bucket.root, "a.txt")).resolves.toMatch(/a\.txt$/);
    await expect(safeMockPath(bucket.root, "link.txt")).rejects.toMatchObject({ name: "AccessDenied" });
    await expect(safeMockPath(bucket.root, "nope")).rejects.toMatchObject({ name: "NotFound" });
  });

  it("treats a symlink loop as missing", async () => {
    const own = makeBucket();
    try {
      symlinkSync(path.join(own.root, "loop-b"), path.join(own.root, "loop-a"));
      symlinkSync(path.join(own.root, "loop-a"), path.join(own.root, "loop-b"));
      await expect(safeMockPath(own.root, "loop-a")).rejects.toMatchObject({ name: "NotFound" });
    } finally {
      own.cleanup();
    }
  });

  // Root reads through any permission, so there is no EACCES to see.
  it.skipIf(process.getuid?.() === 0)("passes other file-system errors on instead of calling them missing", async () => {
    const own = makeBucket({ "locked/inner.txt": "x" });
    const locked = path.join(own.root, "locked");
    try {
      chmodSync(locked, 0o000);
      await expect(safeMockPath(own.root, "locked/inner.txt")).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      chmodSync(locked, 0o755);
      own.cleanup();
    }
  });

  it("reads LENS_MOCK_DIR", () => {
    const before = process.env.LENS_MOCK_DIR;
    try {
      delete process.env.LENS_MOCK_DIR;
      expect(mockRoot()).toBeNull();
      process.env.LENS_MOCK_DIR = "./fixtures/bucket";
      expect(mockRoot()).toBe(FIXTURES);
    } finally {
      if (before === undefined) delete process.env.LENS_MOCK_DIR;
      else process.env.LENS_MOCK_DIR = before;
    }
  });
});

describe("the repo fixture bucket", () => {
  const fixtures = new LocalStorage(FIXTURES);

  it("has the dataset folders at the root", async () => {
    const l = await fixtures.list("", 5000);
    expect(l.folders.map((f) => f.name)).toEqual(expect.arrayContaining(["Construction", "Factory"]));
  });

  it("lists Factory with known episode files", async () => {
    const l = await fixtures.list("Factory/", 5000);
    const keys = l.files.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["Factory/README.md", "Factory/episode_0001_pick_and_place.mp4", "Factory/episodes_index.json"]));
    // S3 byte order: upper-case before lower-case.
    expect([...keys].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))).toEqual(keys);
    expect(l.files.find((f) => f.key === "Factory/episode_0001_pick_and_place.mp4")?.kind).toBe("video");
  });

  it("heads and reads fixture files", async () => {
    const readme = await fixtures.head("Factory/README.md");
    expect(readme.contentType).toBe("text/markdown");
    const { text } = await fixtures.readStart("Factory/README.md", 1 << 20);
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("storageFor", () => {
  const conn = {
    accessKeyId: "AKIAFAKEFAKEFAKE12",
    secretAccessKey: "x",
    bucket: "deccan-physical-ai-corpus",
    region: "ap-south-1",
  };

  it("uses the mock folder when LENS_MOCK_DIR is set, S3 otherwise", async () => {
    const { isMockMode, storageFor, verifyConnection } = await import("@/lib/server/storage");
    const { S3Storage } = await import("@/lib/server/storage/s3");
    const before = process.env.LENS_MOCK_DIR;
    try {
      process.env.LENS_MOCK_DIR = bucket.root;
      expect(isMockMode()).toBe(true);
      expect(storageFor(conn)).toBeInstanceOf(LocalStorage);
      expect(await verifyConnection(conn)).toBe("ap-south-1");
      delete process.env.LENS_MOCK_DIR;
      expect(isMockMode()).toBe(false);
      expect(storageFor(conn)).toBeInstanceOf(S3Storage);
    } finally {
      if (before === undefined) delete process.env.LENS_MOCK_DIR;
      else process.env.LENS_MOCK_DIR = before;
    }
  });
});
