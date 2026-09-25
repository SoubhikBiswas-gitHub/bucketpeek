import { describe, expect, it } from "vitest";
import { emptyInventory, INVENTORY_KINDS, inventoryRows, tallyFiles } from "@/lib/inventory";
import type { FileKind } from "@/lib/types";

const f = (kind: FileKind, size: number) => ({ kind, size });

describe("tallyFiles", () => {
  it("counts files and bytes per kind and in total", () => {
    const inv = tallyFiles(emptyInventory(), [f("video", 1000), f("video", 500), f("image", 20), f("other", 3)]);
    expect(inv).toEqual({
      files: 4,
      bytes: 1523,
      byKind: { video: { files: 2, bytes: 1500 }, image: { files: 1, bytes: 20 }, other: { files: 1, bytes: 3 } },
    });
  });

  it("accumulates across listing pages, in place", () => {
    const inv = emptyInventory();
    const same = tallyFiles(inv, [f("json", 10)]);
    tallyFiles(inv, [f("json", 5), f("pdf", 7)]);
    tallyFiles(inv, []);
    expect(same).toBe(inv);
    expect(inv).toEqual({ files: 3, bytes: 22, byKind: { json: { files: 2, bytes: 15 }, pdf: { files: 1, bytes: 7 } } });
  });

  it("counts empty files and treats unusable sizes as 0 bytes", () => {
    const inv = tallyFiles(emptyInventory(), [f("video", 0), f("text", Number.NaN), f("text", -4)]);
    expect(inv).toEqual({ files: 3, bytes: 0, byKind: { video: { files: 1, bytes: 0 }, text: { files: 2, bytes: 0 } } });
  });
});

describe("inventoryRows", () => {
  it("lists only the kinds present, in display order, with their share of the bytes", () => {
    const inv = tallyFiles(emptyInventory(), [f("other", 25), f("video", 50), f("image", 25)]);
    expect(inventoryRows(inv)).toEqual([
      { kind: "video", label: "Videos", tally: { files: 1, bytes: 50 }, share: 0.5 },
      { kind: "image", label: "Images", tally: { files: 1, bytes: 25 }, share: 0.25 },
      { kind: "other", label: "Other", tally: { files: 1, bytes: 25 }, share: 0.25 },
    ]);
  });

  it("gives a share of 0 when the bucket holds no bytes, and nothing for an empty bucket", () => {
    expect(inventoryRows(tallyFiles(emptyInventory(), [f("markdown", 0)]))[0].share).toBe(0);
    expect(inventoryRows(emptyInventory())).toEqual([]);
  });

  it("has a label for every kind", () => {
    const kinds: FileKind[] = ["video", "image", "audio", "pdf", "markdown", "json", "table", "code", "text", "archive", "other"];
    expect(INVENTORY_KINDS.map((k) => k.kind).sort()).toEqual([...kinds].sort());
  });
});
