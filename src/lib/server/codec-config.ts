import "server-only";
import { formatLevel } from "@/lib/file-details";

// Stream facts from an MP4 sample entry's codec configuration (avcC, hvcC, esds…), named the way
// ffprobe names them so the details sheet reads the same whichever of the two answered.

export interface CodecFacts {
  codec: string | null;
  codecLong: string | null;
  codecString: string | null;
  profile: string | null;
  level: string | null;
  pixelFormat: string | null;
  colorSpace: string | null;
  bitDepth: number | null;
  fieldOrder: string | null;
  // Sample aspect ratio, when the stream declares one.
  sar: [number, number] | null;
  sampleRate: number | null;
  channels: number | null;
}

export const emptyCodecFacts = (): CodecFacts => ({
  codec: null,
  codecLong: null,
  codecString: null,
  profile: null,
  level: null,
  pixelFormat: null,
  colorSpace: null,
  bitDepth: null,
  fieldOrder: null,
  sar: null,
  sampleRate: null,
  channels: null,
});

const NAMES: Record<string, [string, string]> = {
  avc1: ["h264", "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10"],
  avc3: ["h264", "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10"],
  hvc1: ["hevc", "H.265 / HEVC (High Efficiency Video Coding)"],
  hev1: ["hevc", "H.265 / HEVC (High Efficiency Video Coding)"],
  av01: ["av1", "Alliance for Open Media AV1"],
  vp09: ["vp9", "Google VP9"],
  mp4v: ["mpeg4", "MPEG-4 part 2"],
  apch: ["prores", "Apple ProRes (iCodec Pro)"],
  apcn: ["prores", "Apple ProRes (iCodec Pro)"],
  apcs: ["prores", "Apple ProRes (iCodec Pro)"],
  apco: ["prores", "Apple ProRes (iCodec Pro)"],
  ap4h: ["prores", "Apple ProRes (iCodec Pro)"],
  ap4x: ["prores", "Apple ProRes (iCodec Pro)"],
  jpeg: ["mjpeg", "Motion JPEG"],
  mjpa: ["mjpeg", "Motion JPEG"],
  mp4a: ["aac", "AAC (Advanced Audio Coding)"],
  Opus: ["opus", "Opus (Opus Interactive Audio Codec)"],
  fLaC: ["flac", "FLAC (Free Lossless Audio Codec)"],
  "ac-3": ["ac3", "ATSC A/52A (AC-3)"],
  "ec-3": ["eac3", "ATSC A/52B (AC-3, E-AC-3)"],
  alac: ["alac", "ALAC (Apple Lossless Audio Codec)"],
  sowt: ["pcm_s16le", "PCM signed 16-bit little-endian"],
  twos: ["pcm_s16be", "PCM signed 16-bit big-endian"],
  ulaw: ["pcm_mulaw", "PCM mu-law / G.711 mu-law"],
  alaw: ["pcm_alaw", "PCM A-law / G.711 A-law"],
};

const PRORES: Record<string, string> = { apco: "Proxy", apcs: "LT", apcn: "Standard", apch: "HQ", ap4h: "4444", ap4x: "4444XQ" };

// esds objectTypeIndication values that aren't AAC.
const MPEG_AUDIO: Record<number, [string, string]> = {
  0x69: ["mp3", "MP3 (MPEG audio layer 3)"],
  0x6b: ["mp3", "MP3 (MPEG audio layer 3)"],
  0xa5: ["ac3", "ATSC A/52A (AC-3)"],
  0xa6: ["eac3", "ATSC A/52B (AC-3, E-AC-3)"],
};
const MPEG_VIDEO: Record<number, [string, string]> = {
  0x60: ["mpeg2video", "MPEG-2 video"],
  0x61: ["mpeg2video", "MPEG-2 video"],
  0x62: ["mpeg2video", "MPEG-2 video"],
  0x63: ["mpeg2video", "MPEG-2 video"],
  0x64: ["mpeg2video", "MPEG-2 video"],
  0x65: ["mpeg2video", "MPEG-2 video"],
  0x6a: ["mpeg1video", "MPEG-1 video"],
  0x6c: ["mjpeg", "Motion JPEG"],
};

const COLOR_SPACES: Record<number, string> = {
  0: "gbr",
  1: "bt709",
  4: "fcc",
  5: "bt470bg",
  6: "smpte170m",
  7: "smpte240m",
  8: "ycgco",
  9: "bt2020nc",
  10: "bt2020c",
  11: "smpte2085",
  12: "chroma-derived-nc",
  13: "chroma-derived-c",
  14: "ictcp",
};

const SAR_TABLE: [number, number][] = [
  [0, 0], [1, 1], [12, 11], [10, 11], [16, 11], [40, 33], [24, 11], [20, 11], [32, 11],
  [80, 33], [18, 11], [15, 11], [64, 33], [160, 99], [4, 3], [3, 2], [2, 1],
];

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const AAC_PROFILES: Record<number, string> = { 1: "Main", 2: "LC", 3: "SSR", 4: "LTP", 5: "HE-AAC", 23: "LD", 29: "HE-AACv2", 39: "ELD" };

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

class Bits {
  private pos = 0;
  constructor(private readonly b: Uint8Array) {}
  u(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) {
      const byte = this.b[this.pos >> 3];
      if (byte === undefined) throw new RangeError("Ended early.");
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
    }
    return v;
  }
  ue(): number {
    let zeros = 0;
    while (this.u(1) === 0) if (++zeros > 31) throw new RangeError("Bad Exp-Golomb code.");
    return zeros ? 2 ** zeros - 1 + this.u(zeros) : 0;
  }
  se(): number {
    const k = this.ue();
    return k % 2 ? (k + 1) / 2 : -(k / 2);
  }
}

// NAL payload without emulation-prevention bytes (00 00 03 → 00 00).
function rbsp(nal: Uint8Array): Uint8Array {
  const out = new Uint8Array(nal.byteLength);
  let n = 0;
  let zeros = 0;
  for (const byte of nal) {
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    zeros = byte === 0 ? zeros + 1 : 0;
    out[n++] = byte;
  }
  return out.subarray(0, n);
}

function pixelFormat(chroma: number, depth: number, fullRange: boolean): string | null {
  const le = depth > 8 ? `${depth}le` : "";
  if (chroma === 0) return `gray${le}`;
  const base = ({ 1: "420p", 2: "422p", 3: "444p" } as Record<number, string>)[chroma];
  if (!base) return null;
  // ffmpeg's decoders name 8-bit full-range pictures yuvj*.
  return `yuv${fullRange && depth === 8 ? "j" : ""}${base}${le}`;
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

interface Sps {
  chroma: number;
  depth: number;
  progressive: boolean;
  fullRange: boolean;
  matrix: number | null;
  sar: [number, number] | null;
}

// H.264 sequence parameter set, as far as the VUI's colour and aspect facts.
export function parseH264Sps(nal: Uint8Array): Sps | null {
  try {
    const b = new Bits(rbsp(nal.subarray(1)));
    const profile = b.u(8);
    b.u(16);
    b.ue();
    let chroma = 1;
    let depth = 8;
    if (HIGH_PROFILES.has(profile)) {
      chroma = b.ue();
      if (chroma === 3) b.u(1);
      depth = b.ue() + 8;
      b.ue();
      b.u(1);
      if (b.u(1)) {
        for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
          if (!b.u(1)) continue;
          let last = 8;
          let next = 8;
          for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
            if (next !== 0) next = (last + b.se() + 256) % 256;
            last = next === 0 ? last : next;
          }
        }
      }
    }
    b.ue();
    const pocType = b.ue();
    if (pocType === 0) b.ue();
    else if (pocType === 1) {
      b.u(1);
      b.se();
      b.se();
      for (let i = b.ue(); i > 0; i--) b.se();
    }
    b.ue();
    b.u(1);
    b.ue();
    b.ue();
    const frameMbsOnly = b.u(1) === 1;
    if (!frameMbsOnly) b.u(1);
    b.u(1);
    if (b.u(1)) for (let i = 0; i < 4; i++) b.ue();
    const sps: Sps = { chroma, depth, progressive: frameMbsOnly, fullRange: false, matrix: null, sar: null };
    if (!b.u(1)) return sps;
    if (b.u(1)) {
      const idc = b.u(8);
      if (idc === 255) sps.sar = [b.u(16), b.u(16)];
      else if (idc > 0 && idc < SAR_TABLE.length) sps.sar = SAR_TABLE[idc];
      if (sps.sar && (!sps.sar[0] || !sps.sar[1])) sps.sar = null;
    }
    if (b.u(1)) b.u(1);
    if (b.u(1)) {
      b.u(3);
      sps.fullRange = b.u(1) === 1;
      if (b.u(1)) {
        b.u(16);
        sps.matrix = b.u(8);
      }
    }
    return sps;
  } catch {
    return null;
  }
}

function avcFacts(type: string, c: Uint8Array, out: CodecFacts): void {
  if (c.byteLength < 7) return;
  const [, profile, compat, level] = c;
  out.codecString = `${type}.${hex2(profile)}${hex2(compat)}${hex2(level)}`;
  const intra = compat & 0x10;
  const names: Record<number, string> = {
    66: compat & 0x40 ? "Constrained Baseline" : "Baseline",
    77: "Main",
    88: "Extended",
    100: "High",
    110: intra ? "High 10 Intra" : "High 10",
    122: intra ? "High 4:2:2 Intra" : "High 4:2:2",
    244: intra ? "High 4:4:4 Intra" : "High 4:4:4 Predictive",
    44: "CAVLC 4:4:4",
    118: "Multiview High",
    128: "Stereo High",
  };
  out.profile = names[profile] ?? null;
  out.level = formatLevel("h264", level);
  if ((c[5] & 0x1f) === 0 || c.byteLength < 8) return;
  const len = (c[6] << 8) | c[7];
  const sps = c.byteLength >= 8 + len ? parseH264Sps(c.subarray(8, 8 + len)) : null;
  if (!sps) return;
  out.bitDepth = sps.depth;
  out.pixelFormat = pixelFormat(sps.chroma, sps.depth, sps.fullRange);
  out.colorSpace = sps.matrix === null ? null : (COLOR_SPACES[sps.matrix] ?? null);
  out.fieldOrder = sps.progressive ? "progressive" : null;
  out.sar = sps.sar;
}

// Returns the chroma format, which names the pixel format once the range is known.
function hevcFacts(type: string, c: Uint8Array, out: CodecFacts): number | undefined {
  if (c.byteLength < 23) return undefined;
  const view = new DataView(c.buffer, c.byteOffset, c.byteLength);
  const space = c[1] >> 6;
  const tier = (c[1] >> 5) & 1;
  const profile = c[1] & 0x1f;
  const compat = view.getUint32(2);
  let reversed = 0;
  for (let i = 0; i < 32; i++) if (compat & (1 << i)) reversed |= 1 << (31 - i);
  const constraints = Array.from(c.subarray(6, 12));
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = c[12];
  out.codecString = [
    type,
    `${["", "A", "B", "C"][space]}${profile}`,
    (reversed >>> 0).toString(16).toUpperCase(),
    `${tier ? "H" : "L"}${level}`,
    ...constraints.map((x) => x.toString(16).toUpperCase()),
  ].join(".");
  out.profile = ({ 1: "Main", 2: "Main 10", 3: "Main Still Picture", 4: "Rext", 9: "SCC" } as Record<number, string>)[profile] ?? null;
  out.level = formatLevel("hevc", level);
  out.bitDepth = (c[17] & 7) + 8;
  return c[16] & 3;
}

function av1Facts(c: Uint8Array, out: CodecFacts): void {
  if (c.byteLength < 4) return;
  const profile = c[1] >> 5;
  const level = c[1] & 0x1f;
  const tier = c[2] >> 7;
  const high = (c[2] >> 6) & 1;
  const twelve = (c[2] >> 5) & 1;
  const depth = high ? (twelve ? 12 : 10) : 8;
  out.codecString = `av01.${profile}.${String(level).padStart(2, "0")}${tier ? "H" : "M"}.${String(depth).padStart(2, "0")}`;
  out.profile = (["Main", "High", "Professional"] as const)[profile] ?? null;
  out.bitDepth = depth;
}

function vp9Facts(c: Uint8Array, out: CodecFacts): void {
  // vpcC is a full box: version/flags first.
  if (c.byteLength < 7) return;
  const profile = c[4];
  const level = c[5];
  const depth = c[6] >> 4;
  out.codecString = `vp09.${String(profile).padStart(2, "0")}.${String(level).padStart(2, "0")}.${String(depth).padStart(2, "0")}`;
  out.profile = `Profile ${profile}`;
  out.bitDepth = depth || null;
}

// colr (nclx / nclc): matrix coefficients and, for nclx, the range flag. HEVC keeps its range in the
// SPS VUI, so without an nclx box its pixel format stays unknown.
function colorFacts(c: Uint8Array, out: CodecFacts, hevcChroma: number | undefined): void {
  if (c.byteLength < 10) return;
  const kind = String.fromCharCode(c[0], c[1], c[2], c[3]);
  if (kind !== "nclx" && kind !== "nclc") return;
  const matrix = (c[8] << 8) | c[9];
  out.colorSpace ??= COLOR_SPACES[matrix] ?? null;
  if (hevcChroma !== undefined && out.bitDepth !== null && kind === "nclx" && c.byteLength >= 11) {
    out.pixelFormat = pixelFormat(hevcChroma, out.bitDepth, (c[10] & 0x80) !== 0);
  }
}

function descriptor(b: Uint8Array, at: number): { tag: number; start: number; end: number } | null {
  if (at >= b.byteLength) return null;
  const tag = b[at++];
  let size = 0;
  for (let i = 0; i < 4 && at < b.byteLength; i++) {
    const x = b[at++];
    size = size * 128 + (x & 0x7f);
    if (!(x & 0x80)) break;
  }
  return { tag, start: at, end: Math.min(b.byteLength, at + size) };
}

// esds: the MPEG-4 elementary stream descriptor (after its version/flags).
function esdsFacts(c: Uint8Array, out: CodecFacts, audio: boolean): void {
  const es = descriptor(c, 4);
  if (!es || es.tag !== 0x03) return;
  let at = es.start + 2;
  const flags = c[at++];
  if (flags & 0x80) at += 2;
  if (flags & 0x40) at += 1 + c[at];
  if (flags & 0x20) at += 2;
  const dc = descriptor(c, at);
  if (!dc || dc.tag !== 0x04 || dc.end - dc.start < 13) return;
  const oti = c[dc.start];
  const other = (audio ? MPEG_AUDIO : MPEG_VIDEO)[oti];
  if (other) {
    [out.codec, out.codecLong] = other;
    out.codecString = `mp4${audio ? "a" : "v"}.${hex2(oti)}`;
    return;
  }
  if (!audio) {
    if (oti === 0x20) out.codecString = "mp4v.20";
    return;
  }
  const dsi = descriptor(c, dc.start + 13);
  if (oti !== 0x40 && oti !== 0x66 && oti !== 0x67 && oti !== 0x68) return;
  if (!dsi || dsi.tag !== 0x05) {
    out.codecString = `mp4a.${hex2(oti)}`;
    return;
  }
  try {
    const b = new Bits(c.subarray(dsi.start, dsi.end));
    const objectType = () => {
      const t = b.u(5);
      return t === 31 ? 32 + b.u(6) : t;
    };
    const rate = () => {
      const i = b.u(4);
      return i === 15 ? b.u(24) : (AAC_RATES[i] ?? null);
    };
    const aot = objectType();
    let sampleRate = rate();
    const config = b.u(4);
    // Explicit SBR/PS signalling: the stream decodes at the extension rate.
    if (aot === 5 || aot === 29) sampleRate = rate();
    out.codecString = `mp4a.${hex2(oti)}.${aot}`;
    out.profile = AAC_PROFILES[aot] ?? null;
    if (sampleRate) out.sampleRate = sampleRate;
    if (config > 0 && config < 8) out.channels = config === 7 ? 8 : config;
  } catch {
    out.codecString = `mp4a.${hex2(oti)}`;
  }
}

// `type` is the sample entry's four-character code; `boxes` its child boxes' payloads by type.
export function codecFacts(type: string, boxes: Map<string, Uint8Array>, audio: boolean): CodecFacts {
  const out = emptyCodecFacts();
  const named = NAMES[type];
  if (named) [out.codec, out.codecLong] = named;
  if (PRORES[type]) out.profile = PRORES[type];
  const avcC = boxes.get("avcC");
  const hvcC = boxes.get("hvcC");
  const av1C = boxes.get("av1C");
  const vpcC = boxes.get("vpcC");
  const esds = boxes.get("esds");
  const colr = boxes.get("colr");
  let hevcChroma: number | undefined;
  if ((type === "avc1" || type === "avc3") && avcC) avcFacts(type, avcC, out);
  else if ((type === "hvc1" || type === "hev1") && hvcC) hevcChroma = hevcFacts(type, hvcC, out);
  else if (type === "av01" && av1C) av1Facts(av1C, out);
  else if (type === "vp09" && vpcC) vp9Facts(vpcC, out);
  else if (esds) esdsFacts(esds, out, audio);
  if (colr) colorFacts(colr, out, hevcChroma);
  return out;
}
