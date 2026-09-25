import "server-only";
import { log } from "./log";
import type { ByteReader, Chunk, Mp4Layout } from "./mp4";

// Faststart: moves an end-of-file index ahead of the thousands of small boxes some recorders leave.
// Repair: a de-identification tool inserted bytes before the media without moving the chunk offsets.

export interface VirtualMp4 {
  size: number;
  pieces: Piece[];
  fixes: { faststart: boolean; repair: IndexShift | null };
  // Bytes kept in memory, for cache accounting.
  memory: number;
}

export type Piece = { from: "file"; start: number; end: number } | { from: "memory"; bytes: Uint8Array };

export interface IndexShift {
  // Chunks starting before this file offset are shifted; the rest are right.
  before: number;
  shift: number;
  // Video chunks corrected.
  chunks: number;
}

const MDAT_HEADER = 16;
const plog = log.child({ scope: "playable" });
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex"]);
const text = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

// Rewrites every stco/co64 entry of `moov` (a copy) through `move`. False when a 32-bit table would overflow.
function moveChunkOffsets(moov: Uint8Array, move: (offset: number) => number): boolean {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const walk = (from: number, to: number): boolean => {
    for (let at = from; at + 8 <= to; ) {
      const size = view.getUint32(at);
      if (size < 8 || at + size > to) return false;
      const type = text(moov, at + 4);
      if (CONTAINERS.has(type)) {
        if (!walk(at + 8, at + size)) return false;
      } else if (type === "stco" || type === "co64") {
        const wide = type === "co64";
        const count = view.getUint32(at + 12);
        if (at + 16 + count * (wide ? 8 : 4) > at + size) return false;
        for (let i = 0; i < count; i++) {
          const p = at + 16 + i * (wide ? 8 : 4);
          const moved = move(wide ? Number(view.getBigUint64(p)) : view.getUint32(p));
          if (wide) view.setBigUint64(p, BigInt(moved));
          else if (moved > 0xffffffff || moved < 0) return false;
          else view.setUint32(p, moved);
        }
      }
      at += size;
    }
    return true;
  };
  return walk(8, moov.byteLength);
}

// Chunks bigger than this aren't read to judge them (camera chunks are about 1 MB).
const MAX_CHUNK_READ = 4 * 1024 * 1024;
// How far around a broken chunk its real data is looked for.
const SHIFT_WINDOW = 8 * 1024 * 1024;


// Whether a whole chunk reads as length-prefixed H.264/HEVC NAL units ending exactly at its end, as avc1/hvc1
// samples must. Junk (even a copy of an index) fails this.
export function looksLikeSamples(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength;
  let at = 0;
  while (at + 5 <= end) {
    const length = view.getUint32(at);
    if (length < 1 || at + 4 + length > end || bytes[at + 4] & 0x80) return false;
    at += 4 + length;
  }
  return at === end && end > 0;
}

// The damage: early video chunks don't hold samples, late ones do, and the early ones' data is all `shift`
// bytes further on. Null when the file is fine, or damaged some other way (then nothing is changed).
export async function findIndexShift(r: ByteReader, layout: Mp4Layout): Promise<IndexShift | null> {
  const video = layout.video;
  if (!video || layout.fragmented || (video.codec !== "avc1" && video.codec !== "hvc1")) return null;
  const chunks = video.chunks.filter((c) => c.size > 0);
  if (chunks.length < 8) return null;
  // Whole chunks only: a partial read can't tell samples from junk that happens to parse.
  const probe = async (c: Chunk, shift = 0) => {
    const at = c.offset + shift;
    if (c.size > MAX_CHUNK_READ || at < 0 || at + c.size > r.size) return false;
    return looksLikeSamples(await r.read(at, c.size));
  };

  const last = chunks.length - 1;
  // Healthy files stop here after one or two small reads.
  if ((await probe(chunks[0])) || (await probe(chunks[1])) || !(await probe(chunks[last]))) return null;

  // First good chunk: bad before it, good from it (the shape of this damage).
  let lo = 1;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (await probe(chunks[mid])) hi = mid;
    else lo = mid;
  }
  if (hi < 3) return null;

  // Measure the shift at a chunk in the middle of the bad part: the one place its samples, walked
  // NAL by NAL, end exactly at the chunk's end. A prefix check alone would also accept every NAL
  // boundary inside other chunks.
  const pick = (f: number) => {
    let i = Math.max(1, Math.floor(hi * f));
    while (i < hi - 1 && chunks[i].size < 4096) i++;
    return chunks[i];
  };
  const anchor = pick(0.5);
  if (anchor.size > MAX_CHUNK_READ) return null;
  const start = Math.max(0, anchor.offset - SHIFT_WINDOW);
  const window = await r.read(start, Math.min(r.size - start, 2 * SHIFT_WINDOW + anchor.size));

  const endsExactly = (p: number) => p + anchor.size <= window.byteLength && looksLikeSamples(window.subarray(p, p + anchor.size));
  const candidates: number[] = [];
  for (let p = 0; p + 5 <= window.byteLength && candidates.length < 64; p++) {
    // A NAL length's high byte is 0 for any sample under 16 MB; cheap filter before the full walk.
    if (window[p] !== 0 || !endsExactly(p)) continue;
    const shift = start + p - anchor.offset;
    if (shift !== 0) candidates.push(shift);
  }
  // Confirm at other bad chunks. Near the end of the bad part the inserted bytes were dropped again
  // and a chunk may be partly gone, so one miss is allowed.
  const checks = [...new Set([chunks[0], pick(0.15), pick(0.3), pick(0.65), pick(0.8)])].filter((c) => c !== anchor);
  for (const shift of candidates) {
    let misses = 0;
    for (const c of checks) if (!(await probe(c, shift)) && ++misses > 1) break;
    if (misses <= 1) return { before: chunks[hi].offset, shift, chunks: hi };
  }
  return null;
}

// Null when the file needs neither fix, or can't be fixed safely. Only offsets and box headers change.
export async function buildPlayable(r: ByteReader, layout: Mp4Layout): Promise<VirtualMp4 | null> {
  if (layout.fragmented) return null;
  const repair = await findIndexShift(r, layout).catch((e: unknown) => {
    plog.warn("index shift check failed", { err: e });
    return null;
  });
  const faststart = layout.moov.scattered && layout.moov.atEnd;
  if (!repair && !faststart) return null;

  const { offset: moovStart, size: moovSize } = layout.moov;
  const moovEnd = moovStart + moovSize;
  const moov = new Uint8Array(await r.read(moovStart, moovSize));
  if (moov.byteLength !== moovSize || text(moov, 4) !== "moov") {
    plog.warn("moov not where the layout put it", { at: moovStart, size: moovSize, read: moov.byteLength });
    return null;
  }

  const repaired = (o: number) => (repair && o < repair.before ? o + repair.shift : o);

  if (!faststart) {
    if (!moveChunkOffsets(moov, repaired)) {
      plog.info("can't repair: a chunk offset table is malformed or would overflow", { shift: repair?.shift });
      return null;
    }
    return {
      size: r.size,
      pieces: [
        { from: "file", start: 0, end: moovStart },
        { from: "memory", bytes: moov },
        { from: "file", start: moovEnd, end: r.size },
      ],
      fixes: { faststart: false, repair },
      memory: moov.byteLength,
    };
  }

  // Browsers read top-level boxes one by one, so the result has three: ftyp, moov, and one mdat around the rest.
  const first = await r.read(0, 16);
  const head = first.byteLength >= 8 && text(first, 4) === "ftyp" ? new DataView(first.buffer, first.byteOffset).getUint32(0) : 0;
  if (head > moovStart) {
    plog.info("can't faststart: ftyp runs past the moov", { ftyp: head, moov: moovStart });
    return null;
  }
  // Samples before the moov move up by the moov and the new mdat header; those after it by the header.
  const moved = (o: number) => {
    const x = repaired(o);
    return x < moovStart ? x + moovSize + MDAT_HEADER : x + MDAT_HEADER;
  };
  if (!moveChunkOffsets(moov, moved)) {
    plog.info("can't faststart: a chunk offset table is malformed or would overflow", { shift: repair?.shift });
    return null;
  }
  const mdat = new Uint8Array(MDAT_HEADER);
  const mv = new DataView(mdat.buffer);
  mv.setUint32(0, 1);
  mdat.set([0x6d, 0x64, 0x61, 0x74], 4);
  mv.setBigUint64(8, BigInt(MDAT_HEADER + moovStart - head));
  return {
    size: r.size + MDAT_HEADER,
    pieces: [
      { from: "file", start: 0, end: head },
      { from: "memory", bytes: moov },
      { from: "memory", bytes: mdat },
      { from: "file", start: head, end: moovStart },
      { from: "file", start: moovEnd, end: r.size },
    ],
    fixes: { faststart: true, repair },
    memory: moov.byteLength,
  };
}

// `end` is inclusive.
export function virtualRange(v: VirtualMp4, start: number, end: number): ({ bytes: Uint8Array } | { file: [number, number] })[] {
  const out: ({ bytes: Uint8Array } | { file: [number, number] })[] = [];
  let at = 0;
  for (const p of v.pieces) {
    const length = p.from === "memory" ? p.bytes.byteLength : p.end - p.start;
    const lo = Math.max(start, at);
    const hi = Math.min(end + 1, at + length);
    if (lo < hi) {
      if (p.from === "memory") out.push({ bytes: p.bytes.subarray(lo - at, hi - at) });
      else out.push({ file: [p.start + (lo - at), p.start + (hi - at) - 1] });
    }
    at += length;
  }
  return out;
}
