import { describe, expect, it } from "vitest";
import {
  bareEtag,
  encryptionLabel,
  flattenJson,
  formatBitrate,
  formatChannels,
  formatDuration,
  formatFrameRate,
  formatLevel,
  formatSampleRate,
  formatSeconds,
  healthSummary,
  parseRational,
  sidecarKey,
  toNumber,
} from "@/lib/file-details";

describe("number formatting", () => {
  it("reads ffprobe's number strings", () => {
    expect(toNumber("8.000000")).toBe(8);
    expect(toNumber("2790315")).toBe(2790315);
    expect(toNumber(31)).toBe(31);
    expect(toNumber("N/A")).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });

  it("parses frame-rate rationals", () => {
    expect(parseRational("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseRational("25/1")).toBe(25);
    expect(parseRational("30")).toBe(30);
    expect(parseRational("0/0")).toBeNull();
    expect(parseRational("1/0")).toBeNull();
    expect(parseRational("abc")).toBeNull();
    expect(parseRational(null)).toBeNull();
  });

  it("formats frame rates", () => {
    expect(formatFrameRate("30000/1001")).toBe("29.97 fps");
    expect(formatFrameRate("24000/1001")).toBe("23.976 fps");
    expect(formatFrameRate("30/1")).toBe("30 fps");
    expect(formatFrameRate("0/0")).toBeNull();
  });

  it("formats durations as h:mm:ss", () => {
    expect(formatDuration(8)).toBe("0:00:08");
    expect(formatDuration(59.6)).toBe("0:01:00");
    expect(formatDuration(3723.4)).toBe("1:02:03");
    expect(formatDuration(40 * 3600 + 5)).toBe("40:00:05");
    expect(formatDuration(0)).toBe("0:00:00");
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(null)).toBeNull();
    expect(formatSeconds(8)).toBe("8");
    expect(formatSeconds(3723.456789)).toBe("3723.457");
  });

  it("formats bitrates in decimal units", () => {
    expect(formatBitrate(2927613)).toBe("2.93 Mb/s");
    expect(formatBitrate(127001)).toBe("127 kb/s");
    expect(formatBitrate(1_500_000_000)).toBe("1.5 Gb/s");
    expect(formatBitrate(950)).toBe("950 b/s");
    expect(formatBitrate(0)).toBeNull();
    expect(formatBitrate(null)).toBeNull();
  });

  it("formats audio facts", () => {
    expect(formatSampleRate(48000)).toBe("48 kHz");
    expect(formatSampleRate(44100)).toBe("44.1 kHz");
    expect(formatSampleRate(null)).toBeNull();
    expect(formatChannels(1, "mono")).toBe("1 (mono)");
    expect(formatChannels(6, null)).toBe("6");
    expect(formatChannels(null, "stereo")).toBe("stereo");
  });

  it("writes codec levels the way people say them", () => {
    expect(formatLevel("h264", 31)).toBe("3.1");
    expect(formatLevel("h264", 40)).toBe("4");
    expect(formatLevel("hevc", 93)).toBe("3.1");
    expect(formatLevel("hevc", 150)).toBe("5");
    expect(formatLevel("vp9", 3)).toBe("3");
    expect(formatLevel("h264", -99)).toBeNull();
  });
});

describe("S3 labels", () => {
  it("names encryption like the console", () => {
    expect(encryptionLabel("AES256")).toBe("SSE-S3 (AES256)");
    expect(encryptionLabel("aws:kms")).toBe("SSE-KMS (aws:kms)");
    expect(encryptionLabel("something-new")).toBe("something-new");
  });

  it("unquotes ETags", () => {
    expect(bareEtag('"9b2cf535f27731c974343645a3985328"')).toBe("9b2cf535f27731c974343645a3985328");
    expect(bareEtag('W/"abc-3"')).toBe("abc-3");
    expect(bareEtag("plain")).toBe("plain");
  });
});

describe("sidecarKey", () => {
  it("puts <name>_METADATA.json next to the file", () => {
    expect(sidecarKey("Episodes/A36_2026_002.mp4")).toBe("Episodes/A36_2026_002_METADATA.json");
    expect(sidecarKey("clip.tar.gz")).toBe("clip.tar_METADATA.json");
    expect(sidecarKey("a/b/LICENSE")).toBe("a/b/LICENSE_METADATA.json");
    expect(sidecarKey("a/.env")).toBe("a/.env_METADATA.json");
  });

  it("has none for a sidecar itself", () => {
    expect(sidecarKey("Episodes/A36_2026_002_METADATA.json")).toBeNull();
    expect(sidecarKey("x/y_metadata.JSON")).toBeNull();
  });
});

describe("flattenJson", () => {
  it("joins nested object keys with ›", () => {
    const { rows, truncated } = flattenJson({
      episode: "A36",
      "Data Info": { duration_sec: 812.5, fps: 30, camera: { model: "GoPro", serial: null } },
      ok: true,
    });
    expect(truncated).toBe(false);
    expect(rows).toEqual([
      { label: "episode", value: "A36" },
      { label: "Data Info › duration_sec", value: "812.5" },
      { label: "Data Info › fps", value: "30" },
      { label: "Data Info › camera › model", value: "GoPro" },
      { label: "Data Info › camera › serial", value: "null" },
      { label: "ok", value: "true" },
    ]);
  });

  it("joins plain arrays and numbers arrays of objects", () => {
    expect(flattenJson({ tags: ["a", 1, false], empty: [], obj: {}, items: [{ n: "x" }, { n: "y" }] }).rows).toEqual([
      { label: "tags", value: "a, 1, false" },
      { label: "empty", value: "[]" },
      { label: "obj", value: "{}" },
      { label: "items › 1 › n", value: "x" },
      { label: "items › 2 › n", value: "y" },
    ]);
  });

  it("labels a bare value and stops at the limit", () => {
    expect(flattenJson(42).rows).toEqual([{ label: "Value", value: "42" }]);
    const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
    const { rows, truncated } = flattenJson(big, 5);
    expect(rows).toHaveLength(5);
    expect(truncated).toBe(true);
  });
});

describe("healthSummary", () => {
  const mp4 = { ext: "mp4", modified: "2026-09-01T00:00:00.000Z" };
  const done = { status: "done" as const, startedAt: "2026-09-10T00:00:00.000Z", finishedAt: "2026-09-10T00:05:00.000Z" };

  it("reports a file the check passed", () => {
    expect(healthSummary({ ...done, problem: null }, mp4)).toMatchObject({ label: "Plays fine", tone: "ok" });
    expect(healthSummary({ ...done, problem: null }, { ...mp4, ext: "avi" })).toMatchObject({ label: "Not empty", tone: "ok" });
  });

  it("names the problem it found", () => {
    const problem = (kind: "empty" | "repairable" | "damaged") => ({ key: "a.mp4", size: 1, kind, detail: `why ${kind}` });
    expect(healthSummary({ ...done, problem: problem("repairable") }, mp4)).toEqual({
      label: "Repaired when played",
      detail: "why repairable",
      tone: "warn",
    });
    expect(healthSummary({ ...done, problem: problem("empty") }, mp4)).toMatchObject({ label: "Empty", tone: "bad" });
    expect(healthSummary({ ...done, problem: problem("damaged") }, mp4)).toMatchObject({ label: "Damaged", tone: "bad" });
  });

  it("says not checked when there's no report or the file changed since", () => {
    expect(healthSummary({ status: "none" }, mp4).label).toBe("Not checked yet");
    expect(healthSummary({ status: "running" }, mp4).label).toBe("Being checked now");
    expect(healthSummary({ ...done, problem: null }, { ...mp4, modified: "2026-09-11T00:00:00.000Z" })).toMatchObject({
      label: "Not checked yet",
      detail: "Changed after the last bucket check.",
    });
  });
});
