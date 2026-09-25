// The MP4 layouts playable.ts fixes, made from a healthy ffmpeg output.

const text = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at + 4, at + 8));

// Inserts `count` 8-byte free boxes after the ftyp, like recorders that reserve space, fixing chunk offsets.
export function scatter(src: Uint8Array, count: number): Uint8Array {
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const ftypEnd = v.getUint32(0);
  const pad = new Uint8Array(count * 8);
  const pv = new DataView(pad.buffer);
  for (let i = 0; i < count; i++) {
    pv.setUint32(i * 8, 8);
    pad.set([0x66, 0x72, 0x65, 0x65], i * 8 + 4);
  }
  const out = new Uint8Array(src.byteLength + pad.byteLength);
  out.set(src.subarray(0, ftypEnd));
  out.set(pad, ftypEnd);
  out.set(src.subarray(ftypEnd), ftypEnd + pad.byteLength);
  // Every stco entry moves by the padding (ffmpeg writes 32-bit tables for small files).
  const ov = new DataView(out.buffer);
  for (let i = 4; i + 8 < out.byteLength; i++) {
    if (out[i] !== 0x73 || text(out, i - 4) !== "stco") continue;
    const at = i - 4;
    const n = ov.getUint32(at + 12);
    for (let k = 0; k < n; k++) ov.setUint32(at + 16 + 4 * k, ov.getUint32(at + 16 + 4 * k) + pad.byteLength);
  }
  return out;
}

// The de-identification damage: junk bytes inserted at the start of the media data and as many dropped
// further on, with the index unchanged. Early chunks then read junk; late ones are right.
export function shiftedStart(src: Uint8Array, junk: number, dropAt: number): Uint8Array {
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let at = 0;
  let mdat = -1;
  while (at + 8 <= src.byteLength) {
    const size = v.getUint32(at);
    if (text(src, at) === "mdat") mdat = at;
    at += size;
  }
  const payload = mdat + 8;
  const noise = new Uint8Array(junk);
  for (let i = 0; i < junk; i++) noise[i] = (i * 2654435761) >>> 24;
  const out = new Uint8Array(src.byteLength);
  out.set(src.subarray(0, payload));
  out.set(noise, payload);
  out.set(src.subarray(payload, dropAt), payload + junk);
  out.set(src.subarray(dropAt + junk), dropAt + junk);
  return out;
}
