import { describe, expect, it } from "vitest";
import { createLimiter } from "@/components/browser/preview-slots";
import {
  IMAGE_PREVIEW_MAX_BYTES,
  PDF_PREVIEW_MAX_BYTES,
  previewVersion,
  textSnippet,
  thumbKindOf,
  tilePreviewOf,
} from "@/lib/previews";
import type { FileKind } from "@/lib/types";

const f = (kind: FileKind, ext: string, size = 1000) => ({ kind, ext, size });

describe("tilePreviewOf", () => {
  it("scales raster images on the server and shows vector ones as they are, up to the size cap", () => {
    expect(tilePreviewOf(f("image", "png"))).toBe("frame");
    expect(thumbKindOf(f("image", "png"))).toBe("image");
    expect(tilePreviewOf(f("image", "jpg", IMAGE_PREVIEW_MAX_BYTES))).toBe("frame");
    expect(tilePreviewOf(f("image", "jpg", IMAGE_PREVIEW_MAX_BYTES + 1))).toBeNull();
    expect(thumbKindOf(f("image", "jpg", IMAGE_PREVIEW_MAX_BYTES + 1))).toBeNull();
    expect(tilePreviewOf(f("image", "svg"))).toBe("image");
    expect(thumbKindOf(f("image", "svg"))).toBeNull();
    expect(tilePreviewOf(f("image", "tiff"))).toBeNull();
  });

  it("asks the server for video frames at any size, and PDF pages up to 50 MB", () => {
    expect(tilePreviewOf(f("video", "mp4", 900e9))).toBe("frame");
    expect(tilePreviewOf(f("video", "avi"))).toBe("frame");
    expect(tilePreviewOf(f("pdf", "pdf", PDF_PREVIEW_MAX_BYTES))).toBe("frame");
    expect(tilePreviewOf(f("pdf", "pdf", PDF_PREVIEW_MAX_BYTES + 1))).toBeNull();
  });

  it("shows text for every text kind, whatever its size", () => {
    for (const kind of ["markdown", "json", "table", "code", "text"] as const) {
      expect(tilePreviewOf(f(kind, "x", 50e9))).toBe("text");
    }
  });

  it("keeps the icon for empty files and kinds with no preview", () => {
    expect(tilePreviewOf(f("video", "mp4", 0))).toBeNull();
    expect(tilePreviewOf(f("json", "json", 0))).toBeNull();
    for (const kind of ["audio", "archive", "other"] as const) expect(tilePreviewOf(f(kind, "bin"))).toBeNull();
  });
});

describe("previewVersion", () => {
  it("changes with size and modified time", () => {
    const a = previewVersion({ size: 1, modified: "2026-01-01T00:00:00.000Z" });
    expect(previewVersion({ size: 2, modified: "2026-01-01T00:00:00.000Z" })).not.toBe(a);
    expect(previewVersion({ size: 1, modified: "2026-01-02T00:00:00.000Z" })).not.toBe(a);
    expect(previewVersion({ size: 1, modified: null })).toBe("1:");
  });
});

describe("textSnippet", () => {
  it("keeps the first lines, trimmed and with tabs expanded", () => {
    const text = Array.from({ length: 40 }, (_, i) => `\tline ${i}   `).join("\r\n");
    const s = textSnippet(text)!;
    expect(s.wrap).toBe(false);
    const lines = s.text.split("\n");
    expect(lines).toHaveLength(18);
    expect(lines[0]).toBe("  line 0");
  });

  it("drops blank lines around the text and a byte-order mark", () => {
    expect(textSnippet("﻿\n\n# Title\n\nBody\n\n\n")?.text).toBe("# Title\n\nBody");
  });

  it("clips long lines, but wraps a file that is one long line (minified JSON)", () => {
    const long = "x".repeat(500);
    expect(textSnippet(`a\nb\nc\nd\n${long}`)?.text.split("\n")[4]).toHaveLength(120);
    const minified = textSnippet(JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => i) }))!;
    expect(minified.wrap).toBe(true);
    expect(minified.text.length).toBeGreaterThan(120);
    expect(minified.text.length).toBeLessThanOrEqual(18 * 60);
  });

  it("returns null for empty or binary content", () => {
    expect(textSnippet("")).toBeNull();
    expect(textSnippet("\n \n\t\n")).toBeNull();
    expect(textSnippet("\u0000\u0001\u0002PK\u0003\u0004��� binary")).toBeNull();
    // A stray replacement character (a split multi-byte character at the cut) is fine.
    expect(textSnippet("héllo wörld�")?.text).toBe("héllo wörld");
  });
});

describe("createLimiter", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("grants up to `max` slots and hands freed ones to the next waiter", async () => {
    const lim = createLimiter(2);
    const signal = new AbortController().signal;
    const a = await lim.acquire(signal);
    const b = await lim.acquire(signal);
    let c: (() => void) | null = null;
    void lim.acquire(signal).then((r) => (c = r));
    await tick();
    expect(c).toBeNull();
    expect(lim.waiting).toBe(1);
    a!();
    a!(); // freeing twice frees once
    await tick();
    expect(c).not.toBeNull();
    expect(lim.active).toBe(2);
    b!();
    c!();
    expect(lim.active).toBe(0);
  });

  it("gives up on a waiter whose tile scrolled away", async () => {
    const lim = createLimiter(1);
    const hold = await lim.acquire(new AbortController().signal);
    const ctrl = new AbortController();
    const waiting = lim.acquire(ctrl.signal);
    ctrl.abort();
    expect(await waiting).toBeNull();
    expect(lim.waiting).toBe(0);
    hold!();
    expect(lim.active).toBe(0);
    const aborted = new AbortController();
    aborted.abort();
    expect(await lim.acquire(aborted.signal)).toBeNull();
  });

  it("frees a slot whose tile went away before it heard of the grant", async () => {
    const lim = createLimiter(1);
    // React runs a tile's effect, cleans it up and runs it again in dev: the first grant is never seen.
    const first = new AbortController();
    const granted = lim.acquire(first.signal);
    first.abort();
    expect(lim.active).toBe(0);
    const second = await lim.acquire(new AbortController().signal);
    expect(second).not.toBeNull();
    expect(lim.active).toBe(1);
    // The unseen release is harmless to call late.
    (await granted)?.();
    expect(lim.active).toBe(1);
    second!();
    expect(lim.active).toBe(0);
  });
});
