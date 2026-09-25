import { describe, expect, it } from "vitest";
import { completeUtf8, decodeText } from "@/lib/server/storage/text";
import { toFileEntry } from "@/lib/server/storage/entry";
import {
  CursorSchema,
  KeySchema,
  LengthSchema,
  LimitSchema,
  OffsetSchema,
  PrefixSchema,
  TEXT_CHUNK_DEFAULT,
  TEXT_CHUNK_MAX,
} from "@/lib/server/validate";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("decodeText", () => {
  it("decodes UTF-8 and strips a BOM", () => {
    expect(decodeText(utf8("héllo"), false)).toBe("héllo");
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("x")]), false)).toBe("x");
  });

  it("drops a multi-byte character split by a truncated read", () => {
    const full = utf8("ab€"); // € is 3 bytes
    for (let cut = 3; cut < full.length; cut++) {
      expect(decodeText(full.subarray(0, cut), true)).toBe("ab");
    }
    const emoji = utf8("a🤖"); // 4 bytes
    for (let cut = 2; cut < emoji.length; cut++) expect(decodeText(emoji.subarray(0, cut), true)).toBe("a");
    expect(decodeText(emoji, true)).toBe("a🤖");
  });

  it("keeps a trailing replacement when the file itself is invalid and complete", () => {
    expect(decodeText(new Uint8Array([0x61, 0xe2, 0x82]), false)).toBe("a�");
  });

  it("decodes UTF-16 with a BOM", () => {
    const le = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    expect(decodeText(le, false)).toBe("hi");
    expect(decodeText(le.subarray(0, 5), true)).toBe("h");
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
    expect(decodeText(be, false)).toBe("hi");
  });

  it("completeUtf8 leaves complete input alone", () => {
    const b = utf8("plain");
    expect(completeUtf8(b)).toBe(b);
    expect(completeUtf8(new Uint8Array())).toHaveLength(0);
    // A lone continuation byte run with no lead is left for the decoder.
    expect(completeUtf8(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80]))).toHaveLength(5);
  });
});

describe("toFileEntry", () => {
  it("fills in kind, type and dates", () => {
    expect(toFileEntry("Factory/ep.MP4", 10, new Date("2026-01-01T00:00:00Z"))).toEqual({
      key: "Factory/ep.MP4",
      name: "ep.MP4",
      ext: "mp4",
      kind: "video",
      type: "MP4",
      size: 10,
      modified: "2026-01-01T00:00:00.000Z",
    });
    expect(toFileEntry("x", 0, undefined).modified).toBeNull();
  });
});

describe("request schemas", () => {
  it("validates keys", () => {
    expect(KeySchema.safeParse("Factory/a b#?.mp4").success).toBe(true);
    expect(KeySchema.safeParse("").success).toBe(false);
    expect(KeySchema.safeParse(undefined).success).toBe(false);
    expect(KeySchema.safeParse("a\u0000b").success).toBe(false);
    expect(KeySchema.safeParse("x".repeat(1024)).success).toBe(true);
    expect(KeySchema.safeParse("x".repeat(1025)).success).toBe(false);
    // 1024 bytes, not characters: 342 × 3-byte chars = 1026 bytes.
    expect(KeySchema.safeParse("€".repeat(342)).success).toBe(false);
  });

  it("normalizes prefixes", () => {
    expect(PrefixSchema.parse(undefined)).toBe("");
    expect(PrefixSchema.parse("/Factory//episodes")).toBe("Factory/episodes/");
    expect(PrefixSchema.safeParse("a\u0000").success).toBe(false);
    expect(PrefixSchema.safeParse("x".repeat(2000)).success).toBe(false);
  });

  it("bounds the list limit", () => {
    expect(LimitSchema.parse(undefined)).toBe(1000);
    expect(LimitSchema.parse("")).toBe(1000);
    expect(LimitSchema.parse("1")).toBe(1);
    expect(LimitSchema.parse("5000")).toBe(5000);
    for (const bad of ["0", "5001", "-5", "2.5", "abc", "1e3", " 7"]) expect(LimitSchema.safeParse(bad).success).toBe(false);
  });

  it("validates cursors, offsets and lengths", () => {
    expect(CursorSchema.parse(undefined)).toBeNull();
    expect(CursorSchema.parse("")).toBeNull();
    expect(CursorSchema.parse("abc_-.def")).toBe("abc_-.def");
    for (const bad of ["no-dot", "a.b.c", "a b.c", `${"a".repeat(4096)}.b`]) expect(CursorSchema.safeParse(bad).success).toBe(false);

    expect(OffsetSchema.parse(undefined)).toBe(0);
    expect(OffsetSchema.parse("123")).toBe(123);
    for (const bad of ["-1", "1.5", "9007199254740993", "x"]) expect(OffsetSchema.safeParse(bad).success).toBe(false);

    expect(LengthSchema.parse(undefined)).toBe(TEXT_CHUNK_DEFAULT);
    expect(LengthSchema.parse(String(TEXT_CHUNK_MAX))).toBe(4 * 1024 * 1024);
    for (const bad of ["0", String(TEXT_CHUNK_MAX + 1)]) expect(LengthSchema.safeParse(bad).success).toBe(false);
  });
});
