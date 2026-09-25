import { afterEach, describe, expect, it, vi } from "vitest";
import { EXPIRY_OPTIONS, expiryLabel, formatBytes, formatDate, formatDateTime, formatRelative, plural } from "@/lib/format";

describe("formatBytes", () => {
  it("uses decimal units with one fraction digit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1500)).toBe("1.5 kB");
    expect(formatBytes(3_205_568)).toBe("3.2 MB");
    expect(formatBytes(5 * 1000 ** 4)).toBe("5 TB");
  });
});

describe("dates", () => {
  afterEach(() => vi.useRealTimers());
  const iso = "2026-03-14T12:30:00.000Z";

  it("returns empty text for unknown dates", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDateTime(null)).toBe("");
    expect(formatRelative(null)).toBe("");
  });

  it("formats absolute dates", () => {
    expect(formatDate(iso)).toMatch(/^Mar 14, 2026$/);
    expect(formatDateTime(iso)).toMatch(/^Mar 14, 2026, \d{1,2}:30 (AM|PM)$/);
  });

  it("formats relative dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T15:30:00.000Z"));
    expect(formatRelative(iso)).toBe("about 3 hours ago");
  });
});

describe("plural", () => {
  it("picks the singular only for exactly one", () => {
    expect(plural(0, "file")).toBe("0 files");
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(2, "folder")).toBe("2 folders");
    expect(plural(1234, "entry", "entries")).toBe("1,234 entries");
  });
});

describe("expiryLabel", () => {
  it("names each offered expiry", () => {
    for (const o of EXPIRY_OPTIONS) expect(expiryLabel(o.seconds)).toBe(o.label);
    expect(expiryLabel(604800)).toBe("7 days");
  });

  it("falls back to minutes", () => {
    expect(expiryLabel(900)).toBe("15 minutes");
  });
});
