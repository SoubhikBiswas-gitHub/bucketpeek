import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GetObjectTaggingCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Connection } from "@/lib/types";

const session = vi.hoisted(() => {
  // Keep real saved bucket checks out of the health lookup.
  process.env.LENS_HEALTH_DIR = `${process.env.TMPDIR ?? "/tmp"}/lens-unit-health-${process.pid}`;
  return { connection: null as Connection | null };
});
vi.mock("@/lib/server/session", () => ({ getConnection: async () => session.connection }));

// ffprobe is faked: the unit suite mustn't need ffmpeg installed.
const probe = vi.hoisted(() => ({
  bin: "ffmpeg" as string | null,
  calls: [] as string[][],
  answer: (() => ({ error: null, stdout: "{}" })) as () => { error: unknown; stdout: string; stderr?: string },
}));
vi.mock("@/lib/server/convert", () => ({
  ffmpegPath: async () => probe.bin,
  ffprobeFor: () => "ffprobe",
  INPUT_ARGS: ["-protocol_whitelist", "http,https,tcp,tls"],
}));
vi.mock("node:child_process", () => ({
  execFile: (_bin: string, args: string[], _opts: unknown, cb: (e: unknown, out: string, err: string) => void) => {
    probe.calls.push(args);
    const a = probe.answer();
    setTimeout(() => cb(a.error, a.stdout, a.stderr ?? ""), 0);
  },
}));

import { GET } from "@/app/api/files/details/route";
import { clearProbeCache, videoDetailsFromProbe } from "@/lib/server/probe";
import { objectDetailsFromHead, S3Storage } from "@/lib/server/storage/s3";
import { makeBucket, type TempBucket } from "./helpers/bucket";

const SAMPLE = readFileSync(path.join(__dirname, "samples/ffprobe-episode-0001.json"), "utf8");

const CONNECTION: Connection = {
  accessKeyId: "AKIAFAKEFAKEFAKE12",
  secretAccessKey: "secret",
  bucket: "deccan-physical-ai-corpus",
  region: "ap-south-1",
};
const ORIGIN = "http://127.0.0.1:3203";

let bucket: TempBucket;
let prevMockDir: string | undefined;
const SIDECAR = { episode: "A36", "Data Info": { duration_sec: 8, fps: 30 } };

beforeAll(() => {
  bucket = makeBucket({
    "ep/A36_002.mp4": "not really a video",
    "ep/A36_002_METADATA.json": JSON.stringify(SIDECAR),
    "ep/zero.mp4": "",
    "ep/bad.mp4": "x",
    "ep/bad_METADATA.json": "{ nope",
    "ep/big.mp4": "x",
    "ep/big_METADATA.json": JSON.stringify({ blob: "x".repeat(70 * 1024) }),
    "ep/notes.txt": "hi",
  });
  prevMockDir = process.env.LENS_MOCK_DIR;
  process.env.LENS_MOCK_DIR = bucket.root;
});
afterAll(() => {
  if (prevMockDir === undefined) delete process.env.LENS_MOCK_DIR;
  else process.env.LENS_MOCK_DIR = prevMockDir;
  bucket.cleanup();
});
beforeEach(() => {
  session.connection = CONNECTION;
  probe.bin = "ffmpeg";
  probe.calls = [];
  probe.answer = () => ({ error: null, stdout: SAMPLE });
  clearProbeCache();
});

const get = async (key: string, part: string) => {
  const r = await GET(new Request(`${ORIGIN}/api/files/details?${new URLSearchParams({ key, part })}`));
  return { status: r.status, body: await r.json() };
};

describe("ffprobe JSON → video details", () => {
  it("maps the recorded fixture probe", () => {
    const v = videoDetailsFromProbe(JSON.parse(SAMPLE));
    expect(v.format).toEqual({
      name: "mov,mp4,m4a,3gp,3g2,mj2",
      longName: "QuickTime / MOV",
      duration: 8,
      bitRate: 2927613,
      startTime: 0,
      streams: 2,
      tags: [
        { key: "major_brand", value: "isom" },
        { key: "minor_version", value: "512" },
        { key: "compatible_brands", value: "isomiso2avc1mp41" },
        { key: "encoder", value: "Lavf63.1.101" },
      ],
    });
    const [video, audio] = v.streams;
    expect(video).toMatchObject({
      index: 0,
      type: "video",
      codec: "h264",
      codecString: "avc1.64001f",
      codecTag: "avc1",
      profile: "High",
      level: "3.1",
      width: 1280,
      height: 720,
      displayAspectRatio: "16:9",
      frameRate: "30/1",
      pixelFormat: "yuv420p",
      bitDepth: 8,
      fieldOrder: "progressive",
      bitRate: 2790315,
      rotation: null,
      duration: 8,
      frames: 240,
      language: null,
    });
    expect(video.tags).toContainEqual({ key: "encoder", value: "Lavc63.1.101 libx264" });
    expect(audio).toMatchObject({
      type: "audio",
      codec: "aac",
      profile: "LC",
      sampleRate: 48000,
      channels: 1,
      channelLayout: "mono",
      sampleFormat: "fltp",
      bitRate: 127001,
      frameRate: null,
      width: null,
    });
  });

  it("reads rotation, HEVC levels and missing values", () => {
    const v = videoDetailsFromProbe({
      format: { format_name: "mov,mp4", duration: "N/A", tags: { creation_time: "2026-05-01T10:00:00.000000Z" } },
      streams: [
        {
          codec_type: "video",
          codec_name: "hevc",
          level: 153,
          width: 3840,
          height: 2160,
          r_frame_rate: "30000/1001",
          avg_frame_rate: "0/0",
          bit_rate: "N/A",
          side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
          tags: { language: "eng" },
        },
        { codec_type: "video", codec_name: "h264", tags: { rotate: "180" } },
      ],
    });
    expect(v.format.duration).toBeNull();
    expect(v.format.tags).toEqual([{ key: "creation_time", value: "2026-05-01T10:00:00.000000Z" }]);
    expect(v.streams[0]).toMatchObject({ index: 0, level: "5.1", rotation: -90, frameRate: "30000/1001", avgFrameRate: null, bitRate: null, language: "eng" });
    expect(v.streams[1]).toMatchObject({ index: 1, rotation: 180, level: null });
  });
});

describe("GET /api/files/details", () => {
  it("needs a connection, a key and a known part", async () => {
    session.connection = null;
    expect((await get("ep/A36_002.mp4", "s3")).status).toBe(401);
    session.connection = CONNECTION;
    expect((await get("", "s3")).status).toBe(400);
    expect((await get("ep/", "s3")).status).toBe(400);
    const bad = await get("ep/A36_002.mp4", "everything");
    expect(bad.status).toBe(400);
    expect(bad.body.error.title).toBe("Unknown part");
  });

  it("answers 404 for a missing file", async () => {
    const r = await get("ep/gone.mp4", "s3");
    expect(r.status).toBe(404);
    expect(r.body.error.title).toBe("File not found");
  });

  it("returns empty S3 facts for local files", async () => {
    const r = await get("ep/A36_002.mp4", "s3");
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ etag: null, storageClass: null, versionId: null, checksums: [], metadata: [], tags: null });
  });

  it("probes a video once per version and caches it", async () => {
    const a = await get("ep/A36_002.mp4", "video");
    expect(a.body.data.status).toBe("ok");
    expect(a.body.data.video.streams[0]).toMatchObject({ codec: "h264", width: 1280, height: 720 });
    await get("ep/A36_002.mp4", "video");
    expect(probe.calls).toHaveLength(1);
    const args = probe.calls[0];
    // The source is a signed link on this app (mock mode), read under the input whitelist.
    expect(args).toContain("-protocol_whitelist");
    expect(args.at(-1)).toMatch(/^http:\/\/127\.0\.0\.1:3203\/api\/mock\?key=ep%2FA36_002\.mp4&/);
  });

  it("says unavailable instead of failing when ffprobe can't help", async () => {
    probe.bin = null;
    expect((await get("ep/A36_002.mp4", "video")).body.data).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/ffmpeg isn’t installed/) });

    probe.bin = "ffmpeg";
    probe.answer = () => ({ error: Object.assign(new Error("killed"), { killed: true, signal: "SIGKILL" }), stdout: "" });
    expect((await get("ep/A36_002.mp4", "video")).body.data).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/longer than 10 seconds/) });

    probe.answer = () => ({ error: Object.assign(new Error("spawn"), { code: "ENOENT" }), stdout: "" });
    expect((await get("ep/A36_002.mp4", "video")).body.data).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/ffprobe isn’t installed/) });

    probe.answer = () => ({ error: Object.assign(new Error("exit 1"), { code: 1 }), stdout: "", stderr: "moov atom not found\n" });
    expect((await get("ep/A36_002.mp4", "video")).body.data).toMatchObject({ reason: expect.stringMatching(/moov atom not found/) });

    // Failures aren't cached: the next open tries again.
    probe.answer = () => ({ error: null, stdout: SAMPLE });
    expect((await get("ep/A36_002.mp4", "video")).body.data.status).toBe("ok");
  });

  it("doesn't probe empty files or non-videos", async () => {
    expect((await get("ep/zero.mp4", "video")).body.data).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/empty/) });
    expect((await get("ep/notes.txt", "video")).body.data).toEqual({ status: "not-video" });
    expect(probe.calls).toHaveLength(0);
  });

  it("reads the sidecar metadata file", async () => {
    expect((await get("ep/A36_002.mp4", "sidecar")).body.data).toEqual({
      status: "ok",
      key: "ep/A36_002_METADATA.json",
      size: JSON.stringify(SIDECAR).length,
      data: SIDECAR,
    });
    expect((await get("ep/notes.txt", "sidecar")).body.data).toEqual({ status: "none", key: "ep/notes_METADATA.json" });
    expect((await get("ep/A36_002_METADATA.json", "sidecar")).body.data).toEqual({ status: "none", key: null });
    expect((await get("ep/bad.mp4", "sidecar")).body.data).toMatchObject({ status: "invalid", key: "ep/bad_METADATA.json" });
    expect((await get("ep/big.mp4", "sidecar")).body.data).toMatchObject({ status: "too-big", key: "ep/big_METADATA.json" });
  });

  it("reports the file's line in the bucket check", async () => {
    expect((await get("ep/A36_002.mp4", "health")).body.data).toEqual({ status: "none" });
  });
});

describe("S3 object details", () => {
  const CONN = { ...CONNECTION, accessKeyId: "AKIAIOSFODNN7EXAMPLE" };

  it("maps HeadObject", () => {
    const d = objectDetailsFromHead(
      {
        $metadata: {},
        ETag: '"d41d8cd98f00b204e9800998ecf8427e-12"',
        VersionId: "3HL4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: "arn:aws:kms:ap-south-1:111122223333:key/abcd",
        BucketKeyEnabled: true,
        ChecksumCRC64NVME: "AAAAAAAAAAA=",
        ChecksumType: "FULL_OBJECT",
        Metadata: { "source-camera": "cam3", episode: "A36" },
        CacheControl: "max-age=60",
      },
      { status: "ok", tags: [] },
    );
    expect(d).toMatchObject({
      etag: '"d41d8cd98f00b204e9800998ecf8427e-12"',
      multipartParts: 12,
      storageClass: "STANDARD",
      versionId: "3HL4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY",
      serverSideEncryption: "aws:kms",
      kmsKeyId: "arn:aws:kms:ap-south-1:111122223333:key/abcd",
      bucketKeyEnabled: true,
      checksums: [{ algorithm: "CRC64NVME", value: "AAAAAAAAAAA=" }],
      checksumType: "FULL_OBJECT",
      metadata: [
        { key: "episode", value: "A36" },
        { key: "source-camera", value: "cam3" },
      ],
      cacheControl: "max-age=60",
      contentEncoding: null,
    });
    // An unversioned bucket's objects report "null".
    expect(objectDetailsFromHead({ $metadata: {}, VersionId: "null", StorageClass: "GLACIER_IR" }, null)).toMatchObject({
      versionId: null,
      storageClass: "GLACIER_IR",
      multipartParts: null,
    });
  });

  it("asks for checksums and reports denied tagging instead of failing", async () => {
    const seen: unknown[] = [];
    vi.spyOn(S3Client.prototype, "send").mockImplementation((async (cmd: unknown) => {
      seen.push(cmd);
      if (cmd instanceof HeadObjectCommand) return { $metadata: {}, ETag: '"abc"', StorageClass: "INTELLIGENT_TIERING" };
      if (cmd instanceof GetObjectTaggingCommand) {
        throw Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
      }
      throw new Error("unexpected command");
    }) as never);
    const d = await new S3Storage(CONN).details("Factory/a.mp4");
    expect(d).toMatchObject({ etag: '"abc"', storageClass: "INTELLIGENT_TIERING", tags: { status: "denied" } });
    expect(seen).toHaveLength(2);
    expect((seen.find((c) => c instanceof HeadObjectCommand) as HeadObjectCommand).input).toMatchObject({ ChecksumMode: "ENABLED" });
  });

  it("returns tags and retries HEAD without checksums when KMS forbids them", async () => {
    let heads = 0;
    vi.spyOn(S3Client.prototype, "send").mockImplementation((async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) {
        heads++;
        if (cmd.input.ChecksumMode) throw Object.assign(new Error("Forbidden"), { name: "403", $metadata: { httpStatusCode: 403 } });
        return { $metadata: {}, ETag: '"abc"' };
      }
      return { TagSet: [{ Key: "project", Value: "A36" }] };
    }) as never);
    const d = await new S3Storage(CONN).details("Factory/a.mp4");
    expect(heads).toBe(2);
    expect(d.tags).toEqual({ status: "ok", tags: [{ key: "project", value: "A36" }] });
  });

  it("throws for a missing object", async () => {
    vi.spyOn(S3Client.prototype, "send").mockImplementation((async (cmd: unknown) => {
      throw Object.assign(new Error("NotFound"), {
        name: cmd instanceof HeadObjectCommand ? "NotFound" : "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      });
    }) as never);
    await expect(new S3Storage(CONN).details("nope")).rejects.toMatchObject({ name: "NotFound" });
  });
});
