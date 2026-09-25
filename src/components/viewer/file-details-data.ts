import type { DetailPart, DetailPayload, DetailResponses } from "@/lib/file-details";

export type PartResult<P extends DetailPart> =
  | { ok: true; data: DetailResponses[P] }
  | { ok: false; error: { title: string; message: string } };

// One promise per bucket + key + part for the tab's lifetime, so reopening the sheet (and every
// re-render while `use()` reads it) costs no requests. Failures stay until retried.
const MAX_ENTRIES = 200;
const cache = new Map<string, Promise<PartResult<DetailPart>>>();

const idOf = (bucket: string, key: string, part: DetailPart) => JSON.stringify([bucket, key, part]);

async function fetchPart<P extends DetailPart>(key: string, part: P): Promise<PartResult<P>> {
  try {
    const res = await fetch(`/api/files/details?${new URLSearchParams({ key, part })}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as DetailPayload<P> | null;
    if (body && "data" in body) return { ok: true, data: body.data };
    if (body && "error" in body) return { ok: false, error: body.error };
    return { ok: false, error: { title: "Couldn’t load details", message: `The server answered ${res.status}.` } };
  } catch {
    return { ok: false, error: { title: "Couldn’t load details", message: "The request didn’t reach the server. Check your connection." } };
  }
}

export function detailPart<P extends DetailPart>(bucket: string, key: string, part: P): Promise<PartResult<P>> {
  const id = idOf(bucket, key, part);
  let hit = cache.get(id);
  if (!hit) {
    hit = fetchPart(key, part);
    cache.set(id, hit);
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  }
  return hit as Promise<PartResult<P>>;
}

export function forgetPart(bucket: string, key: string, part: DetailPart): void {
  cache.delete(idOf(bucket, key, part));
}
