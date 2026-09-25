import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Storage } from "@/lib/server/storage";
import type { SignedUrlOptions } from "@/lib/server/storage/types";
import type { Connection, FileMeta } from "@/lib/types";

// Page loaders and the file redirect routes, against an in-memory storage.

const h = vi.hoisted(() => ({
  connection: null as Connection | null,
  storage: null as unknown as Storage,
}));
vi.mock("@/lib/server/session", () => ({ getConnection: async () => h.connection }));
vi.mock("@/lib/server/storage", () => ({ MAX_LIST_ITEMS: 5000, storageFor: () => h.storage }));
vi.mock("@/lib/server/convert", () => ({ ffmpegAvailable: async () => false }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));

import { loadListing, loadView, requireConnection } from "@/lib/server/data";
import { GET as openGET } from "@/app/api/files/open/route";
import { GET as downloadGET } from "@/app/api/files/download/route";

const CONN: Connection = {
  accessKeyId: "AKIAFAKEFAKEFAKE12",
  secretAccessKey: "x",
  bucket: "b",
  region: "ap-south-1",
};

function meta(key: string, contentType: string, size = 3): FileMeta {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : name.toLowerCase();
  return { key, name, ext, kind: "other", type: ext.toUpperCase(), size, modified: null, contentType };
}

const signed: { key: string; o?: SignedUrlOptions }[] = [];
const awsError = (name: string, status: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

function fakeStorage(files: Record<string, FileMeta>, failures: Partial<Record<keyof Storage, unknown>> = {}): Storage {
  const fail = (op: keyof Storage) => {
    if (failures[op]) throw failures[op];
  };
  return {
    list: async (prefix) => {
      fail("list");
      const inFolder = Object.values(files).filter((f) => f.key.startsWith(prefix) && !f.key.slice(prefix.length).includes("/"));
      return { prefix, folders: [], files: inFolder, truncated: false };
    },
    head: async (key) => {
      fail("head");
      if (!files[key]) throw awsError("NotFound", 404);
      return files[key];
    },
    details: async () => {
      throw new Error("not used by loaders");
    },
    readStart: async () => ({ text: "", truncated: false }),
    readBytes: async () => new Uint8Array(),
    signedUrl: async (key, o) => {
      fail("signedUrl");
      signed.push({ key, o });
      return `https://b.s3.ap-south-1.amazonaws.com/${encodeURIComponent(key)}?X-Amz-Signature=sig`;
    },
  };
}

beforeEach(() => {
  h.connection = CONN;
  signed.length = 0;
  h.storage = fakeStorage({
    "d/a.mp4": meta("d/a.mp4", "binary/octet-stream"),
    "d/b.mp4": meta("d/b.mp4", "video/mp4"),
    "d/c.html": meta("d/c.html", "application/octet-stream"),
    "d/d.svg": meta("d/d.svg", ""),
    "d/e.bin": meta("d/e.bin", "binary/octet-stream"),
    "d/f.html": meta("d/f.html", "text/html"),
  });
});

const req = (path: string) => new Request(`http://127.0.0.1:3100${path}`);

describe("file redirects choose the inline type", () => {
  it.each([
    ["d/a.mp4", "video/mp4"],
    ["d/b.mp4", "video/mp4"],
    ["d/c.html", "text/plain; charset=utf-8"],
    ["d/d.svg", "image/svg+xml"],
    ["d/e.bin", "application/octet-stream"],
    ["d/f.html", "text/html"],
  ])("%s → %s", async (key, type) => {
    const r = await openGET(req(`/api/files/open?key=${encodeURIComponent(key)}`));
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toMatch(/^https:\/\/b\.s3\./);
    expect(signed[0].o).toEqual({ contentType: type, expiresIn: 3600 });
  });

  it("downloads without a type override", async () => {
    await downloadGET(req("/api/files/download?key=d/a.mp4"));
    expect(signed[0].o).toEqual({ download: true, expiresIn: 900 });
  });

  it("maps head and signing failures to plain text", async () => {
    h.storage = fakeStorage({ "d/a.mp4": meta("d/a.mp4", "") }, { head: awsError("InvalidAccessKeyId", 403) });
    let r = await openGET(req("/api/files/open?key=d/a.mp4"));
    expect(r.status).toBe(401);
    expect(await r.text()).toMatch(/^Access key not recognized\./);

    h.storage = fakeStorage({ "d/a.mp4": meta("d/a.mp4", "") }, { signedUrl: new Error("boom") });
    r = await openGET(req("/api/files/open?key=d/a.mp4"));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("sig");
  });
});

describe("page loaders", () => {
  it("requireConnection redirects to setup without a session", async () => {
    expect(await requireConnection()).toEqual(CONN);
    h.connection = null;
    await expect(requireConnection()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;/setup" });
  });

  it("loadListing normalizes the prefix and maps errors", async () => {
    const ok = await loadListing(CONN, "/d");
    expect(ok.ok && ok.data.prefix).toBe("d/");
    const bad = await loadListing(CONN, "x".repeat(2000));
    expect(bad).toMatchObject({ ok: false, error: { status: 400 } });
    h.storage = fakeStorage({}, { list: awsError("AccessDenied", 403) });
    expect(await loadListing(CONN, "")).toMatchObject({ ok: false, error: { title: "Access denied", status: 403 } });
  });

  it("loadView returns the file, preview, links and neighbors", async () => {
    const r = await loadView(CONN, "d/b.mp4");
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.file.key).toBe("d/b.mp4");
    expect(r.data.folder).toBe("d/");
    expect(r.data.prev?.key).toBe("d/a.mp4");
    expect(r.data.next?.key).toBe("d/c.html");
    // The preview's links last an hour; a link to share is signed when it's copied.
    expect(Date.parse(r.data.linksExpireAt) - Date.now()).toBeGreaterThan(3590_000);
    expect(Date.parse(r.data.linksExpireAt) - Date.now()).toBeLessThanOrEqual(3600_000);
    expect(r.data).not.toHaveProperty("shareUrl");
  });

  it("loadView explains missing, empty and folder keys", async () => {
    expect(await loadView(CONN, "d/zzz.mp4")).toMatchObject({ ok: false, error: { title: "File not found", status: 404 } });
    expect(await loadView(CONN, "")).toMatchObject({ ok: false, error: { status: 400 } });
    expect(await loadView(CONN, "d/")).toMatchObject({ ok: false, error: { title: "This is a folder", status: 400 } });
    h.storage = fakeStorage({}, { head: awsError("AccessDenied", 403) });
    expect(await loadView(CONN, "d/a.mp4")).toMatchObject({ ok: false, error: { title: "Access denied" } });
  });

  it("loadView still works when the sibling listing fails", async () => {
    h.storage = fakeStorage({ "d/b.mp4": meta("d/b.mp4", "video/mp4") }, { list: awsError("AccessDenied", 403) });
    const r = await loadView(CONN, "d/b.mp4");
    expect(r.ok && r.data.prev).toBeNull();
  });
});
