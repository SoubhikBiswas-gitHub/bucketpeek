import { describe, expect, it } from "vitest";
import { EXPIRY_OPTIONS } from "@/lib/format";
import { DEFAULT_LINK_LIFETIME, isLinkLifetime, LINK_LIFETIME_MESSAGE, worksUntil } from "@/lib/link-expiry";

describe("worksUntil", () => {
  it("shows UTC on a 24-hour clock and Indian time (UTC+5:30) on a 12-hour one", () => {
    const w = worksUntil(new Date("2026-09-25T06:00:00Z"), new Date("2026-09-25T05:00:00Z"));
    expect(w.utc).toBe("25 Sep 2026, 06:00 UTC");
    expect(w.ist).toBe("25 Sep 2026, 11:30 AM IST");
    expect(w.both).toBe("25 Sep 2026, 06:00 UTC · 25 Sep 2026, 11:30 AM IST");
    expect(w.short).toBe("11:30 AM IST");
  });

  it("handles afternoons and the half hour", () => {
    const w = worksUntil(new Date("2026-09-25T11:30:00Z"));
    expect(w.utc).toBe("25 Sep 2026, 11:30 UTC");
    expect(w.ist).toBe("25 Sep 2026, 5:00 PM IST");
  });

  it("moves Indian time to the next day past 18:30 UTC", () => {
    const w = worksUntil(new Date("2026-09-25T20:15:00Z"), new Date("2026-09-25T10:00:00Z"));
    expect(w.utc).toBe("25 Sep 2026, 20:15 UTC");
    expect(w.ist).toBe("26 Sep 2026, 1:45 AM IST");
    // A different Indian day, so the short form names it.
    expect(w.short).toBe("26 Sep, 1:45 AM IST");
  });

  it("shows midnight and noon unambiguously", () => {
    expect(worksUntil(new Date("2026-10-01T18:30:00Z")).ist).toBe("2 Oct 2026, 12:00 AM IST");
    expect(worksUntil(new Date("2026-10-02T06:30:00Z")).ist).toBe("2 Oct 2026, 12:00 PM IST");
    expect(worksUntil(new Date("2026-10-02T00:05:00Z")).utc).toBe("2 Oct 2026, 00:05 UTC");
  });

  it("crosses a year end", () => {
    const w = worksUntil(new Date("2026-12-31T19:00:00Z"));
    expect(w.utc).toBe("31 Dec 2026, 19:00 UTC");
    expect(w.ist).toBe("1 Jan 2027, 12:30 AM IST");
  });
});

describe("link lifetimes", () => {
  it("accepts only the offered choices", () => {
    for (const o of EXPIRY_OPTIONS) expect(isLinkLifetime(o.seconds)).toBe(true);
    for (const v of [0, 60, 3599, 7200, 604801, "3600", null, undefined, 3600.5]) expect(isLinkLifetime(v)).toBe(false);
  });

  it("defaults to an hour", () => {
    expect(DEFAULT_LINK_LIFETIME).toBe(3600);
  });

  it("lists the choices in its message", () => {
    expect(LINK_LIFETIME_MESSAGE).toBe("Links can work for 1 hour, 6 hours, 24 hours or 7 days.");
  });
});
