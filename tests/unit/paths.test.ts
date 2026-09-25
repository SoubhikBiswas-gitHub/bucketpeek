import { describe, expect, it } from "vitest";
import { browseHref, crumbsOf, downloadHref, folderOf, normalizePrefix, openHref, parentOf, thumbHref, viewHref } from "@/lib/paths";

const param = (href: string, name: string) => new URL(href, "http://lens.local").searchParams.get(name);

const TRICKY_KEYS = [
  "Factory/episode 0001.mp4",
  "Factory/ünïcødé/файл.json",
  "a/b#c.txt",
  "a/b?c=d&e=f.txt",
  "a/1+1=2.csv",
  "a/100%/done.txt",
  "emoji/🤖 robot.png",
  "a//double/slash.txt",
  " leading and trailing ",
];

describe("href builders", () => {
  it.each(TRICKY_KEYS)("round-trips %j through the query string", (key) => {
    expect(param(viewHref(key), "key")).toBe(key);
    expect(param(openHref(key), "key")).toBe(key);
    expect(param(downloadHref(key), "key")).toBe(key);
    expect(param(browseHref(key), "prefix")).toBe(key);
    expect(param(thumbHref(key, key), "key")).toBe(key);
    expect(param(thumbHref(key, key), "v")).toBe(key);
  });

  it("uses the right routes", () => {
    expect(browseHref()).toBe("/browse");
    expect(browseHref("")).toBe("/browse");
    expect(browseHref("Factory/")).toBe("/browse?prefix=Factory%2F");
    expect(viewHref("a b")).toBe("/view?key=a%20b");
    expect(openHref("x")).toBe("/api/files/open?key=x");
    expect(downloadHref("x")).toBe("/api/files/download?key=x");
    expect(thumbHref("x", "10:2026-01-01T00:00:00Z")).toBe("/api/thumb?key=x&v=10%3A2026-01-01T00%3A00%3A00Z");
  });

  it("never lets # or ? escape the parameter", () => {
    expect(openHref("a#b?c")).not.toMatch(/[#]|\?.*\?/);
  });
});

describe("normalizePrefix", () => {
  it.each([
    [null, ""],
    [undefined, ""],
    ["", ""],
    ["/", ""],
    ["///", ""],
    ["Factory", "Factory/"],
    ["Factory/", "Factory/"],
    ["/Factory//episodes/", "Factory/episodes/"],
    ["a/b/c", "a/b/c/"],
    ["ünï/файл", "ünï/файл/"],
    ["with space/x", "with space/x/"],
  ])("%j → %j", (input, out) => {
    expect(normalizePrefix(input)).toBe(out);
  });

  it("is idempotent", () => {
    for (const p of ["a", "/a//b", "", "x/y/"]) expect(normalizePrefix(normalizePrefix(p))).toBe(normalizePrefix(p));
  });
});

describe("crumbsOf / parentOf / folderOf", () => {
  it("builds one crumb per segment", () => {
    expect(crumbsOf("")).toEqual([]);
    expect(crumbsOf("Factory/episodes/")).toEqual([
      { name: "Factory", prefix: "Factory/" },
      { name: "episodes", prefix: "Factory/episodes/" },
    ]);
    expect(crumbsOf("ünï/a b/")).toEqual([
      { name: "ünï", prefix: "ünï/" },
      { name: "a b", prefix: "ünï/a b/" },
    ]);
  });

  it("finds the parent prefix", () => {
    expect(parentOf("")).toBe("");
    expect(parentOf("Factory/")).toBe("");
    expect(parentOf("Factory/episodes/")).toBe("Factory/");
    expect(parentOf("a/b/c/")).toBe("a/b/");
  });

  it("finds the folder of a key", () => {
    expect(folderOf("top.txt")).toBe("");
    expect(folderOf("Factory/README.md")).toBe("Factory/");
    expect(folderOf("a/b/c.txt")).toBe("a/b/");
    expect(folderOf("a/b/")).toBe("a/b/");
  });
});
