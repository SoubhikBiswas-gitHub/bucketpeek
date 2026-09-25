import "server-only";
import type { StreamDetails, VideoDetails } from "@/lib/file-details";
import { codecFacts } from "./codec-config";
import { inspectMp4, type ByteReader } from "./mp4";

// The details sheet's container and stream facts, read from an MP4/MOV's own boxes: the ftyp, the moov's
// headers and sample entries (never its big sample tables unless they're small), and for fragmented files
// the first and last moof. That's a few range reads where ffprobe walks every fragment of a 19 GB recording.

// Reads that miss what's already fetched ask for at least this much, so neighbouring box headers come along.
const BLOCK = 64 * 1024;
// An index up to this size is fetched in one read; a bigger one is walked box by box, skipping its tables.
const WHOLE_MOOV = 8 * 1024 * 1024;
// Sample entries and time-to-sample tables are read whole up to this size; bigger stts give a partial view.
const MAX_TABLE = 1024 * 1024;
// Sample sizes (for stream bitrates) only when the table is at most this big.
const MAX_SIZES = 4 * 1024 * 1024;
const MAX_MOOF = 4 * 1024 * 1024;
// Where the last fragment is looked for; a fragment bigger than the last window leaves the length unknown.
const TAIL_WINDOWS = [2 * 1024 * 1024, 16 * 1024 * 1024];
const MAX_CHILDREN = 512;
// Seconds between the MP4 epoch (1904) and the Unix one.
const MAC_EPOCH = 2082844800;

interface Box {
  type: string;
  start: number;
  header: number;
  size: number;
}

const text = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const viewOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, "");

// Serves reads from what was already fetched: `inspectMp4`'s tail search and the whole moov are read once.
export function cachedReader(r: ByteReader): ByteReader {
  const chunks: { at: number; bytes: Uint8Array }[] = [];
  return {
    size: r.size,
    async read(offset, length) {
      const end = Math.min(r.size, offset + length);
      if (end <= offset) return new Uint8Array();
      for (const c of chunks) {
        if (offset >= c.at && end <= c.at + c.bytes.byteLength) return c.bytes.subarray(offset - c.at, end - c.at);
      }
      const bytes = await r.read(offset, Math.min(r.size - offset, Math.max(length, BLOCK)));
      chunks.push({ at: offset, bytes });
      return bytes.subarray(0, end - offset);
    },
  };
}

async function childrenOf(r: ByteReader, from: number, to: number, limit = MAX_CHILDREN): Promise<Box[]> {
  const out: Box[] = [];
  for (let at = from; at + 8 <= to && out.length < limit; ) {
    const h = await r.read(at, Math.min(16, to - at));
    if (h.byteLength < 8) break;
    const v = viewOf(h);
    let size = v.getUint32(0);
    let header = 8;
    if (size === 1) {
      if (h.byteLength < 16) break;
      size = Number(v.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    out.push({ type: text(h, 4), start: at, header, size });
    at += size;
  }
  return out;
}

const within = (r: ByteReader, b: Box) => childrenOf(r, b.start + b.header, b.start + b.size);
const payload = (r: ByteReader, b: Box, max = Infinity) => r.read(b.start + b.header, Math.min(b.size - b.header, max));

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

// "num/den" in lowest terms, approximated like ffmpeg's av_reduce when either side is too big for 32 bits.
export function rational(num: number, den: number): string | null {
  if (!(num > 0) || !(den > 0) || !Number.isFinite(num / den)) return null;
  num = Math.round(num);
  den = Math.round(den);
  const g = gcd(num, den);
  num /= g;
  den /= g;
  const MAX = 2 ** 31 - 1;
  if (num <= MAX && den <= MAX) return `${num}/${den}`;
  // Continued fraction convergents of num/den, the last one that fits.
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let [x, y] = [num, den];
  while (y) {
    const a = Math.floor(x / y);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (h2 > MAX || k2 > MAX) break;
    [h0, h1, k0, k1] = [h1, h2, k1, k2];
    [x, y] = [y, x - a * y];
  }
  return k1 ? `${h1}/${k1}` : null;
}

function ratio(w: number, h: number): string | null {
  if (!(w > 0) || !(h > 0)) return null;
  const g = gcd(Math.round(w), Math.round(h));
  return `${Math.round(w) / g}:${Math.round(h) / g}`;
}

// ffmpeg's creation_time: MP4 times count from 1904, though some writers use the Unix epoch.
function creationTime(seconds: number): string | null {
  if (!seconds) return null;
  const unix = seconds >= MAC_EPOCH ? seconds - MAC_EPOCH : seconds;
  const d = new Date(unix * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

// ISO 639-2 packed in 15 bits; QuickTime's small Macintosh codes (0 is English); 0x7fff for none.
function language(code: number): string | null {
  if (code >= 0x7fff) return null;
  if (code < 0x400) return code === 0 ? "eng" : null;
  return String.fromCharCode(((code >> 10) & 31) + 0x60, ((code >> 5) & 31) + 0x60, (code & 31) + 0x60);
}

const STREAM_TYPES: Record<string, string> = { vide: "video", soun: "audio", subt: "subtitle", sbtl: "subtitle", text: "subtitle" };

interface SampleEntry {
  type: string;
  width: number;
  height: number;
  compressor: string;
  channels: number;
  sampleRate: number;
  pasp: [number, number] | null;
  boxes: Map<string, Uint8Array>;
}

interface TrackFacts {
  id: number;
  handler: string;
  handlerName: string;
  timescale: number;
  mediaDuration: number;
  language: string | null;
  creation: number;
  // Presentation length from the edit list, in movie timescale units.
  editDuration: number;
  matrix: number[] | null;
  display: [number, number];
  entry: SampleEntry | null;
  // Time-to-sample summary: samples, their total duration, and the most common sample duration.
  stts: { samples: number; total: number; mode: number; whole: boolean } | null;
  samples: number | null;
  bytes: number | null;
}

async function sampleEntry(r: ByteReader, stsd: Box, handler: string): Promise<SampleEntry | null> {
  const p = await payload(r, stsd, MAX_TABLE);
  if (p.byteLength < 16) return null;
  const v = viewOf(p);
  const size = v.getUint32(8);
  const e = p.subarray(8, 8 + Math.min(size, p.byteLength - 8));
  if (e.byteLength < 16) return null;
  const ev = viewOf(e);
  const entry: SampleEntry = { type: text(e, 4), width: 0, height: 0, compressor: "", channels: 0, sampleRate: 0, pasp: null, boxes: new Map() };
  let kids = e.byteLength;
  if (handler === "vide" && e.byteLength >= 86) {
    entry.width = ev.getUint16(32);
    entry.height = ev.getUint16(34);
    const len = Math.min(e[50], 31);
    entry.compressor = utf8(e.subarray(51, 51 + len));
    kids = 86;
  } else if (handler === "soun" && e.byteLength >= 36) {
    // QuickTime sound descriptions v1 and v2 carry more before their child boxes.
    const version = ev.getUint16(16);
    entry.channels = ev.getUint16(24);
    entry.sampleRate = ev.getUint32(32) / 65536;
    kids = 36;
    if (version === 1) kids = 52;
    else if (version === 2 && e.byteLength >= 72) {
      entry.sampleRate = ev.getFloat64(40);
      entry.channels = ev.getUint32(48);
      kids = 72;
    }
  }
  const walk = (from: number, depth: number) => {
    for (let at = from; at + 8 <= e.byteLength; ) {
      const n = ev.getUint32(at);
      if (n < 8 || at + n > e.byteLength) break;
      const t = text(e, at + 4);
      const body = e.subarray(at + 8, at + n);
      // QuickTime keeps esds inside a "wave" box.
      if (t === "wave" && depth === 0) walk(at + 8, 1);
      else if (t === "pasp" && body.byteLength >= 8) {
        const pv = viewOf(body);
        entry.pasp = [pv.getUint32(0), pv.getUint32(4)];
      } else if (!entry.boxes.has(t)) entry.boxes.set(t, body);
      at += n;
    }
  };
  walk(kids, 0);
  return entry;
}

async function sttsSummary(r: ByteReader, b: Box): Promise<TrackFacts["stts"]> {
  const p = await payload(r, b, MAX_TABLE);
  if (p.byteLength < 8) return null;
  const v = viewOf(p);
  const count = v.getUint32(4);
  const whole = 8 + count * 8 <= p.byteLength;
  const counts = new Map<number, number>();
  let samples = 0;
  let total = 0;
  for (let i = 0; i < count && 16 + i * 8 <= p.byteLength; i++) {
    const n = v.getUint32(8 + i * 8);
    const d = v.getUint32(12 + i * 8);
    samples += n;
    total += n * d;
    counts.set(d, (counts.get(d) ?? 0) + n);
  }
  let mode = 0;
  let best = 0;
  for (const [d, n] of counts) if (n > best && d > 0) [mode, best] = [d, n];
  return { samples, total, mode, whole };
}

async function stszSummary(r: ByteReader, b: Box): Promise<{ samples: number; bytes: number | null }> {
  const head = await payload(r, b, 12);
  if (head.byteLength < 12) return { samples: 0, bytes: null };
  const v = viewOf(head);
  const fixed = v.getUint32(4);
  const samples = v.getUint32(8);
  if (fixed) return { samples, bytes: fixed * samples };
  if (samples * 4 > MAX_SIZES) return { samples, bytes: null };
  const p = await payload(r, b, 12 + samples * 4);
  const pv = viewOf(p);
  let bytes = 0;
  for (let i = 0; i < samples && 16 + i * 4 <= p.byteLength; i++) bytes += pv.getUint32(12 + i * 4);
  return { samples, bytes };
}

async function trackFacts(r: ByteReader, trak: Box): Promise<TrackFacts> {
  const t: TrackFacts = {
    id: 0,
    handler: "",
    handlerName: "",
    timescale: 0,
    mediaDuration: 0,
    language: null,
    creation: 0,
    editDuration: 0,
    matrix: null,
    display: [0, 0],
    entry: null,
    stts: null,
    samples: null,
    bytes: null,
  };
  let stsd: Box | undefined;
  const walk = async (container: Box, inMdia: boolean) => {
    for (const b of await within(r, container)) {
      switch (b.type) {
        case "mdia":
          await walk(b, true);
          break;
        case "minf":
        case "stbl":
          await walk(b, false);
          break;
        case "tkhd": {
          const p = await payload(r, b, 96);
          const v = viewOf(p);
          const wide = p[0] === 1;
          if (p.byteLength < (wide ? 92 : 80)) break;
          t.id = v.getUint32(wide ? 20 : 12);
          const m = wide ? 52 : 40;
          t.matrix = [v.getInt32(m), v.getInt32(m + 4), v.getInt32(m + 12), v.getInt32(m + 16)];
          t.display = [v.getUint32(m + 36) / 65536, v.getUint32(m + 40) / 65536];
          break;
        }
        case "mdhd": {
          const p = await payload(r, b, 40);
          const v = viewOf(p);
          const wide = p[0] === 1;
          if (p.byteLength < (wide ? 34 : 22)) break;
          t.creation = wide ? Number(v.getBigUint64(4)) : v.getUint32(4);
          t.timescale = v.getUint32(wide ? 20 : 12);
          t.mediaDuration = wide ? Number(v.getBigUint64(24)) : v.getUint32(16);
          t.language = language(v.getUint16(wide ? 32 : 20) & 0x7fff);
          break;
        }
        case "hdlr": {
          // Only the media handler: QuickTime's minf also has a data handler.
          if (!inMdia) break;
          const p = await payload(r, b, 4096);
          if (p.byteLength < 24) break;
          t.handler = text(p, 8);
          let name = p.subarray(24);
          if (name.byteLength > 1 && name[0] === name.byteLength - 1) name = name.subarray(1);
          t.handlerName = utf8(name).trim();
          break;
        }
        case "edts":
          for (const e of await within(r, b)) {
            if (e.type !== "elst") continue;
            const p = await payload(r, e, 64 * 1024);
            const v = viewOf(p);
            const wide = p[0] === 1;
            const step = wide ? 20 : 12;
            for (let i = 0, n = p.byteLength >= 8 ? v.getUint32(4) : 0; i < n && 8 + (i + 1) * step <= p.byteLength; i++) {
              const at = 8 + i * step;
              const dur = wide ? Number(v.getBigUint64(at)) : v.getUint32(at);
              const mediaTime = wide ? Number(v.getBigInt64(at + 8)) : v.getInt32(at + 4);
              if (mediaTime >= 0) t.editDuration += dur;
            }
          }
          break;
        case "stsd":
          stsd = b;
          break;
        case "stts":
          t.stts = await sttsSummary(r, b);
          break;
        case "stsz": {
          const s = await stszSummary(r, b);
          t.samples = s.samples;
          t.bytes = s.bytes;
          break;
        }
      }
    }
  };
  await walk(trak, false);
  if (stsd) t.entry = await sampleEntry(r, stsd, t.handler);
  return t;
}

// iTunes-style ilst items and QuickTime mdta keys, which ffprobe reports as container tags.
const ITEM_NAMES: Record<string, string> = {
  "©too": "encoder",
  "©nam": "title",
  "©day": "date",
  "©cmt": "comment",
  "©ART": "artist",
  "©xyz": "location",
  "©mak": "make",
  "©mod": "model",
  "©swr": "encoder",
};

async function userTags(r: ByteReader, udta: Box, tags: Map<string, string>): Promise<void> {
  const add = (k: string | undefined, v: string) => {
    if (k && v && !tags.has(k)) tags.set(k, v);
  };
  for (const b of await within(r, udta)) {
    if (b.size > 256 * 1024) continue;
    if (b.type.charCodeAt(0) === 0xa9 && b.type !== "©TIM") {
      // QuickTime user data text: 16-bit length and language, then the string.
      const p = await payload(r, b);
      if (p.byteLength < 4 || text(p, 4) === "data") continue;
      const len = viewOf(p).getUint16(0);
      add(ITEM_NAMES[b.type], utf8(p.subarray(4, 4 + len)));
    } else if (b.type === "meta") {
      const p = await payload(r, b);
      // ISO meta is a full box (4 bytes of version/flags first); QuickTime's isn't.
      const skip = p.byteLength >= 12 && text(p, 8) === "hdlr" ? 4 : 0;
      const kids = await childrenOf(r, b.start + b.header + skip, b.start + b.size);
      const keysBox = kids.find((k) => k.type === "keys");
      const keys: string[] = [];
      if (keysBox) {
        const kp = await payload(r, keysBox);
        const kv = viewOf(kp);
        for (let at = 8, i = 0, n = kp.byteLength >= 8 ? kv.getUint32(4) : 0; i < n && at + 8 <= kp.byteLength; i++) {
          const size = kv.getUint32(at);
          if (size < 8) break;
          keys.push(utf8(kp.subarray(at + 8, at + size)));
          at += size;
        }
      }
      const ilst = kids.find((k) => k.type === "ilst");
      if (!ilst) continue;
      for (const item of await within(r, ilst)) {
        const index = item.type.charCodeAt(0) < 0x20 ? await r.read(item.start + 4, 4).then((x) => viewOf(x).getUint32(0)) : 0;
        const name = index ? keys[index - 1] : ITEM_NAMES[item.type];
        for (const d of await within(r, item)) {
          if (d.type !== "data") continue;
          const dp = await payload(r, d);
          // Well-known type 1: UTF-8 text. Numbers and pictures are left to ffprobe.
          if (dp.byteLength >= 8 && viewOf(dp).getUint32(0) === 1) add(name, utf8(dp.subarray(8)));
          break;
        }
      }
    }
  }
}

interface TrafFacts {
  time: number | null;
  samples: number;
  duration: number;
  counts: Map<number, number>;
}

// Per track, the decode time and sample durations a moof declares.
export function moofFacts(bytes: Uint8Array, defaults: Map<number, number>): Map<number, TrafFacts> {
  const v = viewOf(bytes);
  const out = new Map<number, TrafFacts>();
  const boxes = (from: number, to: number) => {
    const list: { type: string; at: number; end: number }[] = [];
    for (let at = from; at + 8 <= to; ) {
      const size = v.getUint32(at);
      if (size < 8 || at + size > to) break;
      list.push({ type: text(bytes, at + 4), at: at + 8, end: at + size });
      at += size;
    }
    return list;
  };
  for (const traf of boxes(8, bytes.byteLength)) {
    if (traf.type !== "traf") continue;
    let id = -1;
    let dur = 0;
    const f: TrafFacts = { time: null, samples: 0, duration: 0, counts: new Map() };
    for (const b of boxes(traf.at, traf.end)) {
      const p = b.at;
      if (b.type === "tfhd" && p + 8 <= b.end) {
        const flags = v.getUint32(p) & 0xffffff;
        id = v.getUint32(p + 4);
        dur = defaults.get(id) ?? 0;
        let q = p + 8;
        if (flags & 0x1) q += 8;
        if (flags & 0x2) q += 4;
        if (flags & 0x8 && q + 4 <= b.end) dur = v.getUint32(q);
      } else if (b.type === "tfdt" && p + 8 <= b.end) {
        f.time = bytes[p] === 1 && p + 12 <= b.end ? Number(v.getBigUint64(p + 4)) : v.getUint32(p + 4);
      } else if (b.type === "trun" && p + 8 <= b.end) {
        const flags = v.getUint32(p) & 0xffffff;
        const count = v.getUint32(p + 4);
        let q = p + 8 + (flags & 0x1 ? 4 : 0) + (flags & 0x4 ? 4 : 0);
        const per = [0x100, 0x200, 0x400, 0x800].filter((x) => flags & x).length * 4;
        for (let i = 0; i < count; i++, q += per) {
          if (per && q + per > b.end) break;
          const d = flags & 0x100 ? v.getUint32(q) : dur;
          f.samples++;
          f.duration += d;
          f.counts.set(d, (f.counts.get(d) ?? 0) + 1);
        }
      }
    }
    if (id < 0) continue;
    const prev = out.get(id);
    if (!prev) out.set(id, f);
    else {
      prev.samples += f.samples;
      prev.duration += f.duration;
      for (const [d, n] of f.counts) prev.counts.set(d, (prev.counts.get(d) ?? 0) + n);
    }
  }
  return out;
}

async function firstMoof(r: ByteReader, from: number): Promise<Uint8Array | null> {
  let at = from;
  for (let hops = 0; hops < 8 && at + 8 <= r.size; hops++) {
    const [b] = await childrenOf(r, at, r.size, 1);
    if (!b) return null;
    if (b.type === "moof") return b.size <= MAX_MOOF ? r.read(b.start, b.size) : null;
    // Fragments may follow sidx, styp, free or emsg boxes; anything else means they aren't here.
    if (!["sidx", "styp", "free", "skip", "emsg", "prft", "uuid"].includes(b.type)) return null;
    at = b.start + b.size;
  }
  return null;
}

// The last complete moof in the file's tail, found by its signature: size, "moof", then a 16-byte "mfhd".
async function lastMoof(r: ByteReader, from: number): Promise<Uint8Array | null> {
  for (const window of TAIL_WINDOWS) {
    const w = Math.min(window, r.size - from);
    if (w < 24) return null;
    const bytes = await r.read(r.size - w, w);
    const v = viewOf(bytes);
    for (let i = bytes.byteLength - 16; i >= 4; i--) {
      if (bytes[i] !== 0x6d || text(bytes, i) !== "moof" || text(bytes, i + 8) !== "mfhd" || v.getUint32(i + 4) !== 16) continue;
      const size = v.getUint32(i - 4);
      if (size >= 24 && i - 4 + size <= bytes.byteLength) return bytes.subarray(i - 4, i - 4 + size);
    }
    if (w === r.size - from) return null;
  }
  return null;
}

function modeOf(counts: Map<number, number>): number {
  let mode = 0;
  let best = 0;
  for (const [d, n] of counts) if (n > best && d > 0) [mode, best] = [d, n];
  return mode;
}

// Degrees as ffmpeg's av_display_rotation_get reports them; null for no rotation.
function rotationOf(m: number[] | null): number | null {
  if (!m) return null;
  const [a, b, c, d] = m.map((x) => x / 65536);
  const s0 = Math.hypot(a, c);
  const s1 = Math.hypot(b, d);
  if (!s0 || !s1) return null;
  const r = Math.round((-Math.atan2(b / s1, a / s0) * 180) / Math.PI);
  return r === 0 ? null : r;
}

// Throws for files that aren't MP4/MOV or have no index.
export async function mp4Facts(source: ByteReader, { wholeMoov = WHOLE_MOOV } = {}): Promise<VideoDetails> {
  const r = cachedReader(source);
  // Finds the index wherever it is (including behind thousands of boxes) without parsing its tables.
  const layout = await inspectMp4(r, { maxMoovBytes: 0 });
  const moov: Box = { type: "moov", start: layout.moov.offset, header: 8, size: layout.moov.size };
  if (moov.size <= wholeMoov) await r.read(moov.start, moov.size);
  const head = await r.read(moov.start, 16);
  if (head.byteLength >= 16 && viewOf(head).getUint32(0) === 1) moov.header = 16;

  const tags = new Map<string, string>();
  const [ftyp] = await childrenOf(r, 0, Math.min(r.size, 4096), 1);
  if (ftyp?.type === "ftyp" && ftyp.size <= 4096) {
    const p = await payload(r, ftyp);
    if (p.byteLength >= 8) {
      tags.set("major_brand", text(p, 0));
      tags.set("minor_version", String(viewOf(p).getUint32(4)));
      let brands = "";
      for (let at = 8; at + 4 <= p.byteLength; at += 4) brands += text(p, at);
      tags.set("compatible_brands", brands);
    }
  }

  let movieScale = 0;
  let movieDuration = 0;
  let mvex = false;
  let mehd = 0;
  const trex = new Map<number, number>();
  const tracks: TrackFacts[] = [];
  let udta: Box | undefined;
  for (const b of await within(r, moov)) {
    if (b.type === "mvhd") {
      const p = await payload(r, b, 32);
      const v = viewOf(p);
      const wide = p[0] === 1;
      if (p.byteLength < (wide ? 32 : 20)) continue;
      const created = creationTime(wide ? Number(v.getBigUint64(4)) : v.getUint32(4));
      if (created) tags.set("creation_time", created);
      movieScale = v.getUint32(wide ? 20 : 12);
      movieDuration = wide ? Number(v.getBigUint64(24)) : v.getUint32(16);
    } else if (b.type === "trak") {
      tracks.push(await trackFacts(r, b));
    } else if (b.type === "mvex") {
      mvex = true;
      for (const x of await within(r, b)) {
        const p = await payload(r, x, 32);
        const v = viewOf(p);
        if (x.type === "trex" && p.byteLength >= 16) trex.set(v.getUint32(4), v.getUint32(12));
        else if (x.type === "mehd" && p.byteLength >= 8) mehd = p[0] === 1 && p.byteLength >= 12 ? Number(v.getBigUint64(4)) : v.getUint32(4);
      }
    } else if (b.type === "udta") {
      udta = b;
    }
  }
  if (udta) await userTags(r, udta, tags).catch(() => undefined);

  const fragmented = mvex || layout.fragmented;
  const moovEnd = moov.start + moov.size;
  const [first, last] = fragmented
    ? await Promise.all([firstMoof(r, moovEnd).catch(() => null), lastMoof(r, moovEnd).catch(() => null)])
    : [null, null];
  const firstFacts = first ? moofFacts(first, trex) : new Map<number, TrafFacts>();
  const lastFacts = last ? moofFacts(last, trex) : new Map<number, TrafFacts>();

  const streams: StreamDetails[] = tracks.map((t, index) => {
    const scale = t.timescale || 1;
    const e = t.entry;
    const video = t.handler === "vide";
    const audio = t.handler === "soun";
    const c = codecFacts(e?.type ?? "", e?.boxes ?? new Map(), audio);

    let duration: number | null = null;
    let frameRate: string | null = null;
    let avgFrameRate: string | null = null;
    let frames: number | null = null;
    let bitRate: number | null = null;
    if (fragmented) {
      const a = firstFacts.get(t.id);
      const z = lastFacts.get(t.id);
      if (z?.time !== null && z !== undefined) duration = (z.time + z.duration - (a?.time ?? 0)) / scale;
      const mode = a ? modeOf(a.counts) : 0;
      if (video) frameRate = rational(scale, mode || trex.get(t.id) || 0);
    } else {
      const edit = movieScale && t.editDuration ? t.editDuration / movieScale : 0;
      duration = edit || t.mediaDuration / scale || null;
      frames = t.samples;
      const span = t.stts?.whole ? t.stts.total : t.mediaDuration;
      if (video && t.stts) {
        frameRate = rational(scale, t.stts.mode);
        avgFrameRate = t.samples ? rational(t.samples * scale, span) : null;
      }
      if (t.bytes !== null && span > 0) bitRate = Math.floor((t.bytes * 8 * scale) / span);
    }

    const width = e?.width || null;
    const height = e?.height || null;
    const sar = c.sar ?? e?.pasp ?? null;
    const displayAspectRatio = video
      ? sar && width && height
        ? ratio(width * sar[0], height * sar[1])
        : ratio(t.display[0], t.display[1])
      : null;
    const channels = audio ? (c.channels ?? (e?.channels || null)) : null;
    const streamTags: { key: string; value: string }[] = [];
    const created = creationTime(t.creation);
    if (created) streamTags.push({ key: "creation_time", value: created });
    if (t.language) streamTags.push({ key: "language", value: t.language });
    if (t.handlerName) streamTags.push({ key: "handler_name", value: t.handlerName });
    if (e?.compressor) streamTags.push({ key: "encoder", value: e.compressor });
    return {
      index,
      type: STREAM_TYPES[t.handler] ?? "data",
      codec: c.codec,
      codecLong: c.codecLong,
      codecString: c.codecString,
      codecTag: e && /^[\x20-\x7e]{4}$/.test(e.type) ? e.type : null,
      profile: c.profile,
      level: c.level,
      width: video ? width : null,
      height: video ? height : null,
      displayAspectRatio,
      frameRate,
      avgFrameRate,
      pixelFormat: c.pixelFormat,
      colorSpace: c.colorSpace,
      bitDepth: c.bitDepth,
      fieldOrder: c.fieldOrder,
      bitRate,
      rotation: video ? rotationOf(t.matrix) : null,
      sampleRate: audio ? (c.sampleRate ?? (e?.sampleRate || null)) : null,
      channels,
      channelLayout: channels === 1 ? "mono" : channels === 2 ? "stereo" : null,
      sampleFormat: null,
      duration,
      frames,
      language: t.language === "und" ? null : t.language,
      tags: streamTags,
    };
  });

  const known = streams.map((s) => s.duration ?? 0);
  const declared = movieScale ? (fragmented ? mehd || movieDuration : movieDuration) / movieScale : 0;
  const duration = (fragmented ? Math.max(0, ...known) || declared : declared || Math.max(0, ...known)) || null;
  return {
    format: {
      name: "mov,mp4,m4a,3gp,3g2,mj2",
      longName: "QuickTime / MOV",
      duration,
      bitRate: duration ? Math.floor((r.size * 8) / duration) : null,
      startTime: null,
      streams: streams.length,
      tags: [...tags].map(([key, value]) => ({ key, value })),
    },
    streams,
  };
}
