import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GetBucketLocationCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { S3Storage, verifyS3 } from "@/lib/server/storage/s3";
import type { Connection } from "@/lib/types";

const CONN: Connection = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  bucket: "deccan-physical-ai-corpus",
  region: "ap-south-1",
};

type Handler = (this: S3Client, cmd: unknown) => unknown;

function mockSend(handler: Handler) {
  return vi.spyOn(S3Client.prototype, "send").mockImplementation(async function (this: S3Client, cmd: unknown) {
    return handler.call(this, cmd);
  } as never);
}

function awsError(name: string, status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status }, $response: { headers } });
}

const body = (s: string | Uint8Array) => ({
  transformToByteArray: async () => (typeof s === "string" ? new TextEncoder().encode(s) : s),
});

afterEach(() => vi.restoreAllMocks());

describe("S3Storage.list", () => {
  it("pages with continuation tokens and never overshoots the limit", async () => {
    const seen: { MaxKeys?: number; ContinuationToken?: string; Prefix?: string; Delimiter?: string }[] = [];
    mockSend((cmd) => {
      const input = (cmd as ListObjectsV2Command).input;
      seen.push(input);
      if (!input.ContinuationToken) {
        return {
          CommonPrefixes: [{ Prefix: "Factory/annotated/" }, { Prefix: "Factory/episodes/" }],
          Contents: [
            { Key: "Factory/", Size: 0 },
            { Key: "Factory/README.md", Size: 204, LastModified: new Date("2026-01-01T00:00:00Z") },
          ],
          IsTruncated: true,
          NextContinuationToken: "t1",
        };
      }
      return { Contents: [{ Key: "Factory/a b#.mp4", Size: 10 }], IsTruncated: true, NextContinuationToken: "t2" };
    });
    const s = new S3Storage(CONN);
    const l = await s.list("Factory/", 4);
    expect(seen.map((i) => [i.MaxKeys, i.ContinuationToken])).toEqual([[4, undefined], [1, "t1"]]);
    expect(seen[0]).toMatchObject({ Prefix: "Factory/", Delimiter: "/" });
    expect(l.folders).toEqual([
      { name: "annotated", prefix: "Factory/annotated/" },
      { name: "episodes", prefix: "Factory/episodes/" },
    ]);
    expect(l.files.map((f) => f.key)).toEqual(["Factory/README.md", "Factory/a b#.mp4"]);
    expect(l.files[0]).toMatchObject({ size: 204, modified: "2026-01-01T00:00:00.000Z", kind: "markdown" });
    expect(l.truncated).toBe(true);
  });

  it("is not truncated when the last page ends the listing", async () => {
    mockSend(() => ({ Contents: [{ Key: "a.txt", Size: 1 }], IsTruncated: false }));
    const l = await new S3Storage(CONN).list("", 1);
    expect(l).toMatchObject({ prefix: "", truncated: false });
    expect(l.files).toHaveLength(1);
  });

  it("caps pages at 1000 keys and sends no Prefix at the root", async () => {
    const send = mockSend(() => ({ IsTruncated: false }));
    await new S3Storage(CONN).list("", 5000);
    const input = (send.mock.calls[0][0] as ListObjectsV2Command).input;
    expect(input.MaxKeys).toBe(1000);
    expect(input.Prefix).toBeUndefined();
  });

  it("stops on a repeated continuation token", async () => {
    const send = mockSend(() => ({ Contents: [], IsTruncated: true, NextContinuationToken: "same" }));
    const l = await new S3Storage(CONN).list("", 100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(l.truncated).toBe(true);
  });

  it("bounds the number of pages", async () => {
    let n = 0;
    const send = mockSend(() => ({ Contents: [], IsTruncated: true, NextContinuationToken: `t${n++}` }));
    const l = await new S3Storage(CONN).list("", 100);
    expect(send).toHaveBeenCalledTimes(100);
    expect(l.truncated).toBe(true);
  });

  it("propagates AWS errors", async () => {
    mockSend(() => {
      throw awsError("AccessDenied", 403);
    });
    await expect(new S3Storage(CONN).list("", 10)).rejects.toMatchObject({ name: "AccessDenied" });
  });
});

describe("S3Storage.head / readStart", () => {
  it("heads an object", async () => {
    mockSend(() => ({ ContentLength: 5, ContentType: "text/csv", LastModified: new Date(0) }));
    expect(await new S3Storage(CONN).head("a/b.csv")).toMatchObject({ key: "a/b.csv", size: 5, contentType: "text/csv", kind: "table" });
  });

  it("requests only the first bytes and detects truncation from Content-Range", async () => {
    const send = mockSend(() => ({ Body: body("hello"), ContentRange: "bytes 0-4/100" }));
    const r = await new S3Storage(CONN).readStart("k.txt", 5);
    expect((send.mock.calls[0][0] as GetObjectCommand).input.Range).toBe("bytes=0-4");
    expect(r).toEqual({ text: "hello", truncated: true });
  });

  it("is not truncated when the whole object fits", async () => {
    mockSend(() => ({ Body: body("hi"), ContentRange: "bytes 0-1/2" }));
    expect(await new S3Storage(CONN).readStart("k.txt", 100)).toEqual({ text: "hi", truncated: false });
  });

  it("returns empty text for a 0-byte object (S3 answers 416)", async () => {
    mockSend(() => {
      throw awsError("InvalidRange", 416);
    });
    expect(await new S3Storage(CONN).readStart("empty.txt", 100)).toEqual({ text: "", truncated: false });
  });

  it("does not split a UTF-8 character at the cut", async () => {
    const bytes = new TextEncoder().encode("ab€"); // 5 bytes
    mockSend(() => ({ Body: body(bytes.subarray(0, 4)), ContentRange: "bytes 0-3/5" }));
    expect(await new S3Storage(CONN).readStart("k.txt", 4)).toEqual({ text: "ab", truncated: true });
  });

  it("caps the read if the server ignores the range", async () => {
    mockSend(() => ({ Body: body("0123456789") }));
    expect(await new S3Storage(CONN).readStart("k.txt", 4)).toEqual({ text: "0123", truncated: true });
  });

  it("rethrows other errors", async () => {
    mockSend(() => {
      throw awsError("NoSuchKey", 404);
    });
    await expect(new S3Storage(CONN).readStart("k.txt", 4)).rejects.toMatchObject({ name: "NoSuchKey" });
  });
});

describe("S3Storage.signedUrl", () => {
  const q = (url: string) => new URL(url).searchParams;

  it("signs for the bucket region with the connection's expiry", async () => {
    const url = await new S3Storage(CONN).signedUrl("Factory/a b+c#d%.mp4");
    const u = new URL(url);
    expect(u.hostname).toContain("deccan-physical-ai-corpus");
    expect(decodeURIComponent(u.pathname)).toBe("/Factory/a b+c#d%.mp4");
    expect(q(url).get("X-Amz-Expires")).toBe("3600");
    expect(q(url).get("X-Amz-Credential")).toContain("/ap-south-1/s3/");
    expect(q(url).get("response-content-disposition")).toBeNull();
  });

  it("adds an RFC 5987 attachment disposition for downloads", async () => {
    const url = await new S3Storage(CONN).signedUrl("Factory/файл 🤖.json", { download: true, expiresIn: 60 });
    expect(q(url).get("X-Amz-Expires")).toBe("60");
    const cd = q(url).get("response-content-disposition")!;
    expect(cd).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''/);
    expect(decodeURIComponent(cd.split("''")[1])).toBe("файл 🤖.json");
    expect(cd).toMatch(/^[\x20-\x7e]+$/);
  });

  it("serves inline with a content type when asked", async () => {
    const url = await new S3Storage(CONN).signedUrl("doc.pdf", { contentType: "application/pdf" });
    expect(q(url).get("response-content-type")).toBe("application/pdf");
    expect(q(url).get("response-content-disposition")).toBe('inline; filename="doc.pdf"');
  });

  it("clamps expiry to SigV4's 7-day maximum", async () => {
    const url = await new S3Storage(CONN).signedUrl("a", { expiresIn: 10 ** 9 });
    expect(q(url).get("X-Amz-Expires")).toBe("604800");
  });
});

describe("verifyS3", () => {
  const creds = { accessKeyId: CONN.accessKeyId, secretAccessKey: CONN.secretAccessKey, bucket: CONN.bucket };

  it("returns the region HeadBucket reports and confirms listing", async () => {
    const calls: string[] = [];
    mockSend((cmd) => {
      calls.push((cmd as object).constructor.name);
      if (cmd instanceof HeadBucketCommand) return { BucketRegion: "ap-south-1" };
      if (cmd instanceof ListObjectsV2Command) return { Contents: [] };
      throw new Error("unexpected");
    });
    expect(await verifyS3(creds)).toBe("ap-south-1");
    expect(calls).toEqual(["HeadBucketCommand", "ListObjectsV2Command"]);
  });

  it("turns a HeadBucket 404 into NoSuchBucket", async () => {
    mockSend(() => {
      throw awsError("NotFound", 404);
    });
    await expect(verifyS3(creds)).rejects.toMatchObject({ name: "NoSuchBucket" });
  });

  it("uses the region header of a 403 and lets ListObjects report the real error", async () => {
    let listRegion = "";
    mockSend(async function (cmd) {
      if (cmd instanceof HeadBucketCommand) throw awsError("Forbidden", 403, { "x-amz-bucket-region": "eu-central-1" });
      listRegion = await this.config.region();
      throw awsError("InvalidAccessKeyId", 403);
    });
    await expect(verifyS3(creds)).rejects.toMatchObject({ name: "InvalidAccessKeyId" });
    expect(listRegion).toBe("eu-central-1");
  });

  it("falls back to GetBucketLocation when no region is reported", async () => {
    mockSend((cmd) => {
      if (cmd instanceof HeadBucketCommand) throw awsError("Forbidden", 403);
      if (cmd instanceof GetBucketLocationCommand) return { LocationConstraint: "EU" };
      return { Contents: [] };
    });
    expect(await verifyS3(creds)).toBe("eu-west-1");
  });

  it("defaults to us-east-1 when the location is empty or unreadable", async () => {
    mockSend((cmd) => {
      if (cmd instanceof HeadBucketCommand) throw awsError("BadRequest", 400);
      if (cmd instanceof GetBucketLocationCommand) return { LocationConstraint: "" };
      return {};
    });
    expect(await verifyS3(creds)).toBe("us-east-1");

    vi.restoreAllMocks();
    mockSend((cmd) => {
      if (cmd instanceof HeadBucketCommand) throw awsError("Forbidden", 403);
      if (cmd instanceof GetBucketLocationCommand) throw awsError("AccessDenied", 403);
      return {};
    });
    expect(await verifyS3(creds)).toBe("us-east-1");
  });

  it("rethrows network errors without trying further", async () => {
    const send = mockSend(() => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    });
    await expect(verifyS3(creds)).rejects.toMatchObject({ code: "ENOTFOUND" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reuses one client per credentials and region", async () => {
    const clients = new Set<unknown>();
    mockSend(function (cmd) {
      clients.add(this);
      return cmd instanceof HeadObjectCommand ? { ContentLength: 1 } : {};
    });
    await new S3Storage(CONN).head("a");
    await new S3Storage(CONN).head("b");
    expect(clients.size).toBe(1);
    await new S3Storage({ ...CONN, region: "us-west-2" }).head("c");
    expect(clients.size).toBe(2);
  });
});
