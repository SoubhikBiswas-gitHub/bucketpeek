import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_LIMITS_COOKIE } from "@/lib/download-limits";

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === MOCK_LIMITS_COOKIE && jar.value ? { name, value: jar.value } : undefined) }),
}));

import { bulkDownloadLimits } from "@/lib/server/download-limits";

afterEach(() => {
  vi.unstubAllEnvs();
  jar.value = undefined;
});

describe("bulkDownloadLimits", () => {
  it("reads the environment at request time", async () => {
    vi.stubEnv("LENS_MOCK_DIR", "");
    vi.stubEnv("LENS_BULK_DOWNLOAD_MAX_GB", "2.5");
    vi.stubEnv("LENS_BULK_DOWNLOAD_MAX_FILES", "10");
    expect(await bulkDownloadLimits()).toEqual({ maxBytes: 2_500_000_000, maxFiles: 10 });
  });

  it("ignores the test cookie against a real bucket", async () => {
    vi.stubEnv("LENS_MOCK_DIR", "");
    jar.value = "maxBytes=1&maxFiles=1";
    expect(await bulkDownloadLimits()).toEqual({ maxBytes: 1_000_000_000, maxFiles: 50 });
  });

  it("lets the test cookie lower the limits in mock mode", async () => {
    vi.stubEnv("LENS_MOCK_DIR", "./fixtures/bucket");
    jar.value = "maxBytes=1000&maxFiles=2";
    expect(await bulkDownloadLimits()).toEqual({ maxBytes: 1000, maxFiles: 2 });
  });
});
