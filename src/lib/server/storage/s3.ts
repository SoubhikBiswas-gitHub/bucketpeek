import "server-only";
import { createHash } from "node:crypto";
import {
  GetBucketLocationCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type HeadObjectCommandOutput,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectChecksum, ObjectDetails, ObjectTags } from "@/lib/file-details";
import { baseName } from "@/lib/kinds";
import type { Connection, FileEntry, FolderEntry } from "@/lib/types";
import { errorCode, httpStatus, isNotFound } from "@/lib/server/errors";
import { contentDisposition } from "@/lib/server/http";
import { log, type Level } from "@/lib/server/log";
import { decodeCursor, encodeCursor } from "./cursor";
import { toFileEntry } from "./entry";
import { decodeText } from "./text";
import { DEFAULT_LINK_SECONDS, type SignedUrlOptions, type Storage } from "./types";

const DEFAULT_REGION = "us-east-1";
/** S3 returns at most 1000 keys per page. */
const PAGE_SIZE = 1000;
/** Hard stop for one listing, whatever S3 returns. */
const MAX_PAGES = 100;
/** SigV4 presigned URLs live at most 7 days. */
const MAX_EXPIRY = 604800;

type Credentials = Pick<Connection, "accessKeyId" | "secretAccessKey">;

// One client per credentials + region, reused across requests so keep-alive sockets are shared.
// Survives dev hot reloads. Evicted clients are left to finish in-flight requests and be collected.
const MAX_CLIENTS = 32;
const g = globalThis as unknown as { __lensS3Clients?: Map<string, S3Client> };
const clients: Map<string, S3Client> = (g.__lensS3Clients ??= new Map());

function client(c: Credentials, region: string): S3Client {
  const id = createHash("sha256").update(`${c.accessKeyId}\u0000${c.secretAccessKey}\u0000${region}`).digest("hex");
  const cached = clients.get(id);
  if (cached) {
    clients.delete(id);
    clients.set(id, cached);
    return cached;
  }
  const s3 = new S3Client({
    region,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    followRegionRedirects: true,
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 30000, throwOnRequestTimeout: true },
  });
  clients.set(id, s3);
  if (clients.size > MAX_CLIENTS) clients.delete(clients.keys().next().value!);
  return s3;
}

const s3log = log.child({ scope: "s3" });

interface Target {
  bucket: string;
  key?: string;
  prefix?: string;
}

function failureLevel(e: unknown): Level {
  const status = httpStatus(e);
  if (isNotFound(e)) return "info";
  if (status === undefined) return "error";
  if (status === 503 || status < 500) return "warn";
  return "error";
}

// Every S3 round trip: debug with its time when it works; the AWS error name, status and request id when
// it doesn't. `expected` failures are handled by the caller, so they log at debug.
async function call<T>(op: string, target: Target, run: () => Promise<T>, expected?: (e: unknown) => boolean): Promise<T> {
  const start = performance.now();
  try {
    const out = await run();
    if (s3log.enabled("debug")) s3log.debug(op, { op, ...target, ms: Math.round(performance.now() - start) });
    return out;
  } catch (e) {
    const level = expected?.(e) ? "debug" : failureLevel(e);
    s3log.log(level, `${op} failed`, { op, ...target, ms: Math.round(performance.now() - start), err: e });
    throw e;
  }
}

function regionHeader(e: unknown): string | undefined {
  const headers = (e as { $response?: { headers?: Record<string, string | undefined> } })?.$response?.headers;
  return headers?.["x-amz-bucket-region"] || undefined;
}

/** GetBucketLocation needs its own permission, so it's only a fallback. */
async function bucketLocation(c: Credentials & { bucket: string }): Promise<string | undefined> {
  try {
    const r = await call(
      "GetBucketLocation",
      { bucket: c.bucket },
      () => client(c, DEFAULT_REGION).send(new GetBucketLocationCommand({ Bucket: c.bucket })),
      () => true,
    );
    const loc = r.LocationConstraint as string | undefined;
    return !loc ? DEFAULT_REGION : loc === "EU" ? "eu-west-1" : loc;
  } catch {
    return undefined;
  }
}

/**
 * Confirms the keys can list the bucket and returns the bucket's region.
 * Throws the AWS error (InvalidAccessKeyId, NoSuchBucket, AccessDenied …) otherwise.
 */
export async function verifyS3(c: Pick<Connection, "accessKeyId" | "secretAccessKey" | "bucket">): Promise<string> {
  let region: string | undefined;
  try {
    // With followRegionRedirects, a bucket in another region answers after one redirect.
    const head = await call(
      "HeadBucket",
      { bucket: c.bucket },
      () => client(c, DEFAULT_REGION).send(new HeadBucketCommand({ Bucket: c.bucket })),
      (e) => httpStatus(e) !== undefined,
    );
    region = head.BucketRegion || undefined;
  } catch (e) {
    const status = httpStatus(e);
    if (status === 404 || errorCode(e) === "NotFound") {
      // HEAD responses have no body, so the SDK can only say "NotFound". For a bucket that means NoSuchBucket.
      throw Object.assign(new Error("The specified bucket does not exist"), {
        name: "NoSuchBucket",
        $metadata: { httpStatusCode: 404 },
      });
    }
    // No HTTP response at all (DNS, timeout …): nothing below would do better.
    if (status === undefined) throw e;
    // A 403/400 HEAD hides the real reason. ListObjects below reports it with a body.
    region = regionHeader(e);
  }
  region ??= await bucketLocation(c);
  const resolved = region ?? DEFAULT_REGION;
  await call("ListObjectsV2", { bucket: c.bucket }, () =>
    client(c, resolved).send(new ListObjectsV2Command({ Bucket: c.bucket, MaxKeys: 1 })),
  );
  s3log.info("bucket verified", { bucket: c.bucket, region: resolved });
  return resolved;
}

const CHECKSUM_FIELD = /^Checksum(?!Type$)([A-Z0-9]+)$/;

export function objectDetailsFromHead(h: HeadObjectCommandOutput, tags: ObjectTags | null): ObjectDetails {
  const str = (v: string | undefined | null) => (v ? v : null);
  const date = (d: Date | undefined) => (d && !Number.isNaN(d.getTime()) ? d.toISOString() : null);
  const checksums: ObjectChecksum[] = [];
  for (const [field, value] of Object.entries(h)) {
    const m = CHECKSUM_FIELD.exec(field);
    if (m && typeof value === "string" && value) checksums.push({ algorithm: m[1], value });
  }
  // A multipart upload's ETag ends in "-<parts>".
  const parts = /-(\d+)"?$/.exec(h.ETag ?? "");
  return {
    etag: str(h.ETag),
    // S3 leaves the header out for STANDARD.
    storageClass: h.StorageClass ?? "STANDARD",
    versionId: h.VersionId && h.VersionId !== "null" ? h.VersionId : null,
    contentEncoding: str(h.ContentEncoding),
    contentLanguage: str(h.ContentLanguage),
    cacheControl: str(h.CacheControl),
    contentDisposition: str(h.ContentDisposition),
    expires: date(h.Expires) ?? str(h.ExpiresString),
    serverSideEncryption: str(h.ServerSideEncryption),
    kmsKeyId: str(h.SSEKMSKeyId),
    bucketKeyEnabled: h.BucketKeyEnabled ?? null,
    sseCustomerAlgorithm: str(h.SSECustomerAlgorithm),
    expiration: str(h.Expiration),
    restore: str(h.Restore),
    archiveStatus: str(h.ArchiveStatus),
    checksumType: str(h.ChecksumType),
    checksums,
    metadata: Object.entries(h.Metadata ?? {})
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    replicationStatus: str(h.ReplicationStatus),
    objectLockMode: str(h.ObjectLockMode),
    objectLockRetainUntil: date(h.ObjectLockRetainUntilDate),
    objectLockLegalHold: str(h.ObjectLockLegalHoldStatus),
    multipartParts: h.PartsCount ?? (parts ? Number(parts[1]) : null),
    tags,
  };
}

export class S3Storage implements Storage {
  private s3: S3Client;

  constructor(private c: Connection) {
    this.s3 = client(c, c.region || DEFAULT_REGION);
  }

  async list(prefix: string, maxItems: number, cursor?: string | null) {
    const limit = Math.max(1, Math.floor(maxItems));
    const folders: FolderEntry[] = [];
    const files: FileEntry[] = [];
    const seen = new Set<string>();
    let token = cursor ? decodeCursor(prefix, cursor) : undefined;
    if (token) seen.add(token);
    let next: string | undefined;

    for (let page = 0; ; page++) {
      const remaining = limit - folders.length - files.length;
      const out: ListObjectsV2CommandOutput = await call("ListObjectsV2", { bucket: this.c.bucket, prefix }, () =>
        this.s3.send(
          new ListObjectsV2Command({
            Bucket: this.c.bucket,
            Prefix: prefix || undefined,
            Delimiter: "/",
            ContinuationToken: token,
            // Folders (CommonPrefixes) count toward MaxKeys too, so this never overshoots the limit.
            MaxKeys: Math.min(PAGE_SIZE, remaining),
          }),
        ),
      );
      for (const p of out.CommonPrefixes ?? []) {
        if (!p.Prefix || !p.Prefix.startsWith(prefix)) continue;
        folders.push({ name: p.Prefix.slice(prefix.length).replace(/\/$/, ""), prefix: p.Prefix });
      }
      for (const o of out.Contents ?? []) {
        // The folder's own "directory marker" object is not a file in it.
        if (!o.Key || o.Key === prefix) continue;
        files.push(toFileEntry(o.Key, o.Size ?? 0, o.LastModified));
      }

      next = out.IsTruncated ? out.NextContinuationToken : undefined;
      // A repeated token would loop forever; the page cap bounds work per request (the cursor continues it).
      if (next && seen.has(next)) s3log.warn("ListObjectsV2 repeated a continuation token", { bucket: this.c.bucket, prefix, page });
      if (!next || seen.has(next) || page + 1 >= MAX_PAGES || folders.length + files.length >= limit) break;
      seen.add(next);
      token = next;
    }

    const more = next !== undefined && !seen.has(next);
    return {
      prefix,
      folders,
      files,
      truncated: next !== undefined,
      nextCursor: more ? encodeCursor(prefix, next!) : null,
    };
  }

  async head(key: string) {
    const r = await call("HeadObject", { bucket: this.c.bucket, key }, () =>
      this.s3.send(new HeadObjectCommand({ Bucket: this.c.bucket, Key: key })),
    );
    return { ...toFileEntry(key, r.ContentLength ?? 0, r.LastModified), contentType: r.ContentType ?? "" };
  }

  // The app's policy doesn't promise s3:GetObjectTagging, so a tagging denial is reported, not thrown.
  async details(key: string): Promise<ObjectDetails> {
    const head = async (): Promise<HeadObjectCommandOutput> => {
      try {
        return await call(
          "HeadObject",
          { bucket: this.c.bucket, key },
          () => this.s3.send(new HeadObjectCommand({ Bucket: this.c.bucket, Key: key, ChecksumMode: "ENABLED" })),
          (e) => httpStatus(e) === 403,
        );
      } catch (e) {
        // Reading checksums of a KMS-encrypted object needs kms:Decrypt; without it, ask without them.
        if (httpStatus(e) !== 403) throw e;
        return call("HeadObject", { bucket: this.c.bucket, key }, () =>
          this.s3.send(new HeadObjectCommand({ Bucket: this.c.bucket, Key: key })),
        );
      }
    };
    const tags = async (): Promise<ObjectTags> => {
      try {
        const r = await call(
          "GetObjectTagging",
          { bucket: this.c.bucket, key },
          () => this.s3.send(new GetObjectTaggingCommand({ Bucket: this.c.bucket, Key: key })),
          (e) => httpStatus(e) === 403 || errorCode(e) === "AccessDenied",
        );
        return { status: "ok", tags: (r.TagSet ?? []).map((t) => ({ key: t.Key ?? "", value: t.Value ?? "" })) };
      } catch (e) {
        if (httpStatus(e) === 403 || errorCode(e) === "AccessDenied") return { status: "denied" };
        return { status: "error", message: e instanceof Error ? e.message : String(e) };
      }
    };
    const [h, t] = await Promise.all([head(), tags()]);
    return objectDetailsFromHead(h, t);
  }

  async readStart(key: string, maxBytes: number) {
    const want = Math.max(1, Math.floor(maxBytes));
    let r;
    try {
      r = await call(
        "GetObject",
        { bucket: this.c.bucket, key },
        () => this.s3.send(new GetObjectCommand({ Bucket: this.c.bucket, Key: key, Range: `bytes=0-${want - 1}` })),
        (e) => errorCode(e) === "InvalidRange" || httpStatus(e) === 416,
      );
    } catch (e) {
      // S3 answers any Range on a 0-byte object with 416 InvalidRange.
      if (errorCode(e) === "InvalidRange" || httpStatus(e) === 416) return { text: "", truncated: false };
      throw e;
    }
    const all = r.Body ? await r.Body.transformToByteArray() : new Uint8Array();
    const bytes = all.length > want ? all.subarray(0, want) : all;
    const total = Number(r.ContentRange?.split("/")[1]);
    const size = Number.isFinite(total) ? total : all.length;
    const truncated = size > bytes.length;
    return { text: decodeText(bytes, truncated), truncated };
  }

  async readBytes(key: string, offset: number, length: number) {
    const start = Math.max(0, Math.floor(offset));
    const want = Math.max(1, Math.floor(length));
    const r = await call("GetObject", { bucket: this.c.bucket, key }, () =>
      this.s3.send(new GetObjectCommand({ Bucket: this.c.bucket, Key: key, Range: `bytes=${start}-${start + want - 1}` })),
    );
    const bytes = r.Body ? await r.Body.transformToByteArray() : new Uint8Array();
    return bytes.length > want ? bytes.subarray(0, want) : bytes;
  }

  async signedUrl(key: string, o: SignedUrlOptions = {}) {
    const name = baseName(key);
    const cmd = new GetObjectCommand({
      Bucket: this.c.bucket,
      Key: key,
      ...(o.download
        ? { ResponseContentDisposition: contentDisposition("attachment", name) }
        : o.contentType
          ? { ResponseContentDisposition: contentDisposition("inline", name), ResponseContentType: o.contentType }
          : {}),
    });
    const expiresIn = Math.min(MAX_EXPIRY, Math.max(1, Math.floor(o.expiresIn ?? DEFAULT_LINK_SECONDS)));
    return call("presign", { bucket: this.c.bucket, key }, () => getSignedUrl(this.s3, cmd, { expiresIn }));
  }
}
