import { rmSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { configureLog, type Level } from "@/lib/server/log";
import type { BucketHealth, Connection, FileEntry } from "@/lib/types";

// Set before health.ts is imported: it reads the reports folder once.
const fake = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "lens-health-log-"));
  process.env.LENS_HEALTH_DIR = dir;
  return { dir, files: [] as unknown[] };
});

const PRESIGNED_BIT = "X-Amz-Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7";
// Every MP4's signed URL fails, so its check throws.
vi.mock("@/lib/server/storage", () => ({
  storageFor: () => ({
    list: async () => ({ prefix: "", folders: [], files: fake.files, truncated: false, nextCursor: null }),
    signedUrl: async () => {
      throw new Error(`signing failed for https://example.com/take.mp4?${PRESIGNED_BIT}`);
    },
  }),
}));

import { bucketHealth } from "@/lib/server/health";

const CONN: Connection = { accessKeyId: "AKIAHEALTHLOGKEY0001", secretAccessKey: "health-secret", bucket: "deccan-physical-ai-corpus", region: "ap-south-1" };
const ORIGIN = "http://127.0.0.1:3000";
const file = (key: string, size: number, kind: FileEntry["kind"], ext: string) => ({ key, name: key, size, kind, ext }) as unknown as FileEntry;

let lines: { text: string; level: Level }[] = [];
const json = () => lines.map((l) => JSON.parse(l.text) as Record<string, unknown>);

afterAll(() => {
  delete process.env.LENS_HEALTH_DIR;
  rmSync(fake.dir, { recursive: true, force: true });
});
afterEach(() => configureLog({}));

async function finished(): Promise<BucketHealth> {
  let h = await bucketHealth(CONN, { start: true, origin: ORIGIN });
  for (let i = 0; i < 200 && h.status === "running"; i++) {
    await new Promise((r) => setTimeout(r, 10));
    h = await bucketHealth(CONN, { origin: ORIGIN });
  }
  return h;
}

describe("bucket health logging", () => {
  it("logs the scan's start and end, and warns when a file's check throws", async () => {
    lines = [];
    configureLog({ level: "debug", format: "json", sink: (text, level) => lines.push({ text, level }) });
    fake.files = [file("notes.txt", 10, "text", "txt"), file("clips/take.mp4", 4096, "video", "mp4")];
    expect((await finished()).status).toBe("done");

    const out = json();
    expect(out.find((l) => l.msg === "scan started")).toMatchObject({ level: "info", scope: "health", bucket: CONN.bucket });
    expect(out.find((l) => l.msg === "listing done")).toMatchObject({ level: "info", videos: 1, ms: expect.any(Number) });
    expect(out.find((l) => l.msg === "check threw")).toMatchObject({
      level: "warn",
      key: "clips/take.mp4",
      err: { message: expect.stringContaining("signing failed") },
    });
    expect(out.find((l) => l.msg === "scan finished")).toMatchObject({
      level: "info",
      videos: 1,
      checkFailed: 1,
      listMs: expect.any(Number),
      checkMs: expect.any(Number),
    });
    const all = lines.map((l) => l.text).join("\n");
    expect(all).not.toContain("5d672d79c15b");
    expect(all).not.toContain(CONN.accessKeyId);
    expect(all).not.toContain(CONN.secretAccessKey);
  });
});
