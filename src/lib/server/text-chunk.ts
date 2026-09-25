import "server-only";
import type { TextChunk } from "@/lib/types";
import type { Storage } from "./storage";

const isContinuation = (b: number) => (b & 0xc0) === 0x80;

// Never splits a character: a start inside one moves forward, one begun inside the window is finished.
// `offset`/`nextOffset` in the result are exact byte positions, so chunks join seamlessly.
export async function readTextChunk(storage: Storage, key: string, offset: number, length: number): Promise<TextChunk> {
  const { size: total } = await storage.head(key);
  if (offset >= total) return { text: "", offset: Math.min(offset, total), nextOffset: null, total };

  // 3 extra bytes on each side are enough to realign to character boundaries.
  const bytes = await storage.readBytes(key, offset, length + 6);
  let start = 0;
  if (offset > 0) while (start < 3 && start < bytes.length && isContinuation(bytes[start])) start++;
  let end = Math.min(bytes.length, start + length);
  while (end < bytes.length && end - start < length + 3 && isContinuation(bytes[end])) end++;

  const text = new TextDecoder("utf-8", { ignoreBOM: offset + start > 0 }).decode(bytes.subarray(start, end));
  const endOffset = offset + end;
  return { text, offset: offset + start, nextOffset: endOffset >= total ? null : endOffset, total };
}
