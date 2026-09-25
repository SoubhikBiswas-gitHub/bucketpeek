import "server-only";
import type { ByteReader } from "./mp4";

const tooLong = () => Object.assign(new Error("The file sent more bytes than were asked for."), { status: 502, final: true });

// Reads at most `limit` bytes of the body; a server ignoring Range could otherwise send a whole object.
export async function readCapped(res: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (declared > limit) {
    await res.body?.cancel();
    throw tooLong();
  }
  if (!res.body) return new Uint8Array();
  const out = new Uint8Array(limit);
  let filled = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (filled + value.byteLength > limit) {
      await reader.cancel();
      throw tooLong();
    }
    out.set(value, filled);
    filled += value.byteLength;
  }
  return out.subarray(0, filled);
}

// Keep-alive connections are reused between reads, so each read costs one round trip within the region.
export function httpReader(url: string, size: number, signal?: AbortSignal): ByteReader {
  const once = async (offset: number, end: number) => {
    const res = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` }, cache: "no-store", signal });
    if (res.status !== 206 && res.status !== 200) {
      await res.body?.cancel();
      throw Object.assign(new Error(`The file answered ${res.status} to a byte-range read.`), { status: res.status });
    }
    // A 200 is the whole object, usable only when that is what was asked for.
    if (res.status === 200 && offset !== 0) {
      await res.body?.cancel();
      throw tooLong();
    }
    return readCapped(res, end - offset + 1);
  };
  return {
    size,
    async read(offset: number, length: number) {
      const end = Math.min(size, offset + length) - 1;
      if (end < offset) return new Uint8Array();
      // Many parallel reads can meet S3 throttling (503 SlowDown) or a dropped connection; a skipped
      // read would leave a hole in the index, so retry those. Other statuses (403 expired link) won't change.
      for (let attempt = 0; ; attempt++) {
        try {
          return await once(offset, end);
        } catch (e) {
          const { status, final } = e as { status?: number; final?: boolean };
          const retryable = !final && (status === undefined ? !signal?.aborted : status === 429 || status >= 500);
          if (!retryable || attempt >= RETRIES) throw e;
          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
        }
      }
    },
  };
}

const RETRIES = 4;
