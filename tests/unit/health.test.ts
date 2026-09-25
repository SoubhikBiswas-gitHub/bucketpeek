import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BucketHealth, Connection } from "@/lib/types";
import { makeBucket, type TempBucket } from "./helpers/bucket";

const session = vi.hoisted(() => ({ connection: null as Connection | null }));
vi.mock("@/lib/server/session", () => ({ getConnection: async () => session.connection }));

type Route = typeof import("@/app/api/health/route");

const FULL: Connection = {
  accessKeyId: "AKIAFULLACCESSKEY001",
  secretAccessKey: "full-secret",
  bucket: "deccan-physical-ai-corpus",
  region: "ap-south-1",
};
const RESTRICTED: Connection = { ...FULL, accessKeyId: "AKIARESTRICTEDKEY001", secretAccessKey: "restricted-secret" };
const ORIGIN = "http://127.0.0.1:3000";

let bucket: TempBucket;
let dir: string;
let route: Route;

beforeAll(async () => {
  bucket = makeBucket({ "clips/a.txt": "a" });
  dir = mkdtempSync(path.join(os.tmpdir(), "lens-health-"));
  vi.stubEnv("LENS_MOCK_DIR", bucket.root);
  vi.stubEnv("LENS_HEALTH_DIR", path.join(dir, "reports"));
  route = await import("@/app/api/health/route");
});
afterAll(() => {
  vi.unstubAllEnvs();
  bucket.cleanup();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  session.connection = FULL;
});

const reports = () => readdirSync(path.join(dir, "reports")).filter((n) => n.endsWith(".json"));
const get = async () => (await (await route.GET(new NextRequest(`${ORIGIN}/api/health`))).json()) as BucketHealth;
const post = async (query = "") =>
  (await (await route.POST(new NextRequest(`${ORIGIN}/api/health${query}`, { method: "POST" }))).json()) as BucketHealth;

async function finished(): Promise<BucketHealth> {
  for (let i = 0; i < 200; i++) {
    const h = await get();
    if (h.status !== "running") return h;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("the check didn't finish");
}

describe("/api/health", () => {
  it("GET only reads: with no report it says so and starts nothing", async () => {
    expect(await get()).toEqual({ status: "none" });
    await new Promise((r) => setTimeout(r, 50));
    expect(await get()).toEqual({ status: "none" });
  });

  it("POST starts the first check; later POSTs without rescan return the saved report", async () => {
    expect((await post()).status).toBe("running");
    const done = await finished();
    expect(done.status).toBe("done");
    expect(reports()).toHaveLength(1);
    const again = await post();
    expect(again).toEqual(done);
    expect((await post("?rescan=1")).status).toBe("running");
    expect((await finished()).status).toBe("done");
  });

  it("keeps a separate report per access key, so a restricted key can't replace the shared one", async () => {
    const full = await finished();
    expect(full.status).toBe("done");
    session.connection = RESTRICTED;
    expect(await get()).toEqual({ status: "none" });
    await post("?rescan=1");
    expect((await finished()).status).toBe("done");
    expect(reports()).toHaveLength(2);
    session.connection = FULL;
    expect(await get()).toEqual(full);
  });

  it("starts one check when several first requests arrive at once", async () => {
    session.connection = { ...FULL, accessKeyId: "AKIARACETESTKEY00001" };
    const before = reports().length;
    const first = await Promise.all([post(), post(), post(), post()]);
    expect(first.map((h) => h.status)).toEqual(["running", "running", "running", "running"]);
    expect((await finished()).status).toBe("done");
    expect(reports()).toHaveLength(before + 1);
  });

  it("stores reports readable only by this user", () => {
    expect(statSync(path.join(dir, "reports")).mode & 0o777).toBe(0o700);
    for (const name of reports()) expect(statSync(path.join(dir, "reports", name)).mode & 0o777).toBe(0o600);
  });
});
