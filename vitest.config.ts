import os from "node:os";
import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "tests/unit/stubs/server-only.ts"),
    },
  },
  test: {
    // Node by default; a component test can opt into the browser with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    // The development session secret goes to a temp folder, not the checkout; logs stay quiet.
    env: { TZ: "UTC", LOG_LEVEL: "silent", LENS_SECRET_FILE: path.join(os.tmpdir(), `lens-vitest-${process.pid}`, "secret") },
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/app/api/files/**/*.ts", "src/app/api/list/**/*.ts", "src/app/api/mock/**/*.ts"],
      exclude: ["src/lib/utils.ts", "src/lib/brand.ts"],
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
  },
});
