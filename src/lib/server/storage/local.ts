import "server-only";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import mime from "mime";
import type { ObjectDetails } from "@/lib/file-details";
import { baseName } from "@/lib/kinds";
import { folderOf } from "@/lib/paths";
import type { FileEntry, FolderEntry } from "@/lib/types";
import { log } from "@/lib/server/log";
import { sign, verifySignature } from "@/lib/server/secret";
import { decodeCursor, encodeCursor } from "./cursor";
import { toFileEntry } from "./entry";
import { decodeText } from "./text";
import { DEFAULT_LINK_SECONDS, type SignedUrlOptions, type Storage } from "./types";

/**
 * A folder on disk that behaves like a bucket. Enabled with LENS_MOCK_DIR for
 * development, demos and end-to-end tests. Any credentials connect.
 */
export function mockRoot(): string | null {
  const dir = process.env.LENS_MOCK_DIR;
  return dir ? path.resolve(dir) : null;
}

const mocklog = log.child({ scope: "mock" });

function accessDenied(key: string): Error {
  mocklog.warn("path escapes the mock bucket", { key });
  return Object.assign(new Error("Path escapes the mock bucket"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
}

function notFound(): Error {
  return Object.assign(new Error("Not Found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
}

const isMissing = (e: unknown) => ["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"].includes((e as { code?: string })?.code ?? "");

/** Resolves a key inside the root lexically, refusing anything that escapes it (`../`, absolute paths, NUL). */
export function resolveMockPath(root: string, key: string): string {
  if (key.includes("\u0000")) throw accessDenied(key);
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) throw accessDenied(key);
  return full;
}

/**
 * Like `resolveMockPath`, but also follows symlinks and refuses targets outside the root.
 * Throws NotFound when the path doesn't exist.
 */
export async function safeMockPath(root: string, key: string): Promise<string> {
  const full = resolveMockPath(root, key);
  let realRoot: string;
  let real: string;
  try {
    [realRoot, real] = await Promise.all([fs.realpath(root), fs.realpath(full)]);
  } catch (e) {
    if (isMissing(e)) throw notFound();
    mocklog.error("couldn’t resolve a mock path", { key, err: e });
    throw e;
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw accessDenied(key);
  return real;
}

/** Order S3 lists keys in: by UTF-8 bytes. */
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

const STAT_BATCH = 64;

/** What a mock link's signature covers. */
function linkPayload(key: string, exp: number, download: boolean, type: string): string {
  return JSON.stringify([key, exp, download ? 1 : 0, type]);
}

export interface MockLink {
  key: string;
  download: boolean;
  type: string;
}

/**
 * Checks a mock link's `exp` and `sig` the way S3 checks a presigned URL.
 * Returns the link's parameters, or null when it's forged, altered or expired.
 */
export function verifyMockLink(params: URLSearchParams, now = Date.now()): MockLink | null {
  const key = params.get("key") ?? "";
  const exp = Number(params.get("exp"));
  const sig = params.get("sig") ?? "";
  const download = params.get("download") === "1";
  const type = params.get("type") ?? "";
  if (!key || !sig || !Number.isSafeInteger(exp) || exp * 1000 < now) return null;
  return verifySignature("mock-link", linkPayload(key, exp, download, type), sig) ? { key, download, type } : null;
}

export class LocalStorage implements Storage {
  constructor(private root: string) {}

  async list(prefix: string, maxItems: number, cursor?: string | null) {
    const limit = Math.max(1, Math.floor(maxItems));
    // The cursor holds the last key (or folder prefix) the previous page returned, like S3's StartAfter.
    const after = cursor ? decodeCursor(prefix, cursor) : null;
    const empty = { prefix, folders: [], files: [], truncated: false, nextCursor: null };
    // Like S3, a prefix needn't end at a folder boundary: "Factory/ep" lists what starts with "ep".
    const dirPrefix = folderOf(prefix);
    const partial = prefix.slice(dirPrefix.length);

    let dir: string;
    let entries: Dirent[];
    try {
      dir = await safeMockPath(this.root, dirPrefix);
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (isMissing(e) || (e as Error).name === "NotFound") return empty;
      mocklog.error("couldn’t list a mock folder", { prefix, err: e });
      throw e;
    }

    // S3 has no symlinks; skipping them also keeps listings inside the root.
    const candidates = entries
      .filter((e) => !e.name.startsWith(".") && e.name.startsWith(partial) && (e.isDirectory() || e.isFile()))
      .map((e) => ({ entry: e, id: dirPrefix + e.name + (e.isDirectory() ? "/" : "") }))
      .filter((c) => after === null || byteOrder(c.id, after) > 0)
      .sort((a, b) => byteOrder(a.id, b.id));

    const picked = candidates.slice(0, limit);
    const folders: FolderEntry[] = [];
    const fileSlots: (FileEntry | null)[] = [];

    for (let i = 0; i < picked.length; i += STAT_BATCH) {
      const batch = picked.slice(i, i + STAT_BATCH);
      const stats = await Promise.all(
        batch.map(({ entry }) => (entry.isFile() ? fs.stat(path.join(dir, entry.name)).catch(() => null) : null)),
      );
      batch.forEach(({ entry, id }, j) => {
        if (entry.isDirectory()) folders.push({ name: entry.name, prefix: id });
        else {
          const st = stats[j];
          // A file deleted between readdir and stat is simply gone.
          fileSlots.push(st ? toFileEntry(id, st.size, st.mtime) : null);
        }
      });
    }

    const more = candidates.length > limit;
    return {
      prefix,
      folders,
      files: fileSlots.filter((f): f is FileEntry => f !== null),
      truncated: more,
      nextCursor: more ? encodeCursor(prefix, picked[picked.length - 1].id) : null,
    };
  }

  async head(key: string) {
    const real = await safeMockPath(this.root, key);
    const st = await fs.stat(real);
    if (!st.isFile()) throw notFound();
    return { ...toFileEntry(key, st.size, st.mtime), contentType: mime.getType(baseName(key)) ?? "" };
  }

  async details(key: string): Promise<ObjectDetails> {
    await this.head(key);
    return {
      etag: null,
      storageClass: null,
      versionId: null,
      contentEncoding: null,
      contentLanguage: null,
      cacheControl: null,
      contentDisposition: null,
      expires: null,
      serverSideEncryption: null,
      kmsKeyId: null,
      bucketKeyEnabled: null,
      sseCustomerAlgorithm: null,
      expiration: null,
      restore: null,
      archiveStatus: null,
      checksumType: null,
      checksums: [],
      metadata: [],
      replicationStatus: null,
      objectLockMode: null,
      objectLockRetainUntil: null,
      objectLockLegalHold: null,
      multipartParts: null,
      tags: null,
    };
  }

  /** Reads up to `length` bytes at `offset`, and the file's size. */
  private async readAt(key: string, offset: number, length: number): Promise<{ bytes: Buffer; size: number }> {
    const handle = await fs.open(await safeMockPath(this.root, key), "r");
    try {
      const st = await handle.stat();
      if (!st.isFile()) throw notFound();
      const start = Math.max(0, Math.floor(offset));
      const buf = Buffer.alloc(Math.max(0, Math.min(st.size - start, Math.floor(length))));
      let filled = 0;
      while (filled < buf.length) {
        const { bytesRead } = await handle.read(buf, filled, buf.length - filled, start + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      return { bytes: buf.subarray(0, filled), size: st.size };
    } finally {
      await handle.close();
    }
  }

  async readStart(key: string, maxBytes: number) {
    const { bytes, size } = await this.readAt(key, 0, maxBytes);
    const truncated = size > bytes.length;
    return { text: decodeText(bytes, truncated), truncated };
  }

  async readBytes(key: string, offset: number, length: number) {
    return new Uint8Array((await this.readAt(key, offset, Math.max(1, length))).bytes);
  }

  async signedUrl(key: string, o: SignedUrlOptions = {}) {
    const lifetime = Math.max(1, Math.floor(o.expiresIn ?? DEFAULT_LINK_SECONDS));
    const exp = Math.floor(Date.now() / 1000) + lifetime;
    const type = o.download ? "" : (o.contentType ?? "");
    const q = new URLSearchParams({ key, exp: String(exp) });
    if (o.download) q.set("download", "1");
    if (type) q.set("type", type);
    q.set("sig", sign("mock-link", linkPayload(key, exp, Boolean(o.download), type)));
    return `/api/mock?${q}`;
  }
}
