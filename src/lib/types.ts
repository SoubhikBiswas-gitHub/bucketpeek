/** Shared data contracts between server loaders, route handlers and components. */

export type FileKind =
  | "video"
  | "image"
  | "audio"
  | "pdf"
  | "markdown"
  | "json"
  | "table"
  | "code"
  | "text"
  | "archive"
  | "other";

export interface FolderEntry {
  /** Last path segment, no trailing slash. */
  name: string;
  /** Full prefix with trailing slash, e.g. "Factory/episodes/". */
  prefix: string;
}

export interface FileEntry {
  key: string;
  name: string;
  ext: string;
  kind: FileKind;
  /** Short type label, e.g. "MP4", "JSON", "File". */
  type: string;
  size: number;
  /** ISO timestamp, or null when unknown. */
  modified: string | null;
}

export interface FileMeta extends FileEntry {
  contentType: string;
}

export interface Listing {
  prefix: string;
  folders: FolderEntry[];
  files: FileEntry[];
  /** True when more entries exist beyond this page. */
  truncated: boolean;
  /** Opaque cursor for the next page (pass to /api/list?cursor=), or null when this is the last page. */
  nextCursor?: string | null;
}

export type VideoMode = "direct" | "convert" | "unsupported";

export type Preview =
  | { type: "markdown" | "json" | "code" | "text"; text: string; truncated: boolean; lang: string }
  | { type: "table"; header: string[]; rows: string[][]; truncated: boolean; rowsTruncated: boolean }
  | { type: "image" | "audio" | "pdf"; url: string }
  | {
      type: "video";
      url: string;
      mode: VideoMode;
      canConvert: boolean;
      /** Why a browser-playable container is streamed by the server instead: fragmented, or an index too big to wait for. */
      streamReason?: "fragments" | "layout";
      /** The server's explanation, for the note shown while it prepares the stream. */
      why?: string;
    }
  | { type: "none" }
  | { type: "error"; title: string; message: string };

export interface Neighbor {
  key: string;
  name: string;
  kind: FileKind;
}

export interface ViewData {
  file: FileMeta;
  preview: Preview;
  // ISO time the preview's media URLs stop working; the page re-signs them just before.
  linksExpireAt: string;
  /** 1-based position of this file among the folder's files, or null if not found in the listing. */
  position: { index: number; total: number } | null;
  folder: string;
  prev: Neighbor | null;
  next: Neighbor | null;
}

export interface Connection {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
}

/** Public view of the connection, safe to send to the browser. */
export interface ConnectionInfo {
  bucket: string;
  region: string;
}

export interface AppError {
  title: string;
  message: string;
  status: number;
  detail?: string;
}

export interface ConvertJob {
  id: string;
  /** VOD playlist for the whole video; segments are converted as the player asks for them. */
  playlist: string;
  /** Seconds. */
  duration: number;
  /** Set instead of a stream when the original plays fixed from this URL (no conversion needed). */
  direct?: string;
}

export interface ConvertStatus {
  /** The source can't be converted at all (e.g. ffmpeg can't decode it). */
  failed: boolean;
  error: string;
}

/** Most keys POST /api/links signs at once. Signing is local (no AWS call); this bounds the response. */
export const MAX_LINK_KEYS = 1000;

/** Presigned S3 URLs from POST /api/links. */
export interface SignedLinks {
  /** Absolute S3 URLs, or paths on this app in mock mode. */
  links: { key: string; url: string }[];
  // ISO time the links stop working.
  expiresAt: string;
}

/** One UTF-8-safe slice of a text file, from GET /api/files/text. */
export interface TextChunk {
  text: string;
  /** Byte offset where `text` starts (may be a few bytes after the requested offset, never inside a character). */
  offset: number;
  /** Byte offset to request next, or null at the end of the file. */
  nextOffset: number | null;
  /** File size in bytes. */
  total: number;
}

export type HealthProblemKind = "empty" | "no-index" | "repairable" | "damaged" | "unreadable";

export interface HealthProblem {
  key: string;
  size: number;
  kind: HealthProblemKind;
  detail: string;
}

export interface KindTally {
  files: number;
  bytes: number;
}

export interface BucketInventory {
  files: number;
  bytes: number;
  byKind: Partial<Record<FileKind, KindTally>>;
}

/** A bucket's one-time video check (see lib/server/health.ts). */
export type BucketHealth =
  | { status: "none" }
  | {
      status: "running";
      // `checkingSince`: when the listing finished and the checks began (for the time left).
      progress: { startedAt: string; checkingSince?: string; folders: number; videos: number; checked: number; inventory?: BucketInventory };
    }
  | { status: "failed"; error: string; at: string }
  | {
      status: "done";
      startedAt: string;
      finishedAt: string;
      totals: {
        folders: number;
        videos: number;
        bytes: number;
        empty: number;
        noIndex: number;
        repairable: number;
        damaged: number;
        unreadable: number;
      };
      problems: HealthProblem[];
      // Absent from reports saved before the bucket overview existed.
      inventory?: BucketInventory;
    };
