import "server-only";
import { inspections } from "./limits";
import { log } from "./log";
import { topLevel, type ByteReader, type Mp4Layout, type TrackDefaults } from "./mp4";

// Each HLS segment is a byte range of the original starting at a keyframe fragment, so the player fetches
// only the fragments it plays instead of walking every fragment header first as browsers do.

export interface Segment {
  // Byte range [offset, offset + size) of the original file.
  offset: number;
  size: number;
  // Seconds.
  time: number;
  duration: number;
}

export interface FragmentIndex {
  // `ftyp` + `moov`: bytes [0, initSize).
  initSize: number;
  segments: Segment[];
  // False while a walk is still finding fragments; the playlist is then an EVENT playlist that grows.
  complete: boolean;
}

// Fragments are merged into segments of at least this many seconds: fewer requests, same seeking.
export const MIN_SEGMENT_SECONDS = 2;
// Without an index, regions are walked in parallel: each walk starts at the region's first moof and stops at
// the first fragment at or after the next region's start, exactly where that region's walk begins.
const REGION_BYTES = 256 * 1024 * 1024;
const FIRST_REGION_BYTES = 16 * 1024 * 1024;
const MAX_REGIONS = 64;
const SCAN_WINDOW = 256 * 1024;
const WALK_CONCURRENCY = 64;
// A moof and the header of the mdat after it almost always fit in one read of this size.
const FRAGMENT_READ = 4 * 1024;
const NON_SYNC = 0x10000;
// Largest moof or mfra read in one piece; real ones are kilobytes.
const MAX_BOX_READ = 16 * 1024 * 1024;
// Segments are buffered whole to rewrite their moofs; a file with bigger ones is converted instead.
export const MAX_SEGMENT_BYTES = 64 * 1024 * 1024;

export class FragmentsTooLarge extends Error {
  constructor() {
    super("This file's fragments are too large to stream as they are.");
    this.name = "FragmentsTooLarge";
  }
}

const oversized = (segments: Segment[]) => segments.findIndex((s) => s.size > MAX_SEGMENT_BYTES);

// The playlist ends before the first segment too large to serve.
function capped(index: FragmentIndex): FragmentIndex {
  const i = oversized(index.segments);
  return i < 0 ? index : { ...index, segments: index.segments.slice(0, i), complete: true };
}

const text = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

interface FragmentInfo {
  offset: number;
  // Where the next top-level box starts.
  end: number;
  // Video timing in this fragment, if it holds video.
  time?: number;
  duration?: number;
  sync?: boolean;
}

export function parseMoof(bytes: Uint8Array, videoId: number, timescale: number, defaults: TrackDefaults | undefined): Pick<FragmentInfo, "time" | "duration" | "sync"> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at);
  const out: Pick<FragmentInfo, "time" | "duration" | "sync"> = {};
  const walk = (from: number, to: number, inTraf: { id: number; dur: number; flags: number } | null) => {
    let at = from;
    while (at + 8 <= to) {
      let size = u32(at);
      const type = text(bytes, at + 4);
      let header = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      }
      if (size < header || at + size > to) return;
      const p = at + header;
      if (type === "traf") {
        const state = { id: -1, dur: defaults?.duration ?? 0, flags: defaults?.flags ?? 0 };
        walk(p, at + size, state);
      } else if (inTraf) {
        if (type === "tfhd") {
          const flags = u32(p) & 0xffffff;
          inTraf.id = u32(p + 4);
          let q = p + 8;
          if (flags & 0x1) q += 8; // base data offset
          if (flags & 0x2) q += 4; // sample description index
          if (flags & 0x8) {
            inTraf.dur = u32(q);
            q += 4;
          }
          if (flags & 0x10) q += 4; // default sample size
          if (flags & 0x20) inTraf.flags = u32(q);
        } else if (inTraf.id === videoId && type === "tfdt") {
          const base = bytes[p] === 1 ? Number(view.getBigUint64(p + 4)) : u32(p + 4);
          out.time = base / timescale;
        } else if (inTraf.id === videoId && type === "trun") {
          const flags = u32(p) & 0xffffff;
          const count = u32(p + 4);
          let q = p + 8;
          if (flags & 0x1) q += 4; // data offset
          let firstFlags: number | undefined;
          if (flags & 0x4) {
            firstFlags = u32(q);
            q += 4;
          }
          const per = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
          let total = 0;
          for (let i = 0; i < count && q + per <= at + size; i++, q += per) {
            let r = q;
            const d = flags & 0x100 ? u32(r) : inTraf.dur;
            if (flags & 0x100) r += 4;
            if (flags & 0x200) r += 4;
            if (i === 0 && firstFlags === undefined) firstFlags = flags & 0x400 ? u32(r) : inTraf.flags;
            total += d;
          }
          if (count > 0 && per === 0) total = count * inTraf.dur;
          out.duration = (out.duration ?? 0) + total / timescale;
          out.sync ??= !((firstFlags ?? inTraf.flags) & NON_SYNC);
        }
      }
      at += size;
    }
  };
  // Given the whole moof, step inside its header to the trafs.
  walk(bytes.byteLength >= 8 && text(bytes, 4) === "moof" ? 8 : 0, bytes.byteLength, null);
  return out;
}

// Groups fragments into segments that start at a keyframe fragment and last at least MIN_SEGMENT_SECONDS.
export function segmentsFrom(fragments: FragmentInfo[], complete: boolean): Segment[] {
  const out: Segment[] = [];
  let current: Segment | null = null;
  for (const f of fragments) {
    const startsHere = f.time !== undefined && f.sync !== false && (!current || f.time - current.time >= MIN_SEGMENT_SECONDS);
    if (startsHere || !current) {
      if (current) out.push(current);
      current = { offset: f.offset, size: f.end - f.offset, time: f.time ?? 0, duration: f.duration ?? 0 };
    } else {
      current.size = f.end - current.offset;
      current.duration += f.duration ?? 0;
    }
  }
  // While walking, the last segment may still grow; only publish it once the walk is done.
  if (current && complete) out.push(current);
  // Durations from timestamps where known: robust to fragments that carry only audio.
  for (let i = 0; i + 1 < out.length; i++) {
    const gap = out[i + 1].time - out[i].time;
    if (gap > 0) out[i].duration = gap;
  }
  return out;
}

// Fragment offsets and keyframe times from the `mfra` index at the end of the file, if present.
async function fromMfra(r: ByteReader, videoId: number, timescale: number, duration: number): Promise<Segment[] | null> {
  if (r.size < 16) return null;
  const tail = await r.read(r.size - 16, 16);
  if (tail.byteLength < 16 || text(tail, 4) !== "mfro") return null;
  const mfraSize = new DataView(tail.buffer, tail.byteOffset, 16).getUint32(12);
  if (mfraSize < 16 || mfraSize > r.size || mfraSize > MAX_BOX_READ) return null;
  const mfraStart = r.size - mfraSize;
  const bytes = await r.read(mfraStart, mfraSize);
  if (text(bytes, 4) !== "mfra") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const entries: { time: number; offset: number }[] = [];
  let at = 8;
  while (at + 8 <= bytes.byteLength) {
    const size = view.getUint32(at);
    if (size < 8) break;
    if (text(bytes, at + 4) === "tfra") {
      const p = at + 8;
      const version = bytes[p];
      const track = view.getUint32(p + 4);
      const lengths = view.getUint32(p + 8);
      const extra = ((lengths >> 4) & 3) + 1 + ((lengths >> 2) & 3) + 1 + (lengths & 3) + 1;
      const n = view.getUint32(p + 12);
      if (track === videoId) {
        let q = p + 16;
        for (let i = 0; i < n && q < at + size; i++) {
          const time = version === 1 ? Number(view.getBigUint64(q)) : view.getUint32(q);
          const offset = version === 1 ? Number(view.getBigUint64(q + 8)) : view.getUint32(q + 4);
          entries.push({ time: time / timescale, offset });
          q += (version === 1 ? 16 : 8) + extra;
        }
      }
    }
    at += size;
  }
  if (entries.length === 0) return null;

  entries.sort((a, b) => a.offset - b.offset);
  const starts: { time: number; offset: number }[] = [];
  for (const e of entries) {
    if (!starts.length || e.time - starts[starts.length - 1].time >= MIN_SEGMENT_SECONDS) starts.push(e);
  }
  return starts.map((s, i) => {
    const next = starts[i + 1];
    const end = next ? next.offset : mfraStart;
    const d = (next ? next.time : duration) - s.time;
    return { offset: s.offset, size: end - s.offset, time: s.time, duration: d > 0 ? d : MIN_SEGMENT_SECONDS };
  });
}

// A moof is its size, "moof", then a 16-byte "mfhd". Media data could contain those bytes by chance, so the
// moof must also be followed by an "mdat" when that is within reach.
function findMoof(bytes: Uint8Array, base: number): { at: number; size: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 4; i + 16 <= bytes.byteLength; i++) {
    if (bytes[i] !== 0x6d || text(bytes, i) !== "moof") continue;
    const size = view.getUint32(i - 4);
    if (size < 24 || size > MAX_BOX_READ) continue;
    if (view.getUint32(i + 4) !== 16 || text(bytes, i + 8) !== "mfhd") continue;
    const after = i - 4 + size;
    if (after + 8 <= bytes.byteLength && text(bytes, after + 4) !== "mdat" && text(bytes, after + 4) !== "moof") continue;
    return { at: base + i - 4, size };
  }
  return null;
}

async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
}

// Reads a moof, or another top-level box, in one read. Null past the end or at the trailing mfra index.
async function readFragment(
  r: ByteReader,
  at: number,
  videoId: number,
  timescale: number,
  defaults: TrackDefaults | undefined,
): Promise<{ fragment: FragmentInfo | null; next: number } | null> {
  if (at + 8 > r.size) return null;
  let bytes = await r.read(at, Math.min(FRAGMENT_READ, r.size - at));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = view.getUint32(0);
  const type = text(bytes, 4);
  if (size === 1) size = Number(view.getBigUint64(8));
  else if (size === 0) size = r.size - at;
  if (size < 8 || type === "mfra") return null;
  if (type !== "moof") return { fragment: null, next: at + size };
  if (bytes.byteLength < size) {
    if (size > MAX_BOX_READ) throw new FragmentsTooLarge();
    bytes = await r.read(at, size);
  }
  const info = parseMoof(bytes.subarray(0, size), videoId, timescale, defaults);
  // The mdat right after the moof holds its samples.
  let end = at + size;
  const after = size + 8 <= bytes.byteLength ? bytes.subarray(size, size + 16) : await r.read(end, 16);
  if (after.byteLength >= 8 && text(after, 4) === "mdat") {
    const av = new DataView(after.buffer, after.byteOffset, after.byteLength);
    let mdatSize = av.getUint32(0);
    if (mdatSize === 1 && after.byteLength >= 16) mdatSize = Number(av.getBigUint64(8));
    else if (mdatSize === 0) mdatSize = r.size - end;
    end += mdatSize;
  }
  return { fragment: { offset: at, end, ...info }, next: end };
}

async function walkBetween(
  r: ByteReader,
  from: number,
  until: number,
  videoId: number,
  timescale: number,
  defaults: TrackDefaults | undefined,
  signal?: AbortSignal,
): Promise<FragmentInfo[]> {
  const out: FragmentInfo[] = [];
  let at = from;
  while (at < until && !signal?.aborted) {
    const step = await readFragment(r, at, videoId, timescale, defaults).catch(() => null);
    if (!step) break;
    if (step.fragment) out.push(step.fragment);
    at = step.next;
  }
  return out;
}

// The first regions are small and double in size, so the start of the video (where playback begins) is
// indexed within a second; the rest are equal, at most MAX_REGIONS in all.
export function regionStarts(from: number, size: number): number[] {
  const starts: number[] = [];
  let at = from;
  for (let len = FIRST_REGION_BYTES; len < REGION_BYTES && at < size && starts.length < MAX_REGIONS / 2; len *= 2) {
    starts.push(at);
    at += len;
  }
  if (at >= size) return starts.length ? starts : [from];
  const rest = Math.min(MAX_REGIONS - starts.length, Math.max(1, Math.ceil((size - at) / REGION_BYTES)));
  const span = (size - at) / rest;
  for (let i = 0; i < rest; i++) starts.push(Math.floor(at + i * span));
  return starts;
}

async function firstMoofFrom(r: ByteReader, from: number, until: number, signal?: AbortSignal): Promise<number | null> {
  // Windows overlap so a moof header straddling two of them is still found.
  for (let at = from; at < until && !signal?.aborted; at += SCAN_WINDOW - 32) {
    const bytes = await r.read(at, Math.min(SCAN_WINDOW, r.size - at)).catch(() => null);
    if (!bytes) return null;
    const hit = findMoof(bytes, at);
    if (hit) return hit.at < until ? hit.at : null;
    if (bytes.byteLength < SCAN_WINDOW) return null;
  }
  return null;
}

// Resolves as soon as the first segments are known; without an `mfra`, the walk continues in the background
// and `onUpdate` is called as it finds more (with `complete` set at the end).
const flog = log.child({ scope: "fmp4" });

export async function indexFragments(
  r: ByteReader,
  layout: Mp4Layout,
  onUpdate: (index: FragmentIndex) => void,
  { firstSeconds = 6, signal }: { firstSeconds?: number; signal?: AbortSignal } = {},
): Promise<FragmentIndex> {
  const video = layout.tracks.find((t) => t.kind === "video");
  if (!video) throw new Error("No video track in this fragmented file.");
  const initSize = layout.moov.offset + layout.moov.size;
  const defaults = layout.mvex.defaults.get(video.id);
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);

  const fromIndex = await fromMfra(r, video.id, video.timescale, layout.duration).catch(() => null);
  if (fromIndex && fromIndex.length > 0) {
    if (oversized(fromIndex) >= 0) throw new FragmentsTooLarge();
    const index = { initSize, segments: fromIndex, complete: true };
    flog.debug("fragments indexed", { source: "mfra", segments: fromIndex.length, ms: ms() });
    onUpdate(index);
    return index;
  }

  // Walk the start of the file: each read covers a moof and the header of the mdat after it.
  const fragments: FragmentInfo[] = [];
  let at = initSize;
  const step = async (): Promise<boolean> => {
    const next = await readFragment(r, at, video.id, video.timescale, defaults);
    if (!next) return false;
    if (next.fragment) fragments.push(next.fragment);
    // Anything that isn't a moof (a stray mdat, free, sidx…) belongs to the fragment before it.
    else if (fragments.length) fragments[fragments.length - 1].end = next.next;
    at = next.next;
    return true;
  };

  const publish = (complete: boolean) => {
    const index = { initSize, segments: segmentsFrom(fragments, complete), complete };
    if (oversized(index.segments) >= 0) throw new FragmentsTooLarge();
    onUpdate(index);
    return index;
  };

  // First the start of the video, so playback can begin; then the rest in the background.
  while (!signal?.aborted) {
    const known = fragments.reduce((s, f) => s + (f.duration ?? 0), 0);
    if (known >= firstSeconds) break;
    if (!(await step())) {
      const whole = publish(true);
      flog.debug("fragments indexed", { source: "walk", segments: whole.segments.length, complete: true, ms: ms() });
      return whole;
    }
  }
  const first = publish(false);
  flog.debug("fragments indexed", { source: "walk", segments: first.segments.length, complete: false, ms: ms() });
  // The rest of the file: walk regions in parallel rather than thousands of fragments one by one.
  let ended = false;
  const finish = (index: FragmentIndex) => {
    if (ended || signal?.aborted) return;
    ended = index.complete;
    onUpdate(index);
  };
  void inspections.run(async () => {
    if (signal?.aborted) return;
    try {
      const walkedTo = at;
      const bounds = regionStarts(walkedTo, r.size);
      const regions = bounds.length;

      // Regions finish roughly in order; publish the contiguous start so playback can go on meanwhile.
      const stretches: (FragmentInfo[] | undefined)[] = new Array(regions);
      let ready = 0;
      const withEnds = (list: FragmentInfo[], last: number) => {
        // Each fragment's bytes run to the next known one (stray boxes included).
        for (let i = 0; i < list.length; i++) list[i].end = i + 1 < list.length ? list[i + 1].offset : last;
        return list;
      };
      await pool(
        bounds.map((b, i) => async () => {
          const until = bounds[i + 1] ?? r.size;
          const from = i === 0 ? walkedTo : await firstMoofFrom(r, b, until, signal);
          stretches[i] = from === null ? [] : await walkBetween(r, from, until, video.id, video.timescale, defaults, signal);
          if (signal?.aborted || ended || ready !== i) return;
          while (ready < regions && stretches[ready]) ready++;
          if (ready < regions) {
            const prefix = withEnds([...fragments, ...stretches.slice(0, ready).flatMap((x) => x ?? [])], bounds[ready]);
            finish(capped({ initSize, segments: segmentsFrom(prefix, false), complete: false }));
          }
        }),
        WALK_CONCURRENCY,
      );
      const all = withEnds([...fragments, ...stretches.flatMap((x) => x ?? [])], r.size);
      const index = capped({ initSize, segments: segmentsFrom(all, true), complete: true });
      flog.debug("fragment walk done", { source: "walk", segments: index.segments.length, regions, aborted: signal?.aborted === true, ms: ms() });
      finish(index);
    } catch (e) {
      flog.warn("fragment walk failed", { segments: first.segments.length, ms: ms(), err: e });
      // Keep what the first walk found; the playlist then ends there.
      finish(capped({ initSize, segments: segmentsFrom(fragments, true), complete: true }));
    }
  });
  return first;
}

const TFHD_BASE_DATA_OFFSET = 0x1;
const TFHD_DEFAULT_BASE_IS_MOOF = 0x20000;
const TRUN_DATA_OFFSET = 0x1;

interface Box {
  at: number;
  size: number;
  type: string;
}

function childBoxes(bytes: Uint8Array, view: DataView, from: number, to: number): Box[] | null {
  const out: Box[] = [];
  for (let at = from; at + 8 <= to; ) {
    const size = view.getUint32(at);
    // 64-bit or open-ended sizes never occur inside a moof; refuse rather than misparse.
    if (size < 8 || at + size > to) return null;
    out.push({ at, size, type: text(bytes, at + 4) });
    at += size;
  }
  return out;
}

// MSE (and HLS, RFC 8216 3.3) accept only moof-relative data offsets; recorders often write absolute ones
// (tfhd base-data-offset). `moofAt` is the moof's file offset. Null when it can't be rewritten safely.
function relativeMoof(bytes: Uint8Array, moofAt: number): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const children = childBoxes(bytes, view, 8, bytes.byteLength);
  if (!children) return null;
  const kids = new Map<Box, Box[]>();
  let withBase = 0;
  for (const c of children) {
    if (c.type !== "traf") continue;
    const k = childBoxes(bytes, view, c.at + 8, c.at + c.size);
    const tfhd = k?.find((b) => b.type === "tfhd");
    // Chrome needs a tfdt in every traf; saio (encryption) offsets would need shifting too.
    if (!k || !tfhd || !k.some((b) => b.type === "tfdt") || k.some((b) => b.type === "saio")) return null;
    if (view.getUint32(tfhd.at + 8) & TFHD_BASE_DATA_OFFSET) withBase++;
    kids.set(c, k);
  }
  if (withBase === 0) return bytes;
  // Each base offset removed shrinks the moof by 8 bytes, which moves the mdat after it up by as much.
  const shrink = 8 * withBase;

  const out = new Uint8Array(bytes.byteLength - shrink);
  const outView = new DataView(out.buffer);
  out.set(bytes.subarray(0, 8));
  outView.setUint32(0, out.byteLength);
  let w = 8;
  for (const c of children) {
    const traf = kids.get(c);
    if (!traf) {
      out.set(bytes.subarray(c.at, c.at + c.size), w);
      w += c.size;
      continue;
    }
    const trafAt = w;
    out.set(bytes.subarray(c.at, c.at + 8), w);
    w += 8;
    // Where this traf's offsets count from. Without a base offset that is the moof (as Chrome reads it).
    let base = moofAt;
    for (const k of traf) {
      if (k.type === "tfhd") {
        const flags = view.getUint32(k.at + 8);
        const hasBase = flags & TFHD_BASE_DATA_OFFSET;
        if (hasBase) base = Number(view.getBigUint64(k.at + 16));
        const cut = hasBase ? 8 : 0;
        out.set(bytes.subarray(k.at, k.at + 16), w);
        out.set(bytes.subarray(k.at + 16 + cut, k.at + k.size), w + 16);
        outView.setUint32(w, k.size - cut);
        outView.setUint32(w + 8, ((flags & ~TFHD_BASE_DATA_OFFSET) | TFHD_DEFAULT_BASE_IS_MOOF) >>> 0);
        w += k.size - cut;
      } else if (k.type === "trun") {
        // A run without its own offset continues from the one before; browsers read it differently.
        if (!(view.getUint32(k.at + 8) & TRUN_DATA_OFFSET)) return null;
        const absolute = base + view.getInt32(k.at + 16);
        out.set(bytes.subarray(k.at, k.at + k.size), w);
        outView.setInt32(w + 16, absolute - moofAt - shrink);
        w += k.size;
      } else {
        out.set(bytes.subarray(k.at, k.at + k.size), w);
        w += k.size;
      }
    }
    outView.setUint32(trafAt, w - trafAt);
  }
  return w === out.byteLength ? out : null;
}

// `fileOffset` is where `bytes` start in the original file. Null when a moof can't be rewritten safely.
export function mseSegment(bytes: Uint8Array<ArrayBuffer>, fileOffset: number): Uint8Array<ArrayBuffer> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pieces: Uint8Array[] = [];
  let changed = false;
  let at = 0;
  while (at + 8 <= bytes.byteLength) {
    let size = view.getUint32(at);
    if (size === 1 && at + 16 <= bytes.byteLength) size = Number(view.getBigUint64(at + 8));
    else if (size === 0) size = bytes.byteLength - at;
    if (size < 8) break;
    const end = Math.min(at + size, bytes.byteLength);
    const box = bytes.subarray(at, end);
    if (text(bytes, at + 4) === "moof") {
      const fixed = end - at === size ? relativeMoof(box, fileOffset + at) : null;
      if (!fixed) return null;
      if (fixed !== box) changed = true;
      pieces.push(fixed);
    } else {
      pieces.push(box);
    }
    at = end;
  }
  if (!changed) return bytes;
  if (at < bytes.byteLength) pieces.push(bytes.subarray(at));
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.byteLength, 0));
  let w = 0;
  for (const p of pieces) {
    out.set(p, w);
    w += p.byteLength;
  }
  return out;
}

// Whether top-level boxes after the index show fragments (cheap check when the index isn't read).
export async function looksFragmented(r: ByteReader): Promise<boolean> {
  const boxes = await topLevel(r);
  const i = boxes.findIndex((b) => b.type === "moov");
  return i >= 0 && boxes.slice(i + 1).some((b) => b.type === "moof" || b.type === "sidx" || b.type === "styp");
}
