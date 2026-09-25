import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clean, configureLog, currentLevel, log, withLogContext, type Level } from "@/lib/server/log";

let lines: { text: string; level: Level }[];
const capture = (level: Parameters<typeof configureLog>[0]["level"], format: "json" | "pretty" = "json") =>
  configureLog({ level, format, sink: (text, at) => lines.push({ text, level: at }) });
const json = () => lines.map((l) => JSON.parse(l.text) as Record<string, unknown>);

beforeEach(() => {
  lines = [];
});
afterEach(() => {
  configureLog({});
  vi.unstubAllEnvs();
});

const PRESIGNED =
  "https://deccan-physical-ai-corpus.s3.ap-south-1.amazonaws.com/site-a/take.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
  "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260925%2Fap-south-1%2Fs3%2Faws4_request&X-Amz-Date=20260925T000000Z" +
  "&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7";
const KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

describe("levels", () => {
  it("drops lines below the level", () => {
    capture("warn");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(json().map((l) => l.level)).toEqual(["warn", "error"]);
    expect(lines.map((l) => l.level)).toEqual(["warn", "error"]);
  });

  it("logs nothing when silent", () => {
    capture("silent");
    log.error("e");
    expect(lines).toEqual([]);
  });

  it("reads LOG_LEVEL, defaulting to info in production and debug elsewhere", () => {
    vi.stubEnv("LOG_LEVEL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(currentLevel()).toBe("info");
    vi.stubEnv("NODE_ENV", "development");
    expect(currentLevel()).toBe("debug");
    vi.stubEnv("LOG_LEVEL", " WARN ");
    expect(currentLevel()).toBe("warn");
    vi.stubEnv("LOG_LEVEL", "loud");
    expect(currentLevel()).toBe("debug");
  });

  it("reports whether a level is on", () => {
    capture("info");
    expect(log.enabled("debug")).toBe(false);
    expect(log.enabled("error")).toBe(true);
  });
});

describe("output", () => {
  it("writes one JSON object per line with time, level, msg, scope and fields", () => {
    capture("debug");
    log.child({ scope: "hls" }).info("segment served", { key: "site-a/take.mp4", n: 3, ok: true });
    expect(lines).toHaveLength(1);
    expect(lines[0].text).not.toContain("\n");
    const [line] = json();
    expect(line).toEqual({ time: expect.any(String), level: "info", msg: "segment served", scope: "hls", key: "site-a/take.mp4", n: 3, ok: true });
    expect(Number.isNaN(Date.parse(line.time as string))).toBe(false);
  });

  it("writes a readable single line in pretty mode", () => {
    capture("debug", "pretty");
    log.child({ scope: "s3" }).warn("HeadObject failed", { key: "a b.mp4", status: 403 });
    expect(lines[0].text).toMatch(/^\d\d:\d\d:\d\d\.\d{3} WARN  \[s3\] HeadObject failed {2}key="a b\.mp4" status=403$/);
  });

  it("merges child fields, call fields and the async context", async () => {
    capture("debug");
    const child = log.child({ scope: "convert", bucket: "b" }).child({ key: "k" });
    await withLogContext({ req: "abc123" }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      child.info("opened", { key: "k2" });
    });
    child.info("outside");
    expect(json()).toMatchObject([
      { scope: "convert", bucket: "b", key: "k2", req: "abc123", msg: "opened" },
      { scope: "convert", key: "k", msg: "outside" },
    ]);
    expect(json()[1]).not.toHaveProperty("req");
  });

  it("describes errors by name, AWS code, status and request id", () => {
    capture("debug");
    const e = Object.assign(new Error("Access Denied"), {
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403, requestId: "REQ123", extendedRequestId: "id2", attempts: 2 },
    });
    log.error("failed", { err: e });
    expect(json()[0].err).toEqual({ name: "AccessDenied", message: "Access Denied", status: 403, awsRequestId: "REQ123", awsId2: "id2", attempts: 2 });
  });

  it("keeps a short stack for plain errors", () => {
    capture("debug");
    log.error("boom", { err: new TypeError("x is undefined") });
    const err = json()[0].err as Record<string, string>;
    expect(err.name).toBe("TypeError");
    expect(err.stack).toContain("log.test.ts");
  });

  it("never throws, whatever it is given", () => {
    capture("debug");
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => log.info("odd", { loop, big: BigInt(10), fn: () => 1, when: new Date(0), bytes: new Uint8Array(4) })).not.toThrow();
    expect(json()[0]).toMatchObject({ big: "10", when: "1970-01-01T00:00:00.000Z", bytes: "[4 bytes]" });
  });
});

describe("timing", () => {
  it("logs the elapsed milliseconds with the fields", async () => {
    capture("debug");
    const done = log.child({ scope: "health" }).time("scan", { bucket: "b" });
    await new Promise((r) => setTimeout(r, 20));
    expect(done.elapsed()).toBeGreaterThanOrEqual(15);
    const ms = done({ videos: 4 });
    const [line] = json();
    expect(line).toMatchObject({ msg: "scan", scope: "health", bucket: "b", videos: 4, level: "info" });
    expect(line.ms).toBe(ms);
    expect(ms).toBeGreaterThanOrEqual(15);
  });

  it("takes the level at the end, for failures", () => {
    capture("debug");
    log.time("scan", {}, "debug")({ err: new Error("x") }, "error");
    expect(json()[0].level).toBe("error");
  });
});

describe("redaction", () => {
  const leaks = (text: string) => {
    expect(text).not.toContain("X-Amz-Signature=5d67");
    expect(text).not.toContain("5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
    expect(text).not.toContain(KEY_ID);
    expect(text).not.toContain("AKIA");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("hunter2-session-cookie");
  };

  it("never prints a presigned signature, an access key id or a secret, in either format", () => {
    for (const format of ["json", "pretty"] as const) {
      lines = [];
      capture("debug", format);
      log.info(`redirecting to ${PRESIGNED}`, {
        url: PRESIGNED,
        link: new URL(PRESIGNED),
        note: `keys ${KEY_ID} / ${SECRET}`,
        secretAccessKey: SECRET,
        accessKeyId: KEY_ID,
        connection: { accessKeyId: KEY_ID, secretAccessKey: SECRET, bucket: "deccan-physical-ai-corpus" },
        list: [PRESIGNED, { SECRET_KEY: "x".repeat(40) }],
        cookie: "lens=hunter2-session-cookie",
        headers: { cookie: "lens=hunter2-session-cookie", authorization: `AWS4-HMAC-SHA256 Credential=${KEY_ID}` },
        request: new Request("http://localhost/x", { headers: { cookie: "lens=hunter2-session-cookie" } }),
        err: Object.assign(new Error(`GET ${PRESIGNED} failed for ${KEY_ID}`), { cause: new Error(SECRET) }),
      });
      expect(lines).toHaveLength(1);
      leaks(lines[0].text);
    }
    const [line] = lines.map((l) => l.text);
    // The useful parts stay: where the URL points, and the bucket.
    expect(line).toContain("deccan-physical-ai-corpus.s3.ap-south-1.amazonaws.com/site-a/take.mp4?…");
    expect(line).toContain("deccan-physical-ai-corpus");
  });

  it("drops secret-named fields whatever they hold", () => {
    const out = clean({
      secretAccessKey: "short",
      sessionToken: "t",
      password: "p",
      cookie: "c",
      Authorization: "a",
      sig: "s",
      key: "site-a/take.mp4",
      bucket: "b",
    });
    expect(out).toEqual({
      secretAccessKey: "[redacted]",
      sessionToken: "[redacted]",
      password: "[redacted]",
      cookie: "[redacted]",
      Authorization: "[redacted]",
      sig: "[redacted]",
      key: "site-a/take.mp4",
      bucket: "b",
    });
  });

  it("never logs headers wholesale", () => {
    expect(clean({ h: new Headers({ cookie: "c" }), headers: { cookie: "c" } })).toEqual({ h: "[headers]", headers: "[headers]" });
  });
});
