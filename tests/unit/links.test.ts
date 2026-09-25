import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { Connection, SignedLinks } from "@/lib/types";

const session = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock("@/lib/server/session", () => ({ getConnection: async () => session.connection }));

import { POST } from "@/app/api/links/route";
import { GET as mockGET } from "@/app/api/mock/route";
import { EXPIRY_OPTIONS } from "@/lib/format";
import { LocalStorage } from "@/lib/server/storage/local";
import { makeBucket, type TempBucket } from "./helpers/bucket";

const CONNECTION: Connection = {
  accessKeyId: "AKIAFAKEFAKEFAKE12",
  secretAccessKey: "secret",
  bucket: "deccan-physical-ai-corpus",
  region: "ap-south-1",
};
const ORIGIN = "http://127.0.0.1:3100";

let bucket: TempBucket;
let prevMockDir: string | undefined;

beforeAll(() => {
  bucket = makeBucket({ "v/clip.mp4": "0123456789", "v/notes.txt": "hello" });
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

const post = (body: unknown) =>
  POST(
    new Request(`${ORIGIN}/api/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }) as NextRequest,
  );

const secondsLeft = (url: string) => Number(new URL(url, ORIGIN).searchParams.get("exp")) - Date.now() / 1000;

describe("POST /api/links", () => {
  it.each(EXPIRY_OPTIONS.map((o) => [o.label, o.seconds] as const))("signs links that work for %s", async (_label, seconds) => {
    const before = Date.now();
    const r = await post({ keys: ["v/clip.mp4", "v/notes.txt"], expiresIn: seconds });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = (await r.json()) as SignedLinks;
    expect(body.links.map((l) => l.key)).toEqual(["v/clip.mp4", "v/notes.txt"]);
    for (const l of body.links) {
      expect(secondsLeft(l.url)).toBeGreaterThan(seconds - 5);
      expect(secondsLeft(l.url)).toBeLessThanOrEqual(seconds);
    }
    const expiresAt = Date.parse(body.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + seconds * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + seconds * 1000);
  });

  it("signs for an hour when no lifetime is given", async () => {
    const body = (await (await post({ keys: ["v/clip.mp4"] })).json()) as SignedLinks;
    expect(secondsLeft(body.links[0].url)).toBeGreaterThan(3595);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(3600_000);
  });

  it("returns links that serve the file", async () => {
    const body = (await (await post({ keys: ["v/notes.txt"], expiresIn: 86400 })).json()) as SignedLinks;
    const served = await mockGET(new Request(new URL(body.links[0].url, ORIGIN)));
    expect(served.status).toBe(200);
    expect(await served.text()).toBe("hello");
  });

  it.each([0, 60, 3599, 7200, 604801, -3600, 3600.5, "3600", null, true, [3600]])("rejects expiresIn %j with 400", async (expiresIn) => {
    const r = await post({ keys: ["v/clip.mp4"], expiresIn });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Links can work for 1 hour, 6 hours, 24 hours or 7 days.");
  });

  it("still validates keys", async () => {
    expect((await post({ keys: [], expiresIn: 3600 })).status).toBe(400);
    expect((await post({ keys: ["v/"], expiresIn: 3600 })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
  });

  it("asks to reconnect without a session", async () => {
    session.connection = null;
    expect((await post({ keys: ["v/clip.mp4"], expiresIn: 3600 })).status).toBe(401);
  });

  it("describes a signing failure without leaking the key", async () => {
    vi.spyOn(LocalStorage.prototype, "signedUrl").mockRejectedValue(
      Object.assign(new Error("denied for AKIAIOSFODNN7EXAMPLE"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }),
    );
    const r = await post({ keys: ["v/clip.mp4"] });
    expect(r.status).toBe(403);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = (await r.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/can’t read this bucket/);
    expect(JSON.stringify(body)).not.toContain("AKIA");
  });

  it("signs a key listed twice once", async () => {
    const body = (await (await post({ keys: ["v/clip.mp4", "v/clip.mp4"] })).json()) as SignedLinks;
    expect(body.links.map((l) => l.key)).toEqual(["v/clip.mp4"]);
  });
});
