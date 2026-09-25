import { describe, expect, it } from "vitest";
import { DEFAULT_DOWNLOAD_LIMITS, lowerDownloadLimits, parseDownloadLimits, type DownloadLimits } from "@/lib/download-limits";
import { kindOf, typeLabel } from "@/lib/kinds";
import { downloadBudget } from "./download-budget";
import type { FileItem, FolderItem, Item } from "./items";

function file(key: string, size: number): FileItem {
  const name = key.slice(key.lastIndexOf("/") + 1);
  return {
    id: key,
    name,
    search: name,
    isFolder: false,
    kind: kindOf(key),
    file: { key, name, ext: name.split(".").pop() ?? "", kind: kindOf(key), type: typeLabel(key), size, modified: null },
  };
}

function folder(prefix: string): FolderItem {
  const name = prefix.slice(0, -1).split("/").pop() ?? "";
  return { id: prefix, name, search: name, isFolder: true, kind: "folder", prefix };
}

const GB: DownloadLimits = { maxBytes: 1_000_000_000, maxFiles: 50 };

describe("downloadBudget", () => {
  it("sums file sizes and skips folders", () => {
    const items: Item[] = [folder("a/"), file("x.mp4", 600_000_000), folder("b/"), file("y.mp4", 220_000_000)];
    const b = downloadBudget(items, GB);
    expect(b.files.map((f) => f.id)).toEqual(["x.mp4", "y.mp4"]);
    expect(b.folders).toBe(2);
    expect(b.bytes).toBe(820_000_000);
    expect(b.usage).toBe("820 MB of 1 GB");
    expect(b.used).toBeCloseTo(0.82);
    expect(b).toMatchObject({ overBytes: false, overFiles: false, reason: null });
  });

  it("allows exactly the limit", () => {
    const b = downloadBudget([file("x.bin", 1_000_000_000)], GB);
    expect(b).toMatchObject({ overBytes: false, used: 1, reason: null });
  });

  it("blocks a selection over the size limit, with the size in the reason", () => {
    const b = downloadBudget([file("x.mp4", 900_000_000), file("y.mp4", 500_000_000)], GB);
    expect(b.overBytes).toBe(true);
    expect(b.used).toBe(1);
    expect(b.usage).toBe("1.4 GB of 1 GB");
    expect(b.reason).toBe("Selection is 1.4 GB. Bulk download is limited to 1 GB — deselect files, download them one at a time, or copy AWS CLI commands.");
  });

  it("says “more than” when the total rounds to the limit", () => {
    const b = downloadBudget([file("x.bin", 1_000_000_001)], GB);
    expect(b.reason).toMatch(/^Selection is more than 1 GB\./);
  });

  it("blocks too many files, even when they are small", () => {
    const items = Array.from({ length: 51 }, (_, i) => file(`f${i}.txt`, 10));
    const b = downloadBudget(items, GB);
    expect(b).toMatchObject({ overBytes: false, overFiles: true });
    expect(b.reason).toBe("51 files selected. Up to 50 files at once — deselect files, download them one at a time, or copy AWS CLI commands.");
    expect(downloadBudget(items.slice(0, 50), GB).reason).toBeNull();
  });

  it("names both limits when both are exceeded", () => {
    const b = downloadBudget([file("a.mp4", 800_000_000), file("b.mp4", 800_000_000)], { maxBytes: 1_000_000_000, maxFiles: 1 });
    expect(b.reason).toBe(
      "Selection is 1.6 GB in 2 files. Bulk download is limited to 1 GB and 1 file at once — deselect files, download them one at a time, or copy AWS CLI commands.",
    );
  });

  it("explains that folders alone can’t be downloaded", () => {
    const b = downloadBudget([folder("a/"), folder("b/")], GB);
    expect(b).toMatchObject({ files: [], folders: 2, bytes: 0, used: 0 });
    expect(b.reason).toMatch(/^Folders can’t be downloaded/);
  });
});

describe("parseDownloadLimits", () => {
  it("defaults to 1 GB and 50 files", () => {
    expect(parseDownloadLimits({})).toEqual({ maxBytes: 1_000_000_000, maxFiles: 50 });
    expect(DEFAULT_DOWNLOAD_LIMITS).toEqual({ maxBytes: 1_000_000_000, maxFiles: 50 });
  });

  it("reads decimal gigabytes, fractions included, and whole file counts", () => {
    expect(parseDownloadLimits({ LENS_BULK_DOWNLOAD_MAX_GB: "5", LENS_BULK_DOWNLOAD_MAX_FILES: "20" })).toEqual({
      maxBytes: 5_000_000_000,
      maxFiles: 20,
    });
    expect(parseDownloadLimits({ LENS_BULK_DOWNLOAD_MAX_GB: "0.25" }).maxBytes).toBe(250_000_000);
    expect(parseDownloadLimits({ LENS_BULK_DOWNLOAD_MAX_GB: " 1.5 " }).maxBytes).toBe(1_500_000_000);
    expect(parseDownloadLimits({ LENS_BULK_DOWNLOAD_MAX_FILES: "12.9" }).maxFiles).toBe(12);
    // Tiny but positive still leaves at least one byte.
    expect(parseDownloadLimits({ LENS_BULK_DOWNLOAD_MAX_GB: "1e-12" }).maxBytes).toBe(1);
  });

  it.each(["", "  ", "abc", "0", "-2", "NaN", "Infinity", "1GB", "0x"])("falls back to the defaults for %j", (raw) => {
    expect(parseDownloadLimits({ LENS_BULK_DOWNLOAD_MAX_GB: raw, LENS_BULK_DOWNLOAD_MAX_FILES: raw })).toEqual(DEFAULT_DOWNLOAD_LIMITS);
  });

  it("falls back for a file count below one", () => {
    expect(parseDownloadLimits({ LENS_BULK_DOWNLOAD_MAX_FILES: "0.5" }).maxFiles).toBe(50);
  });
});

describe("lowerDownloadLimits", () => {
  it("lowers either limit", () => {
    expect(lowerDownloadLimits(GB, "maxBytes=1000")).toEqual({ maxBytes: 1000, maxFiles: 50 });
    expect(lowerDownloadLimits(GB, "maxFiles=2")).toEqual({ maxBytes: 1_000_000_000, maxFiles: 2 });
  });

  it("never raises them, and ignores junk", () => {
    expect(lowerDownloadLimits(GB, "maxBytes=5000000000000&maxFiles=9999")).toEqual(GB);
    expect(lowerDownloadLimits(GB, "maxBytes=-1&maxFiles=abc&other=1")).toEqual(GB);
    expect(lowerDownloadLimits(GB, "garbage")).toEqual(GB);
  });
});
