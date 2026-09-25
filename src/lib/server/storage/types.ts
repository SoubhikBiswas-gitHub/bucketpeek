import type { ObjectDetails } from "@/lib/file-details";
import type { FileMeta, Listing } from "@/lib/types";

export const DEFAULT_LINK_SECONDS = 3600;

export interface SignedUrlOptions {
  /** Force a download with the file's name. */
  download?: boolean;
  /** Serve inline with this Content-Type (e.g. application/pdf). */
  contentType?: string;
  // Seconds; DEFAULT_LINK_SECONDS when unset.
  expiresIn?: number;
}

/** Everything the app needs from a bucket. Implemented by S3 and by a local folder for development. */
export interface Storage {
  /**
   * One page of a folder: at most `maxItems` folders + files, in S3 key order.
   * Pass the previous page's `nextCursor` as `cursor` to continue; it throws InvalidCursor
   * for a cursor that was tampered with or made for another prefix.
   */
  list(prefix: string, maxItems: number, cursor?: string | null): Promise<Listing>;
  head(key: string): Promise<FileMeta>;
  // Throws like `head` for a missing key; fields the storage doesn't keep (all of them, locally) are null.
  details(key: string): Promise<ObjectDetails>;
  /** Reads up to `maxBytes` from the start of the file as UTF-8. */
  readStart(key: string, maxBytes: number): Promise<{ text: string; truncated: boolean }>;
  /** Raw bytes [offset, offset + length), fewer at the end of the file. `offset` must be below the file size. */
  readBytes(key: string, offset: number, length: number): Promise<Uint8Array>;
  /** A URL the browser (and ffmpeg) can fetch the raw object from. May be relative in local mode. */
  signedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
}

/** Size of the first listing page pages render on the server; later pages come from /api/list?cursor=. */
export const MAX_LIST_ITEMS = 5000;
