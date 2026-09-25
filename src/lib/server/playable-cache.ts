import "server-only";
import { httpReader } from "./http-reader";
import { inspections } from "./limits";
import { log, withLogContext } from "./log";
import { inspectMp4, MAX_FASTSTART_INDEX } from "./mp4";
import { buildPlayable, type VirtualMp4 } from "./playable";

// Rewritten indexes kept in memory, by bucket, key and version; evicted oldest first past the byte cap.
const CACHE_BYTES = 256 * 1024 * 1024;
const g = globalThis as unknown as { __lensPlayable?: Map<string, Promise<VirtualMp4 | null>> };
const cache = (g.__lensPlayable ??= new Map());
const plog = log.child({ scope: "playable" });

// Null when the file needs no fix. Built once per object version and shared by the file and convert routes.
export function playableView(bucket: string, key: string, version: string, source: string, size: number): Promise<VirtualMp4 | null> {
  const id = `${bucket}\n${key}\n${version}`;
  let hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const done = plog.time("playable view", { bucket, key, size });
  hit = inspections
    .run(() =>
      withLogContext({ key }, async () => {
        const reader = httpReader(source, size);
        const layout = await inspectMp4(reader, { maxMoovBytes: MAX_FASTSTART_INDEX });
        if (!layout.indexRead) {
          done({ fix: "none", reason: "index too big to rewrite", moovBytes: layout.moov.size }, "debug");
          return null;
        }
        const view = await buildPlayable(reader, layout);
        if (!view) done({ fix: "none" }, "debug");
        else {
          const { faststart, repair } = view.fixes;
          done({ faststart, shift: repair?.shift, shiftedChunks: repair?.chunks, moovBytes: view.memory });
        }
        return view;
      }),
    )
    .catch((e: unknown) => {
      done({ err: e }, "warn");
      return null;
    });
  cache.set(id, hit);
  void hit.then(async () => {
    let total = 0;
    for (const [k, p] of [...cache.entries()].reverse()) {
      total += (await p)?.memory ?? 0;
      if (total > CACHE_BYTES) cache.delete(k);
    }
  });
  return hit;
}

export const playableUrl = (key: string) => `/api/files/playable?key=${encodeURIComponent(key)}`;
