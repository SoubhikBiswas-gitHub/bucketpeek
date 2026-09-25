import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealData } from "iron-session";
import type { Connection } from "@/lib/types";

// Stands in for Next's cookie store.
const jar = vi.hoisted(() => {
  const values = new Map<string, string>();
  const options = new Map<string, { maxAge?: number; secure?: boolean; httpOnly?: boolean; sameSite?: string }>();
  const requestHeaders = new Headers();
  const store = {
    get: (name: string) => (values.has(name) ? { name, value: values.get(name)! } : undefined),
    set: (...args: unknown[]) => {
      const [name, value, opts] =
        typeof args[0] === "string"
          ? (args as [string, string, { maxAge?: number; secure?: boolean }?])
          : [(args[0] as { name: string }).name, (args[0] as { value: string }).value, args[0] as { maxAge?: number }];
      if (opts) options.set(name, opts);
      if (opts?.maxAge === 0 || value === "") values.delete(name);
      else values.set(name, value);
    },
    delete: (name: string) => values.delete(name),
  };
  return { values, options, requestHeaders, store };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.store, headers: async () => jar.requestHeaders }));

import { clearConnection, getConnection, publicInfo, saveConnection, secureCookie } from "@/lib/server/session";
import { appSecret, devSecretFile, MIN_SECRET_LENGTH, sign, verifySignature } from "@/lib/server/secret";
import { configureLog } from "@/lib/server/log";

const CONN: Connection = {
  accessKeyId: "AKIAFAKEFAKEFAKE12",
  secretAccessKey: "s3cr3t",
  bucket: "deccan-physical-ai-corpus",
  region: "ap-south-1",
};

// Warnings the logger printed, as JSON lines.
const captureWarnings = () => {
  const warnings: Record<string, unknown>[] = [];
  configureLog({ level: "warn", format: "json", sink: (text) => warnings.push(JSON.parse(text) as Record<string, unknown>) });
  return warnings;
};

const resetSecretState = () => {
  delete (globalThis as { __lensSecret?: unknown }).__lensSecret;
};

let secretDir: string;

beforeEach(() => {
  jar.values.clear();
  jar.options.clear();
  jar.requestHeaders.delete("x-forwarded-proto");
  resetSecretState();
  secretDir = mkdtempSync(path.join(os.tmpdir(), "lens-secret-"));
  vi.stubEnv("LENS_SECRET_FILE", path.join(secretDir, "data", "secret"));
});
afterEach(() => {
  configureLog({});
  vi.unstubAllEnvs();
  resetSecretState();
  rmSync(secretDir, { recursive: true, force: true });
});

describe("session", () => {
  it("round-trips a connection through a sealed, httpOnly cookie", async () => {
    expect(await getConnection()).toBeNull();
    await saveConnection(CONN);
    const sealed = jar.values.get("deccan_lens")!;
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain(CONN.secretAccessKey);
    expect(sealed).not.toContain(CONN.accessKeyId);
    expect(await getConnection()).toEqual(CONN);
  });

  it("clears the connection", async () => {
    await saveConnection(CONN);
    await clearConnection();
    expect(await getConnection()).toBeNull();
  });

  it("ignores tampered cookies", async () => {
    await saveConnection(CONN);
    const sealed = jar.values.get("deccan_lens")!;
    jar.values.set("deccan_lens", sealed.slice(0, -4) + "AAAA");
    expect(await getConnection()).toBeNull();
    jar.values.set("deccan_lens", "garbage");
    expect(await getConnection()).toBeNull();
  });

  it("ignores cookies from another secret", async () => {
    const other = await sealData({ connection: CONN }, { password: "x".repeat(40) });
    jar.values.set("deccan_lens", other);
    expect(await getConnection()).toBeNull();
  });

  it("rejects a sealed connection with the wrong shape", async () => {
    const sealed = await sealData({ connection: { ...CONN, region: 42 } }, { password: appSecret() });
    jar.values.set("deccan_lens", sealed);
    expect(await getConnection()).toBeNull();
    await expect(saveConnection({ ...CONN, bucket: "" })).rejects.toThrow();
  });

  it("keeps older cookies that still hold a link expiry, and drops it", async () => {
    const sealed = await sealData({ connection: { ...CONN, linkExpiry: 604800 } }, { password: appSecret() });
    jar.values.set("deccan_lens", sealed);
    expect(await getConnection()).toEqual(CONN);
  });

  it("exposes only public fields", () => {
    expect(publicInfo(CONN)).toEqual({ bucket: CONN.bucket, region: CONN.region });
  });
});

describe("cookie flags", () => {
  const flagsAfterSave = async () => {
    await saveConnection(CONN);
    return jar.options.get("deccan_lens")!;
  };

  it("is Secure in production by default, httpOnly and SameSite=Lax always", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SECRET_KEY", "k".repeat(MIN_SECRET_LENGTH));
    vi.stubEnv("COOKIE_SECURE", "");
    expect(await flagsAfterSave()).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
  });

  it("is not Secure in production only when COOKIE_SECURE=false says so", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SECRET_KEY", "k".repeat(MIN_SECRET_LENGTH));
    vi.stubEnv("COOKIE_SECURE", "false");
    expect(await flagsAfterSave()).toMatchObject({ secure: false });
  });

  it("is Secure on an https request in any mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("COOKIE_SECURE", "");
    expect((await flagsAfterSave()).secure).toBe(false);
    jar.requestHeaders.set("x-forwarded-proto", "https");
    expect((await flagsAfterSave()).secure).toBe(true);
  });

  it.each([
    ["production", undefined, null, true],
    ["production", "false", null, false],
    ["production", "false", "https", true],
    ["production", "true", null, true],
    ["development", undefined, null, false],
    ["development", "true", null, true],
    ["development", undefined, "https, http", true],
    ["development", undefined, "http", false],
  ])("NODE_ENV=%s COOKIE_SECURE=%s proto=%s → Secure %s", (env, setting, proto, secure) => {
    vi.stubEnv("NODE_ENV", env);
    if (setting === undefined) vi.stubEnv("COOKIE_SECURE", "");
    else vi.stubEnv("COOKIE_SECURE", setting);
    expect(secureCookie(proto)).toBe(secure);
  });
});

describe("appSecret", () => {
  it("uses SECRET_KEY when it is long enough", () => {
    vi.stubEnv("SECRET_KEY", "k".repeat(MIN_SECRET_LENGTH));
    expect(appSecret()).toBe("k".repeat(MIN_SECRET_LENGTH));
  });

  it("warns about a short SECRET_KEY without printing it", () => {
    const warnings = captureWarnings();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SECRET_KEY", "tiny-secret-value");
    const s = appSecret();
    expect(s).not.toBe("tiny-secret-value");
    expect(s.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(appSecret()).toBe(s);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: "warn", scope: "secret", msg: expect.stringContaining("shorter than") });
    expect(JSON.stringify(warnings)).not.toContain("tiny-secret-value");
  });

  it("in development, generates a random secret once, saves it privately and reuses it after a restart", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SECRET_KEY", "");
    const file = devSecretFile();
    expect(existsSync(file)).toBe(false);
    const s = appSecret();
    expect(s.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(s).not.toBe("deccan-lens-development-secret-change-me-0001");
    expect(readFileSync(file, "utf8")).toBe(s);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    // A restart reads the same secret back, so sessions survive.
    resetSecretState();
    expect(appSecret()).toBe(s);
    // Another checkout (another file) gets its own.
    resetSecretState();
    vi.stubEnv("LENS_SECRET_FILE", path.join(secretDir, "other", "secret"));
    expect(appSecret()).not.toBe(s);
  });

  it("refuses a saved development secret others can read", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SECRET_KEY", "");
    appSecret();
    resetSecretState();
    writeFileSync(devSecretFile(), "x".repeat(64));
    chmodSync(devSecretFile(), 0o644);
    expect(() => appSecret()).toThrow(/0600/);
  });

  it("uses a random per-process secret in production without SECRET_KEY, and warns once", () => {
    const warnings = captureWarnings();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SECRET_KEY", "");
    const a = appSecret();
    expect(a).not.toBe(appSecretIn("development"));
    expect(a.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(appSecret()).toBe(a);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: "warn", scope: "secret", msg: expect.stringContaining("SECRET_KEY is not set") });
    expect(JSON.stringify(warnings)).not.toContain(a);
  });

  it("signs and verifies per purpose", () => {
    const sig = sign("p", "data");
    expect(verifySignature("p", "data", sig)).toBe(true);
    expect(verifySignature("q", "data", sig)).toBe(false);
    expect(verifySignature("p", "data2", sig)).toBe(false);
    expect(verifySignature("p", "data", "")).toBe(false);
  });
});

function appSecretIn(env: string): string {
  const prev = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", env);
  try {
    return appSecret();
  } finally {
    vi.stubEnv("NODE_ENV", prev ?? "");
  }
}
