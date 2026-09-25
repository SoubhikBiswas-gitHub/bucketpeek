import "server-only";

// Browsers play an MP4 straight from S3 only when the index is small and near the start and the tracks are
// interleaved; otherwise every few frames cost a range request. `planFor` turns the layout into a decision.

export interface ByteReader {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface Chunk {
  offset: number;
  size: number;
  // Decode time of the chunk's first sample, in seconds.
  time: number;
}

export interface Track {
  id: number;
  kind: "video" | "audio" | "other";
  // Sample entry type, e.g. "avc1", "hvc1", "mp4a", "mp4v", "apch".
  codec: string;
  timescale: number;
  // Seconds.
  duration: number;
  samples: number;
  chunks: Chunk[];
  // Presentation times of sync samples (keyframes), in seconds, ascending. Video only.
  keyframes: number[];
  // Media time where presentation starts (first edit list entry), in seconds. ffmpeg starts timestamps there.
  startShift: number;
  // Where the chunk offset table is in the file, for tools that rewrite layouts.
  chunkTable: { position: number; wide: boolean; count: number } | null;
}

// Defaults a fragmented file's `trex` box gives each track's samples.
export interface TrackDefaults {
  duration: number;
  size: number;
  flags: number;
}

export interface TrackHeader {
  id: number;
  kind: Track["kind"];
  codec: string;
  timescale: number;
}

export interface Mp4Layout {
  size: number;
  // `scattered`: at the end behind more top-level boxes than a browser can walk quickly.
  moov: { offset: number; size: number; atEnd: boolean; scattered: boolean };
  // Samples live in `moof` fragments, not in the `moov` tables.
  fragmented: boolean;
  // Every track's id, kind, codec and timescale (fragmented files have no sample tables to go with them).
  tracks: TrackHeader[];
  // Fragmented files: per-track sample defaults, and the whole duration if the file declares it (mehd), in seconds.
  mvex: { defaults: Map<number, TrackDefaults>; duration: number | null };
  duration: number;
  video: Track | null;
  audio: Track | null;
  // Jumps between consecutive (in time) audio/video chunks that are more than JUMP_BYTES apart.
  interleave: { jumps: number; perMinute: number; maxJump: number };
}

// A jump the browser can't cover by reading ahead: it becomes a new range request.
export const JUMP_BYTES = 1024 * 1024;
const HEADER_READ = 16;
const MAX_TOP_BOXES = 64;

export class Mp4Error extends Error {
  constructor(
    message: string,
    // "no-index": media data but no moov anywhere, so no player can open the file.
    readonly code: "no-index" | "other" = "other",
  ) {
    super(message);
    this.name = "Mp4Error";
  }
}

export const NO_INDEX_MESSAGE =
  "The file has video data but no index (the moov box), so no player can open it. The recording may have stopped before it was finished.";


const text = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

export interface Box {
  type: string;
  // Absolute offset of the box header.
  start: number;
  headerSize: number;
  // Whole box, header included.
  size: number;
}

function boxAt(view: DataView, bytes: Uint8Array, at: number, end: number, base: number): Box | null {
  if (at + 8 > end) return null;
  let size = view.getUint32(at);
  const type = text(bytes, at + 4);
  let headerSize = 8;
  if (size === 1) {
    if (at + 16 > end) return null;
    size = Number(view.getBigUint64(at + 8));
    headerSize = 16;
  } else if (size === 0) {
    size = end - at;
  }
  if (size < headerSize) return null;
  return { type, start: base + at, headerSize, size };
}

// Skips mdat without reading it, and stops at the box after `moov`: enough to know where the index is and
// whether fragments (`moof`) follow, without walking a fragmented file's thousands of boxes.
export async function topLevel(r: ByteReader, from = 0, { stopAfterMoov = true, limit = MAX_TOP_BOXES } = {}): Promise<Box[]> {
  const boxes: Box[] = [];
  let at = from;
  while (at + 8 <= r.size && boxes.length < limit) {
    if (stopAfterMoov && boxes.length >= 2 && boxes[boxes.length - 2].type === "moov") break;
    const head = await r.read(at, Math.min(HEADER_READ, r.size - at));
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    const type = text(head, 4);
    let headerSize = 8;
    if (size === 1) {
      if (head.byteLength < 16) break;
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = r.size - at;
    }
    if (size < headerSize || !/^[\x20-\x7e]{4}$/.test(type)) break;
    boxes.push({ type, start: at, headerSize, size });
    at += size;
  }
  return boxes;
}

// The payload is `bytes[from..to)`; `base` maps buffer offsets to file offsets.
function children(view: DataView, bytes: Uint8Array, from: number, to: number, base: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at < to) {
    const b = boxAt(view, bytes, at, to, base);
    if (!b) break;
    out.push(b);
    at += b.size;
  }
  return out;
}

interface Tables {
  kind: Track["kind"];
  codec: string;
  id: number;
  timescale: number;
  mediaDuration: number;
  stts?: number;
  ctts?: number;
  stss?: number;
  stsz?: number;
  stsc?: number;
  stco?: number;
  co64?: number;
  elst?: number;
}

// Records where each table's payload starts, as buffer offsets.
function collectTables(view: DataView, bytes: Uint8Array, trak: Box, base: number): Tables {
  const t: Tables = { kind: "other", codec: "", id: 0, timescale: 0, mediaDuration: 0 };
  const walk = (from: number, to: number) => {
    for (const b of children(view, bytes, from, to, base)) {
      const payload = b.start - base + b.headerSize;
      const end = b.start - base + b.size;
      switch (b.type) {
        case "mdia":
        case "minf":
        case "stbl":
        case "edts":
          walk(payload, end);
          break;
        case "tkhd": {
          const version = bytes[payload];
          t.id = view.getUint32(payload + (version === 1 ? 20 : 12));
          break;
        }
        case "mdhd": {
          const version = bytes[payload];
          if (version === 1) {
            t.timescale = view.getUint32(payload + 20);
            t.mediaDuration = Number(view.getBigUint64(payload + 24));
          } else {
            t.timescale = view.getUint32(payload + 12);
            t.mediaDuration = view.getUint32(payload + 16);
          }
          break;
        }
        case "hdlr": {
          const handler = text(bytes, payload + 8);
          // QuickTime files also have a data handler (dhlr "alis"/"url ") in minf; it must not undo the media handler.
          if (handler === "vide") t.kind = "video";
          else if (handler === "soun") t.kind = "audio";
          break;
        }
        case "stsd":
          // version/flags (4) + entry count (4), then the first sample entry's box header.
          if (payload + 16 <= end) t.codec = text(bytes, payload + 12);
          break;
        case "stts":
        case "ctts":
        case "stss":
        case "stsz":
        case "stsc":
        case "stco":
        case "co64":
        case "elst":
          t[b.type] = payload;
          break;
      }
    }
  };
  walk(trak.start - base + trak.headerSize, trak.start - base + trak.size);
  return t;
}

// Expands the sample tables into chunks, keyframe times and the edit-list shift.
function buildTrack(view: DataView, t: Tables, base: number): Track {
  const u32 = (at: number) => view.getUint32(at);
  const scale = t.timescale || 1;

  let samples = 0;
  let fixedSize = 0;
  let sizesAt = 0;
  if (t.stsz !== undefined) {
    fixedSize = u32(t.stsz + 4);
    samples = u32(t.stsz + 8);
    sizesAt = t.stsz + 12;
  }
  const sizeOf = (i: number) => (fixedSize ? fixedSize : u32(sizesAt + i * 4));

  const wide = t.co64 !== undefined;
  const chunkAt = wide ? t.co64! : t.stco;
  const chunkCount = chunkAt === undefined ? 0 : u32(chunkAt + 4);
  const chunkOffset = (i: number) => (wide ? Number(view.getBigUint64(chunkAt! + 8 + i * 8)) : u32(chunkAt! + 8 + i * 4));

  // Decode times, walked sample by sample alongside the chunk map.
  const sttsCount = t.stts === undefined ? 0 : u32(t.stts + 4);
  let sttsEntry = 0;
  let sttsLeft = sttsCount ? u32(t.stts! + 8) : 0;
  let sttsDelta = sttsCount ? u32(t.stts! + 12) : 0;
  let dts = 0;
  const advance = () => {
    dts += sttsDelta;
    if (--sttsLeft <= 0 && ++sttsEntry < sttsCount) {
      sttsLeft = u32(t.stts! + 8 + sttsEntry * 8);
      sttsDelta = u32(t.stts! + 12 + sttsEntry * 8);
    }
  };

  // Composition offsets (version 1 allows negative values).
  const cttsCount = t.ctts === undefined ? 0 : u32(t.ctts + 4);
  const cttsSigned = t.ctts !== undefined && view.getUint8(t.ctts) === 1;
  let cttsEntry = 0;
  let cttsLeft = cttsCount ? u32(t.ctts! + 8) : 0;
  const cttsValue = (e: number) => (cttsSigned ? view.getInt32(t.ctts! + 12 + e * 8) : u32(t.ctts! + 12 + e * 8));
  let cttsOffset = cttsCount ? cttsValue(0) : 0;
  const advanceCtts = () => {
    if (!cttsCount) return;
    if (--cttsLeft <= 0 && ++cttsEntry < cttsCount) {
      cttsLeft = u32(t.ctts! + 8 + cttsEntry * 8);
      cttsOffset = cttsValue(cttsEntry);
    }
  };

  // Sync samples (1-based sample numbers). No stss means every sample is a keyframe.
  const stssCount = t.stss === undefined ? -1 : u32(t.stss + 4);
  let stssIndex = 0;
  const isSync = (sample1: number) => {
    if (stssCount < 0) return true;
    while (stssIndex < stssCount && u32(t.stss! + 8 + stssIndex * 4) < sample1) stssIndex++;
    return stssIndex < stssCount && u32(t.stss! + 8 + stssIndex * 4) === sample1;
  };

  // Edit list: presentation starts at media_time of the first non-empty edit.
  let startShift = 0;
  if (t.elst !== undefined) {
    const version = view.getUint8(t.elst);
    const entries = u32(t.elst + 4);
    for (let e = 0; e < entries; e++) {
      const at = t.elst + 8 + e * (version === 1 ? 20 : 12);
      const mediaTime = version === 1 ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4);
      if (mediaTime >= 0) {
        startShift = mediaTime / scale;
        break;
      }
    }
  }

  const chunks: Chunk[] = [];
  const keyframes: number[] = [];
  const stscCount = t.stsc === undefined ? 0 : u32(t.stsc + 4);
  let sample = 0;
  for (let e = 0; e < stscCount && sample < samples; e++) {
    const first = u32(t.stsc! + 8 + e * 12) - 1;
    const perChunk = u32(t.stsc! + 12 + e * 12);
    const next = e + 1 < stscCount ? u32(t.stsc! + 8 + (e + 1) * 12) - 1 : chunkCount;
    for (let c = first; c < next && c < chunkCount && sample < samples; c++) {
      const chunk: Chunk = { offset: chunkOffset(c), size: 0, time: dts / scale };
      for (let s = 0; s < perChunk && sample < samples; s++, sample++) {
        chunk.size += sizeOf(sample);
        if (t.kind === "video" && isSync(sample + 1)) keyframes.push((dts + cttsOffset) / scale - startShift);
        advance();
        advanceCtts();
      }
      chunks.push(chunk);
    }
  }
  keyframes.sort((a, b) => a - b);

  return {
    id: t.id,
    kind: t.kind,
    codec: t.codec,
    timescale: scale,
    duration: t.mediaDuration / scale,
    samples,
    chunks,
    keyframes,
    startShift,
    chunkTable: chunkAt === undefined ? null : { position: base + chunkAt + 8, wide, count: chunkCount },
  };
}

// How often playback in file order jumps further than a browser reads ahead.
function interleaving(video: Track | null, audio: Track | null, duration: number): Mp4Layout["interleave"] {
  const all = [...(video?.chunks ?? []), ...(audio?.chunks ?? [])].sort((a, b) => a.time - b.time || a.offset - b.offset);
  let jumps = 0;
  let maxJump = 0;
  for (let i = 1; i < all.length; i++) {
    const expected = all[i - 1].offset + all[i - 1].size;
    const jump = Math.abs(all[i].offset - expected);
    if (jump > JUMP_BYTES) jumps++;
    if (jump > maxJump) maxJump = jump;
  }
  return { jumps, perMinute: duration > 0 ? jumps / (duration / 60) : jumps, maxJump };
}

// Top-level boxes walked before looking for the index at the end of the file instead.
const EARLY_TAIL_BOXES = 8;
// Tail windows searched for an index at the end, when the top-level walk stops short of it.
const TAIL_WINDOWS = [1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024, 64 * 1024 * 1024];

// Searches the file's tail for a "moov" box whose first child is "mvhd" and that ends the file (or is
// followed only by small boxes up to the end).
async function moovAtEnd(r: ByteReader, maxMoovBytes: number): Promise<{ box: Box | null; searched: number; bytes?: Uint8Array }> {
  let searched = 0;
  for (const window of TAIL_WINDOWS) {
    // Finding the index is worth a bigger read than parsing it: a scattered file can't play without it.
    const w = Math.min(window, r.size, Math.max(maxMoovBytes, TAIL_WINDOWS[2]));
    if (w <= searched) break;
    searched = w;
    const base = r.size - w;
    const bytes = await r.read(base, w);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const endsFile = (at: number): boolean => {
      // Boxes after the moov (udta, free…) must chain exactly to the end of the file.
      for (let hops = 0; at < bytes.byteLength && hops < 16; hops++) {
        if (at + 8 > bytes.byteLength) return false;
        const size = view.getUint32(at);
        if (size < 8) return false;
        at += size;
      }
      return at === bytes.byteLength;
    };
    for (let i = bytes.byteLength - 12; i >= 4; i--) {
      if (bytes[i] !== 0x6d || text(bytes, i) !== "moov" || text(bytes, i + 8) !== "mvhd") continue;
      const size = view.getUint32(i - 4);
      if (size >= 16 && i - 4 + size <= bytes.byteLength && endsFile(i - 4 + size)) {
        // The index's bytes are already here; hand them over so they aren't read twice.
        return { box: { type: "moov", start: base + i - 4, headerSize: 8, size }, searched, bytes: bytes.subarray(i - 4, i - 4 + size) };
      }
    }
  }
  return { box: null, searched };
}

// The index is read only when it is at most `maxMoovBytes` (it can be over 100 MB for day-long recordings);
// otherwise the result has no tracks, which `planFor` treats as a reason not to play the file directly.
export async function inspectMp4(r: ByteReader, { maxMoovBytes = 64 * 1024 * 1024 } = {}): Promise<Mp4Layout & { indexRead: boolean }> {
  const boxes = await topLevel(r, 0, { limit: EARLY_TAIL_BOXES });
  let moovBox = boxes.find((b) => b.type === "moov");
  let fromTail = false;
  let tailBytes: Uint8Array | undefined;
  if (!moovBox && boxes.length >= EARLY_TAIL_BOXES) {
    // Recorders that reserve space as they go leave thousands of boxes before an index at the end:
    // look there before walking on (each box is a read).
    const tail = await moovAtEnd(r, maxMoovBytes);
    if (tail.box) {
      boxes.push((moovBox = tail.box));
      fromTail = true;
      tailBytes = tail.bytes;
    } else {
      const last = boxes[boxes.length - 1];
      boxes.push(...(await topLevel(r, last.start + last.size, { limit: MAX_TOP_BOXES - boxes.length })));
      moovBox = boxes.find((b) => b.type === "moov");
      if (!moovBox && boxes.some((b) => b.type === "mdat") && tail.searched >= Math.min(r.size, TAIL_WINDOWS.at(-1)!)) {
        throw new Mp4Error(NO_INDEX_MESSAGE, "no-index");
      }
    }
  }
  if (!moovBox) {
    // A walk that reached the end of the file without an index: nothing will find one.
    const last = boxes.at(-1);
    const walkedAll = last !== undefined && last.start + last.size === r.size;
    if (walkedAll && boxes.some((b) => b.type === "mdat")) throw new Mp4Error(NO_INDEX_MESSAGE, "no-index");
    throw new Mp4Error("No moov box: not an MP4/MOV file, or the index is missing.");
  }
  const firstMdat = boxes.find((b) => b.type === "mdat");
  const moov = {
    offset: moovBox.start,
    size: moovBox.size,
    atEnd: fromTail || (firstMdat !== undefined && firstMdat.start < moovBox.start),
    scattered: fromTail,
  };
  const fragmentedTop = boxes.some((b) => b.type === "moof");

  const empty = {
    size: r.size,
    moov,
    fragmented: fragmentedTop,
    tracks: [],
    mvex: { defaults: new Map<number, TrackDefaults>(), duration: null },
    duration: 0,
    video: null,
    audio: null,
    interleave: { jumps: 0, perMinute: 0, maxJump: 0 },
  };
  if (moovBox.size > maxMoovBytes) return { ...empty, indexRead: false };

  const bytes = tailBytes ?? (await r.read(moovBox.start, moovBox.size));
  if (bytes.byteLength < moovBox.size) throw new Mp4Error("The file ended inside its index.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = moovBox.start;
  const inner = children(view, bytes, moovBox.headerSize, moovBox.size, base);

  let movieDuration = 0;
  let movieScale = 0;
  const mvhd = inner.find((b) => b.type === "mvhd");
  if (mvhd) {
    const p = mvhd.start - base + mvhd.headerSize;
    const version = bytes[p];
    movieScale = view.getUint32(p + (version === 1 ? 20 : 12));
    const dur = version === 1 ? Number(view.getBigUint64(p + 24)) : view.getUint32(p + 16);
    movieDuration = movieScale ? dur / movieScale : 0;
  }

  const tables = inner.filter((b) => b.type === "trak").map((trak) => collectTables(view, bytes, trak, base));
  const tracks = tables.map((t) => buildTrack(view, t, base));
  const video = tracks.find((t) => t.kind === "video" && t.chunks.length > 0) ?? null;
  const audio = tracks.find((t) => t.kind === "audio" && t.chunks.length > 0) ?? null;

  const mvex = { defaults: new Map<number, TrackDefaults>(), duration: null as number | null };
  const mvexBox = inner.find((b) => b.type === "mvex");
  if (mvexBox) {
    for (const b of children(view, bytes, mvexBox.start - base + mvexBox.headerSize, mvexBox.start - base + mvexBox.size, base)) {
      const p = b.start - base + b.headerSize;
      if (b.type === "trex") {
        // version/flags, track_ID, default_sample_description_index, duration, size, flags
        mvex.defaults.set(view.getUint32(p + 4), { duration: view.getUint32(p + 12), size: view.getUint32(p + 16), flags: view.getUint32(p + 20) });
      } else if (b.type === "mehd") {
        const d = bytes[p] === 1 ? Number(view.getBigUint64(p + 4)) : view.getUint32(p + 4);
        mvex.duration = movieScale ? d / movieScale : null;
      }
    }
  }
  const fragmented = fragmentedTop || mvexBox !== undefined;
  const duration = mvex.duration || movieDuration || video?.duration || audio?.duration || 0;
  const headers = tables.map((t) => ({ id: t.id, kind: t.kind, codec: t.codec, timescale: t.timescale || 1 }));

  return {
    size: r.size,
    moov,
    fragmented,
    tracks: headers,
    mvex,
    duration,
    video,
    audio,
    interleave: interleaving(video, audio, duration),
    indexRead: true,
  };
}

// Video codecs current browsers decode from MP4. HEVC depends on the device; a failure falls back to conversion.
const BROWSER_VIDEO = new Set(["avc1", "avc3", "hvc1", "hev1", "av01", "vp09"]);

export type Plan =
  | { mode: "direct" }
  // Index at the end behind thousands of boxes: serve the file with its index moved to the front.
  | { mode: "faststart"; why: string }
  // Fragmented MP4: stream its own fragments as HLS segments, byte for byte.
  | { mode: "fragments"; why: string }
  // Re-encode on the server: the browser can't decode the video, or can't start it quickly.
  | { mode: "transcode"; why: string };

// An index bigger than this at the end of the file delays the first frame by its download.
export const MAX_INDEX_AT_END = 16 * 1024 * 1024;
// Even at the start, the browser downloads the whole index before the first frame.
export const MAX_INDEX = 16 * 1024 * 1024;
// Largest index kept in memory to serve a file faststart.
export const MAX_FASTSTART_INDEX = 32 * 1024 * 1024;

const mb = (n: number) => `${Math.round(n / 1048576)} MB`;

// Measured in Chrome at 150 ms per request (docs/costs.md): moov-at-end and de-interleaved files start in about
// a second, so layout alone isn't a reason; a fragmented file took 17 s, and a big index costs its download.
export function planFor(layout: Mp4Layout & { indexRead: boolean }): Plan {
  const video = layout.tracks.find((t) => t.kind === "video");
  const codec = video?.codec ?? "";
  if (layout.indexRead && !video) return { mode: "transcode", why: "No video track was found in the file's index." };
  if (layout.indexRead && !BROWSER_VIDEO.has(codec)) return { mode: "transcode", why: `Browsers can't decode ${codec || "this"} video.` };
  if (layout.fragmented) {
    const why = "The file is recorded in fragments, which browsers read one at a time before they start playing.";
    // The codec is needed to stream fragments as they are; without the index, convert.
    return layout.indexRead ? { mode: "fragments", why } : { mode: "transcode", why };
  }
  if (layout.moov.scattered && layout.moov.size <= MAX_FASTSTART_INDEX) {
    return { mode: "faststart", why: "Its index is at the end, behind thousands of small boxes the browser would read one by one." };
  }
  if (layout.moov.atEnd && layout.moov.size > MAX_INDEX_AT_END) {
    return { mode: "transcode", why: `Its ${mb(layout.moov.size)} index is at the end of the file, so the browser would download it all before the first frame.` };
  }
  if (layout.moov.size > MAX_INDEX) {
    return { mode: "transcode", why: `Its index is ${mb(layout.moov.size)}, which the browser would download before the first frame.` };
  }
  return { mode: "direct" };
}
