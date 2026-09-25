import { TEXT_KINDS } from "./kinds";
import type { FileEntry } from "./types";

// Shared by the grid tiles and GET /api/thumb. Every preview is S3 data transfer (see docs/costs.md), so
// each kind reads as little as it can: images their original (capped), video one frame, text a few KB.

// "image": the original through /api/files/open. "frame": a small image from /api/thumb. "text": the first lines.
export type TilePreviewKind = "image" | "frame" | "text";

// Raster formats the server scales down to tile size; the browser gets a ~20 KB image it can cache.
const SCALED_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);
// Small or vector formats shown from their original.
const ORIGINAL_IMAGE_EXTS = new Set(["svg", "ico"]);

// The server reads the whole image once to scale it. Camera photos and exported frames are a few MB;
// past this a tile keeps its icon.
export const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

// pdftoppm needs the whole file on disk (the page index is at the end), so big PDFs keep their icon.
export const PDF_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;

// About 40 lines of code.
export const TEXT_PREVIEW_BYTES = 2048;

// Tiles are at most ~360 px wide, so this is sharp at 1.3x.
export const THUMB_WIDTH = 480;

export function tilePreviewOf(file: Pick<FileEntry, "kind" | "ext" | "size">): TilePreviewKind | null {
  if (file.size <= 0) return null;
  if (file.kind === "image" && ORIGINAL_IMAGE_EXTS.has(file.ext)) return file.size <= IMAGE_PREVIEW_MAX_BYTES ? "image" : null;
  if (thumbKindOf(file)) return "frame";
  return TEXT_KINDS.has(file.kind) ? "text" : null;
}

// What GET /api/thumb makes for a file, or null when it makes nothing.
export function thumbKindOf(file: Pick<FileEntry, "kind" | "ext" | "size">): "video" | "pdf" | "image" | null {
  if (file.size <= 0) return null;
  switch (file.kind) {
    case "image":
      return SCALED_IMAGE_EXTS.has(file.ext) && file.size <= IMAGE_PREVIEW_MAX_BYTES ? "image" : null;
    case "video":
      // ffmpeg reads the index and one keyframe, whatever the file's size.
      return "video";
    case "pdf":
      return file.size <= PDF_PREVIEW_MAX_BYTES ? "pdf" : null;
    default:
      return null;
  }
}

// Changes whenever the object does, so a cached preview of an older version is never shown.
export function previewVersion(file: Pick<FileEntry, "size" | "modified">): string {
  return `${file.size}:${file.modified ?? ""}`;
}

export interface TextSnippet {
  text: string;
  // Few, long lines (minified JSON, prose): wrap them rather than show one clipped line.
  wrap: boolean;
}

const SNIPPET_LINES = 18;
const SNIPPET_LINE_CHARS = 120;
// Characters a text file doesn't contain; a few of them mean the file is binary after all.
const BINARY = /[\u0000-\u0008\u000e-\u001f�]/g;

// Null when there is nothing to show or the bytes don't look like text (a mislabelled binary file),
// so the tile keeps its icon.
export function textSnippet(raw: string): TextSnippet | null {
  const text = raw.replace(/^﻿/, "");
  const binary = text.match(BINARY)?.length ?? 0;
  if (binary > Math.max(2, text.length * 0.02)) return null;

  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .slice(0, SNIPPET_LINES)
    .map((l) => l.replace(/\t/g, "  ").replace(BINARY, "").trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();
  if (lines.length === 0) return null;

  const wrap = lines.length <= 3 && lines.some((l) => l.length > SNIPPET_LINE_CHARS / 2);
  return wrap
    ? { text: lines.join("\n").slice(0, SNIPPET_LINES * SNIPPET_LINE_CHARS / 2), wrap }
    : { text: lines.map((l) => l.slice(0, SNIPPET_LINE_CHARS)).join("\n"), wrap };
}
