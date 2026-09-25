/**
 * Decodes the first bytes of a file as text.
 *
 * - Honors UTF-8 and UTF-16 byte order marks (UTF-8 otherwise).
 * - When the read was cut short (`truncated`), drops a multi-byte character split by the cut,
 *   so the preview doesn't end in a replacement character.
 */
export function decodeText(bytes: Uint8Array, truncated: boolean): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(evenLength(bytes, truncated));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(evenLength(bytes, truncated));
  }
  return new TextDecoder("utf-8").decode(truncated ? completeUtf8(bytes) : bytes);
}

function evenLength(bytes: Uint8Array, truncated: boolean): Uint8Array {
  return truncated && bytes.length % 2 ? bytes.subarray(0, bytes.length - 1) : bytes;
}

/** Bytes up to the last complete UTF-8 sequence. */
export function completeUtf8(bytes: Uint8Array): Uint8Array {
  const n = bytes.length;
  // A sequence is at most 4 bytes, so its lead byte is within the last 4.
  for (let i = n - 1; i >= Math.max(0, n - 4); i--) {
    const b = bytes[i];
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    const need = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return i + need > n ? bytes.subarray(0, i) : bytes;
  }
  return bytes;
}
