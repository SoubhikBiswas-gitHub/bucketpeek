import path from "node:path";
import os from "node:os";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the mock bucket (fixtures/bucket, served by
 * `npm run dev:mock` on port 3100). An already-running server is reused.
 *
 *   npm run fixtures      # once, builds fixtures/bucket
 *   npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// Chromium by default; webkit, firefox and mobile-safari only with --project or E2E_ALL_BROWSERS=1.
// Decided once and passed to workers via env: they re-load this file with other argv.
if (process.env.E2E_ALL_BROWSERS === undefined) {
  process.env.E2E_ALL_BROWSERS = process.argv.some((a) => a === "--project" || a.startsWith("--project=")) ? "1" : "0";
}
const allBrowsers = process.env.E2E_ALL_BROWSERS === "1";
const connected = { storageState: "e2e/.auth/connected.json" };

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.output/results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // The dev server compiles routes on first hit; a few workers keep it responsive.
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "./e2e/.output/report", open: "never" }]],
  use: {
    baseURL,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "auth", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...connected }, dependencies: ["auth"] },
    ...(allBrowsers
      ? [
          { name: "webkit", use: { ...devices["Desktop Safari"], ...connected }, dependencies: ["auth"] },
          { name: "firefox", use: { ...devices["Desktop Firefox"], ...connected }, dependencies: ["auth"] },
          { name: "mobile-safari", use: { ...devices["iPhone 15"], ...connected }, dependencies: ["auth"] },
        ]
      : []),
  ],
  webServer: {
    command: "npm run dev:mock",
    // A fresh report folder per run, so the one-time bucket check always runs on current code.
    env: { LENS_HEALTH_DIR: path.join(os.tmpdir(), `lens-e2e-health-${Date.now()}`) },
    url: `${baseURL}/setup`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
