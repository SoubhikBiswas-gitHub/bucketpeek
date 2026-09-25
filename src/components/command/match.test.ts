import { describe, expect, it } from "vitest";
import { matchRanges, parseQuery, rank } from "./match";

const ctx = { bucket: "deccan-physical-ai-corpus", currentPrefix: "Factory/annotated/" };

describe("parseQuery", () => {
  it("treats empty input as the default view", () => {
    expect(parseQuery("   ", ctx)).toEqual({ mode: "default" });
  });

  it("searches the current folder when there is no slash", () => {
    expect(parseQuery("epi", ctx)).toEqual({ mode: "search", term: "epi" });
  });

  it("reads paths from the bucket root", () => {
    expect(parseQuery("Factory/epi", ctx)).toEqual({ mode: "path", prefix: "Factory/", term: "epi" });
    expect(parseQuery("Factory/", ctx)).toEqual({ mode: "path", prefix: "Factory/", term: "" });
    expect(parseQuery("/", ctx)).toEqual({ mode: "path", prefix: "", term: "" });
    expect(parseQuery("//Factory//episodes/ep", ctx)).toEqual({ mode: "path", prefix: "Factory/episodes/", term: "ep" });
  });

  it("resolves ./ and ../ against the current folder", () => {
    expect(parseQuery("../", ctx)).toEqual({ mode: "path", prefix: "Factory/", term: "" });
    expect(parseQuery("../../Construction/cr", ctx)).toEqual({ mode: "path", prefix: "Construction/", term: "cr" });
    expect(parseQuery("./fr", ctx)).toEqual({ mode: "path", prefix: "Factory/annotated/", term: "fr" });
    expect(parseQuery("../../../../", ctx)).toEqual({ mode: "path", prefix: "", term: "" });
  });

  it("accepts s3:// URIs for the connected bucket only", () => {
    expect(parseQuery("s3://deccan-physical-ai-corpus/Factory/README.md", ctx)).toEqual({
      mode: "path",
      prefix: "Factory/",
      term: "README.md",
    });
    expect(parseQuery("s3://deccan-physical-ai-corpus", ctx)).toEqual({ mode: "path", prefix: "", term: "" });
    expect(parseQuery("s3://other-bucket/a/b", ctx)).toEqual({ mode: "foreign", bucket: "other-bucket" });
  });

  it("keeps unicode and spaces in names", () => {
    expect(parseQuery("Données brutes/épisode 1", ctx)).toEqual({ mode: "path", prefix: "Données brutes/", term: "épisode 1" });
  });
});

describe("rank", () => {
  const names = ["raw_episodes_index.csv", "episode_0001_pick_and_place.mp4", "episodes", "capture.log", "README.md"];

  it("drops non-matches and puts prefix matches first", () => {
    const out = rank(names, "epi", (n) => n);
    expect(out).not.toContain("capture.log");
    expect(out.slice(0, 2)).toEqual(["episode_0001_pick_and_place.mp4", "episodes"]);
    expect(out).toContain("raw_episodes_index.csv");
  });

  it("ranks an exact name above everything", () => {
    expect(rank(names, "episodes", (n) => n)[0]).toBe("episodes");
  });

  it("drops scattered letters when a name contains the term", () => {
    expect(rank(["frame_0001.png", "episodes", "load_index.py"], "ep", (n) => n)).toEqual(["episodes"]);
  });

  it("keeps fuzzy abbreviations when nothing matches better", () => {
    expect(rank(["frame_0001.png", "capture.log"], "frm", (n) => n)).toEqual(["frame_0001.png"]);
  });

  it("returns everything, in order, for an empty term", () => {
    expect(rank(names, "", (n) => n)).toEqual(names);
  });
});

describe("matchRanges", () => {
  it("highlights a substring", () => {
    expect(matchRanges("raw_episodes_index.csv", "EPI")).toEqual([[4, 7]]);
  });

  it("falls back to a subsequence", () => {
    expect(matchRanges("episode_0001_pick.mp4", "e1p")).toEqual([
      [0, 1],
      [11, 12],
      [13, 14],
    ]);
  });

  it("returns nothing when the letters are absent", () => {
    expect(matchRanges("capture.log", "xyz")).toEqual([]);
  });
});
