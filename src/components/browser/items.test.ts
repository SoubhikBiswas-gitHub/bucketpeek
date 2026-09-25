import { describe, expect, it } from "vitest";
import type { FileEntry, Listing } from "@/lib/types";
import { kindOf, typeLabel } from "@/lib/kinds";
import {
  filterItems,
  folderHref,
  groupCounts,
  matchParts,
  parseParams,
  rangeIds,
  searchFor,
  sortItems,
  toItems,
} from "./items";
import { nextIndex } from "./use-roving";

function file(key: string, size = 0, modified: string | null = "2026-01-01T00:00:00Z"): FileEntry {
  const name = key.slice(key.lastIndexOf("/") + 1);
  return { key, name, ext: name.split(".").pop() ?? "", kind: kindOf(key), type: typeLabel(key), size, modified };
}

const listing: Listing = {
  prefix: "Factory/",
  truncated: false,
  folders: [
    { name: "episodes", prefix: "Factory/episodes/" },
    { name: "annotated", prefix: "Factory/annotated/" },
  ],
  files: [
    file("Factory/episode_10.mp4", 300, "2026-03-01T00:00:00Z"),
    file("Factory/episode_2.mp4", 100, "2026-01-01T00:00:00Z"),
    file("Factory/Episode_1.mp4", 200, null),
    file("Factory/README.md", 50, "2026-02-01T00:00:00Z"),
    file("Factory/frame.png", 400, "2026-04-01T00:00:00Z"),
  ],
};

const names = (items: ReturnType<typeof toItems>) => items.map((i) => i.name);

describe("sortItems", () => {
  const items = toItems(listing);

  it("sorts names naturally with folders first", () => {
    expect(names(sortItems(items, "name", "asc"))).toEqual([
      "annotated",
      "episodes",
      "Episode_1.mp4",
      "episode_2.mp4",
      "episode_10.mp4",
      "frame.png",
      "README.md",
    ]);
  });

  it("keeps folders first when descending", () => {
    const out = names(sortItems(items, "name", "desc"));
    expect(out.slice(0, 2)).toEqual(["episodes", "annotated"]);
    expect(out[2]).toBe("README.md");
  });

  it("sorts by size and keeps folders on top", () => {
    expect(names(sortItems(items, "size", "desc")).slice(0, 4)).toEqual(["annotated", "episodes", "frame.png", "episode_10.mp4"]);
  });

  it("puts files without a date last in both directions", () => {
    expect(names(sortItems(items, "modified", "desc")).at(-1)).toBe("Episode_1.mp4");
    expect(names(sortItems(items, "modified", "asc")).at(-1)).toBe("Episode_1.mp4");
  });
});

describe("filterItems", () => {
  const items = toItems(listing);

  it("matches case-insensitively, including folders", () => {
    expect(names(filterItems(items, "EPIS", "all"))).toEqual(["episodes", "episode_10.mp4", "episode_2.mp4", "Episode_1.mp4"]);
  });

  it("hides folders when a type is chosen", () => {
    expect(names(filterItems(items, "", "video"))).toHaveLength(3);
    expect(names(filterItems(items, "", "image"))).toEqual(["frame.png"]);
  });

  it("normalizes unicode", () => {
    const u = toItems({ ...listing, folders: [], files: [file("x/Ｆｕｌｌｗｉｄｔｈ.txt")] });
    expect(filterItems(u, "fullwidth", "all")).toHaveLength(1);
  });

  it("counts files per group", () => {
    const c = groupCounts(items);
    expect(c.video).toBe(3);
    expect(c.image).toBe(1);
    expect(c.document).toBe(1);
  });
});

describe("URL state", () => {
  it("parses defaults and ignores junk", () => {
    expect(parseParams(new URLSearchParams("sort=bogus&type=nope&view=table"))).toEqual({
      q: "",
      type: "all",
      sort: "name",
      dir: "asc",
      view: "list",
    });
  });

  it("uses each column's natural direction", () => {
    expect(parseParams(new URLSearchParams("sort=size")).dir).toBe("desc");
  });

  it("omits defaults when serializing", () => {
    expect(searchFor("a/", { sort: "size", dir: "desc", view: "grid", q: " x ", type: "all" })).toBe(
      "?prefix=a%2F&q=x&sort=size&view=grid",
    );
    expect(folderHref("", { sort: "name", dir: "asc", view: "list" })).toBe("/browse");
  });
});

describe("matchParts", () => {
  it("splits around the first match", () => {
    expect(matchParts("episode_0001.mp4", "0001")).toEqual(["episode_", "0001", ".mp4"]);
    expect(matchParts("abc", "")).toBeNull();
    expect(matchParts("abc", "z")).toBeNull();
  });
});

describe("nextIndex", () => {
  const ctx = { index: 5, count: 12, cols: 4, page: 8 };
  it("moves by rows and columns in a grid", () => {
    expect(nextIndex("ArrowDown", ctx)).toBe(9);
    expect(nextIndex("ArrowUp", ctx)).toBe(1);
    expect(nextIndex("ArrowRight", ctx)).toBe(6);
    expect(nextIndex("ArrowDown", { ...ctx, index: 10 })).toBe(11);
    expect(nextIndex("End", ctx)).toBe(11);
    expect(nextIndex("Home", ctx)).toBe(0);
  });
  it("ignores left and right in a list", () => {
    expect(nextIndex("ArrowRight", { ...ctx, cols: 1 })).toBeNull();
  });
});

describe("rangeIds", () => {
  const items = sortItems(toItems(listing), "name", "asc");
  const ids = items.map((i) => i.id);

  it("selects everything between the anchor and the clicked item, either direction", () => {
    expect(rangeIds(items, ids[1], ids[4])).toEqual(ids.slice(1, 5));
    expect(rangeIds(items, ids[4], ids[1])).toEqual(ids.slice(1, 5));
    expect(rangeIds(items, ids[2], ids[2])).toEqual([ids[2]]);
  });

  it("falls back to the clicked item when there is no anchor, or it's filtered out", () => {
    expect(rangeIds(items, null, ids[3])).toEqual([ids[3]]);
    expect(rangeIds(items, "Factory/gone.mp4", ids[3])).toEqual([ids[3]]);
    expect(rangeIds(items, ids[0], "Factory/gone.mp4")).toEqual([]);
  });
});
