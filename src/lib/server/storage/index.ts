import "server-only";
import type { Connection } from "@/lib/types";
import { LocalStorage, mockRoot } from "./local";
import { S3Storage, verifyS3 } from "./s3";
import type { Storage } from "./types";

export type { Storage } from "./types";
export { MAX_LIST_ITEMS } from "./types";

export function isMockMode(): boolean {
  return mockRoot() !== null;
}

export function storageFor(c: Connection): Storage {
  const root = mockRoot();
  return root ? new LocalStorage(root) : new S3Storage(c);
}

/** Checks credentials and returns the bucket region. */
export async function verifyConnection(c: Pick<Connection, "accessKeyId" | "secretAccessKey" | "bucket">): Promise<string> {
  if (isMockMode()) return "ap-south-1";
  return verifyS3(c);
}
