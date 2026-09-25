import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  effectiveContentType,
  isActiveContentType,
  isGenericContentType,
  isSafeContentType,
  parseRange,
  textResponse,
} from "@/lib/server/http";

describe("contentDisposition", () => {
  it("keeps plain ASCII names as a quoted filename", () => {
    expect(contentDisposition("attachment", "episode_0001.mp4")).toBe('attachment; filename="episode_0001.mp4"');
    expect(contentDisposition("inline", "a b.pdf")).toBe('inline; filename="a b.pdf"');
  });

  it("adds an RFC 5987 filename* for unicode names", () => {
    const v = contentDisposition("attachment", "файл 🤖.json");
    expect(v).toBe(`attachment; filename="____ _.json"; filename*=UTF-8''${encodeURIComponent("файл 🤖.json")}`);
    const star = v.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(star)).toBe("файл 🤖.json");
  });

  it("escapes quotes, backslashes and percent signs", () => {
    const v = contentDisposition("attachment", 'say "hi"\\100%.txt');
    expect(v).toContain('filename="say _hi__100_.txt"');
    expect(decodeURIComponent(v.split("''")[1])).toBe('say "hi"\\100%.txt');
  });

  it("encodes the characters RFC 5987 forbids in attr-char", () => {
    const v = contentDisposition("inline", "it's (1)*é.txt");
    expect(v.split("''")[1]).toBe("it%27s%20%281%29%2A%C3%A9.txt");
    expect(contentDisposition("inline", "it's (1)*.txt")).toBe(`inline; filename="it's (1)*.txt"`);
  });

  it("drops control characters that would break the header", () => {
    const v = contentDisposition("attachment", "evil\r\nSet-Cookie: x.txt");
    expect(v).not.toMatch(/[\r\n]/);
    expect(() => new Headers({ "Content-Disposition": v })).not.toThrow();
    expect(contentDisposition("attachment", "")).toBe('attachment; filename="download"');
  });
});

describe("content types", () => {
  it("recognizes generic stored types", () => {
    expect(isGenericContentType("binary/octet-stream")).toBe(true);
    expect(isGenericContentType("application/octet-stream; charset=binary")).toBe(true);
    expect(isGenericContentType("")).toBe(true);
    expect(isGenericContentType(undefined)).toBe(true);
    expect(isGenericContentType("video/mp4")).toBe(false);
  });

  it("guesses from the name only when the stored type is generic", () => {
    expect(effectiveContentType("a.mp4", "binary/octet-stream")).toBe("video/mp4");
    expect(effectiveContentType("a.mp4", "video/quicktime")).toBe("video/quicktime");
    expect(effectiveContentType("a.unknownext", "")).toBeUndefined();
  });

  it("flags types that run as pages", () => {
    for (const t of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/javascript"]) {
      expect(isActiveContentType(t)).toBe(true);
    }
    for (const t of ["text/plain", "image/png", "application/json", "video/mp4", "application/pdf"]) {
      expect(isActiveContentType(t)).toBe(false);
    }
  });

  it("accepts only well-formed content types", () => {
    expect(isSafeContentType("application/pdf")).toBe(true);
    expect(isSafeContentType("text/plain; charset=utf-8")).toBe(true);
    expect(isSafeContentType("text/html\r\nX: y")).toBe(false);
    expect(isSafeContentType("nonsense")).toBe(false);
    expect(isSafeContentType(`a/${"b".repeat(300)}`)).toBe(false);
  });
});

describe("parseRange", () => {
  it.each([
    [null, 100, null],
    ["", 100, null],
    ["bytes=0-9", 100, { start: 0, end: 9 }],
    ["bytes=10-", 100, { start: 10, end: 99 }],
    ["bytes=90-500", 100, { start: 90, end: 99 }],
    ["bytes=-10", 100, { start: 90, end: 99 }],
    ["bytes=-500", 100, { start: 0, end: 99 }],
    ["bytes=99-99", 100, { start: 99, end: 99 }],
    ["bytes=100-", 100, "unsatisfiable"],
    ["bytes=500-600", 100, "unsatisfiable"],
    ["bytes=-0", 100, "unsatisfiable"],
    ["bytes=0-", 0, "unsatisfiable"],
    ["bytes=-5", 0, "unsatisfiable"],
    ["bytes=5-2", 100, null],
    ["bytes=-", 100, null],
    ["bytes=0-1,5-6", 100, null],
    ["items=0-5", 100, null],
    ["bytes=abc", 100, null],
  ] as const)("%j of %d bytes", (header, size, out) => {
    expect(parseRange(header, size)).toEqual(out);
  });
});

describe("textResponse", () => {
  it("is uncached plain text", async () => {
    const r = textResponse("nope", 404, { "X-Extra": "1" });
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-extra")).toBe("1");
    expect(await r.text()).toBe("nope");
  });
});
