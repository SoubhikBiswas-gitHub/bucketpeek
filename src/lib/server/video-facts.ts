import "server-only";
import type { StreamDetails, VideoDetails, VideoResult } from "@/lib/file-details";
import type { ByteReader } from "./mp4";
import { mp4Facts } from "./mp4-facts";
import { PROBE_TIMEOUT_MS, probeVideo, type ProbeTarget } from "./probe";

// MP4/MOV/M4V facts come from the file's own boxes in a few range reads; ffprobe still runs alongside and
// adds what only it knows (sample formats, encoder tags…) when it answers in time. Other containers wait
// for ffprobe as before.

// How long an answer waits for ffprobe once the file's own facts are in. ffprobe keeps going for its full
// budget either way and caches what it finds, so the next open gets everything.
export const PROBE_GRACE_MS = 2000;
const MP4_LIKE = /\.(mp4|m4v|mov)$/i;
const CACHE_MAX = 500;

type State = { cache: Map<string, VideoDetails>; inflight: Map<string, Promise<VideoDetails | null>> };
const g = globalThis as unknown as { __lensMp4Facts?: State };
const state: State = (g.__lensMp4Facts ??= { cache: new Map(), inflight: new Map() });

const cacheKey = (t: ProbeTarget) => JSON.stringify([t.bucket, t.key, t.version]);

function remember(id: string, video: VideoDetails): void {
  state.cache.delete(id);
  state.cache.set(id, video);
  while (state.cache.size > CACHE_MAX) state.cache.delete(state.cache.keys().next().value!);
}

const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), ms).unref?.();
  });

// Null when the file isn't one the parser can read; ffprobe then answers alone.
function fastFacts(target: ProbeTarget, reader: () => ByteReader): Promise<VideoDetails | null> {
  const id = cacheKey(target);
  const hit = state.cache.get(id);
  if (hit) {
    remember(id, hit);
    return Promise.resolve(hit);
  }
  let pending = state.inflight.get(id);
  if (!pending) {
    pending = Promise.race([mp4Facts(reader()), after(PROBE_TIMEOUT_MS, null)])
      .then((v) => {
        if (v) remember(id, v);
        return v;
      })
      .catch(() => null)
      .finally(() => state.inflight.delete(id));
    state.inflight.set(id, pending);
  }
  return pending;
}

function mergeStream(probed: StreamDetails, fast: StreamDetails | undefined): StreamDetails {
  if (!fast) return probed;
  const out = { ...probed } as Record<string, unknown>;
  for (const [k, v] of Object.entries(fast)) if (out[k] === null || out[k] === undefined) out[k] = v;
  out.tags = probed.tags.length ? probed.tags : fast.tags;
  return out as unknown as StreamDetails;
}

// ffprobe's values where it has them; the file's own facts fill its gaps.
export function mergeDetails(fast: VideoDetails, probed: VideoDetails): VideoDetails {
  const format = { ...probed.format } as Record<string, unknown>;
  for (const [k, v] of Object.entries(fast.format)) if (format[k] === null || format[k] === undefined) format[k] = v;
  format.tags = probed.format.tags.length ? probed.format.tags : fast.format.tags;
  return {
    format: format as VideoDetails["format"],
    streams: probed.streams.length
      ? probed.streams.map((s) => mergeStream(s, fast.streams.find((f) => f.index === s.index && f.type === s.type)))
      : fast.streams,
  };
}

export interface DescribeOptions {
  // For tests: stands in for ffprobe.
  probe?: typeof probeVideo;
  graceMs?: number;
}

// `reader` reads the object's bytes; `source` makes the URL ffprobe reads. Never throws.
export async function describeVideo(
  target: ProbeTarget,
  reader: () => ByteReader,
  source: () => Promise<string>,
  { probe = probeVideo, graceMs = PROBE_GRACE_MS }: DescribeOptions = {},
): Promise<VideoResult> {
  const started = Date.now();
  const probing = probe(target, source);
  const fast = MP4_LIKE.test(target.key) ? await fastFacts(target, reader) : null;
  if (!fast) {
    const p = await probing;
    return p.status === "ok" ? { ...p, source: "ffprobe" } : p;
  }
  const p = await Promise.race([probing, after(Math.max(0, graceMs - (Date.now() - started)), null)]);
  if (p?.status === "ok") return { status: "ok", video: mergeDetails(fast, p.video), source: "mp4+ffprobe" };
  return { status: "ok", video: fast, source: "mp4" };
}

// For tests.
export function clearFactsCache(): void {
  state.cache.clear();
  state.inflight.clear();
}
