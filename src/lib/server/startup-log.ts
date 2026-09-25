import "server-only";
import { currentLevel, log } from "./log";
import { mockRoot } from "./storage/local";

// What this server was started with, minus anything secret: enough to tell a misconfigured deploy apart.
export function logStartup(): void {
  log.info("server starting", {
    scope: "startup",
    node: process.version,
    env: process.env.NODE_ENV,
    logLevel: currentLevel(),
    version: process.env.APP_VERSION || undefined,
    commit: process.env.APP_COMMIT?.slice(0, 12) || undefined,
    mockDir: mockRoot() ?? undefined,
    // Only whether it is set: the key itself seals every session.
    keyConfigured: Boolean(process.env.SECRET_KEY),
    cookieSecure: process.env.COOKIE_SECURE === "true",
    ffmpeg: process.env.FFMPEG_PATH ? "FFMPEG_PATH" : "PATH",
    hlsDir: process.env.LENS_HLS_DIR || undefined,
  });
}
