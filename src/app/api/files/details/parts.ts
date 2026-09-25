import "server-only";
import { sourceUrl } from "@/app/api/convert/source";
import {
  SIDECAR_MAX_BYTES,
  sidecarKey,
  type DetailPart,
  type DetailResponses,
  type SidecarResult,
  type VideoResult,
} from "@/lib/file-details";
import { describeError, isNotFound } from "@/lib/server/errors";
import { fileHealth } from "@/lib/server/health";
import type { ByteReader } from "@/lib/server/mp4";
import { storageFor, type Storage } from "@/lib/server/storage";
import { describeVideo } from "@/lib/server/video-facts";
import type { Connection } from "@/lib/types";

// S3 requests per part: s3 = HEAD + GetObjectTagging; video = HEAD + a few ranged GETs of an MP4's own
// boxes + ffprobe's range GETs (none when cached); health = none (a file on this server); sidecar = HEAD,
// + one ranged GET when it exists.
export async function loadPart(part: DetailPart, connection: Connection, key: string, origin: string): Promise<DetailResponses[DetailPart]> {
  const storage = storageFor(connection);
  switch (part) {
    case "s3":
      return storage.details(key);
    case "health":
      return fileHealth(connection, key);
    case "video":
      return videoPart(storage, connection, key, origin);
    case "sidecar":
      return sidecarPart(storage, key);
  }
}

async function videoPart(storage: Storage, connection: Connection, key: string, origin: string): Promise<VideoResult> {
  const file = await storage.head(key);
  if (file.kind !== "video") return { status: "not-video" };
  if (file.size === 0) return { status: "unavailable", reason: "The file is empty (0 bytes)." };
  const reader = (): ByteReader => ({
    size: file.size,
    read: async (offset, length) => (offset < file.size && length > 0 ? storage.readBytes(key, offset, length) : new Uint8Array()),
  });
  return describeVideo({ bucket: connection.bucket, key, version: `${file.size}:${file.modified ?? ""}` }, reader, () =>
    sourceUrl(connection, key, origin),
  );
}

export async function sidecarPart(storage: Storage, key: string): Promise<SidecarResult> {
  const sk = sidecarKey(key);
  if (!sk) return { status: "none", key: null };
  let size: number;
  try {
    size = (await storage.head(sk)).size;
  } catch (e) {
    if (isNotFound(e)) return { status: "none", key: sk };
    return { status: "error", key: sk, message: describeError(e).message };
  }
  if (size > SIDECAR_MAX_BYTES) return { status: "too-big", key: sk, size };
  let text: string;
  try {
    ({ text } = await storage.readStart(sk, SIDECAR_MAX_BYTES));
  } catch (e) {
    return { status: "error", key: sk, message: describeError(e).message };
  }
  try {
    return { status: "ok", key: sk, size, data: JSON.parse(text.replace(/^﻿/, "")) };
  } catch (e) {
    return { status: "invalid", key: sk, size, message: e instanceof Error ? e.message : "Not valid JSON." };
  }
}
