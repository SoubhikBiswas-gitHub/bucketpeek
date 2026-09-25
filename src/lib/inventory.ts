import type { BucketInventory, FileEntry, FileKind, KindTally } from "./types";

export const INVENTORY_KINDS: readonly { kind: FileKind; label: string }[] = [
  { kind: "video", label: "Videos" },
  { kind: "image", label: "Images" },
  { kind: "audio", label: "Audio" },
  { kind: "pdf", label: "PDFs" },
  { kind: "markdown", label: "Markdown" },
  { kind: "json", label: "JSON" },
  { kind: "table", label: "Tables" },
  { kind: "code", label: "Code" },
  { kind: "text", label: "Text" },
  { kind: "archive", label: "Archives" },
  { kind: "other", label: "Other" },
];

export function emptyInventory(): BucketInventory {
  return { files: 0, bytes: 0, byKind: {} };
}

const bytesOf = (size: number) => (Number.isFinite(size) && size > 0 ? size : 0);

// Mutates `inventory`: the bucket check adds each listing page as it arrives, so counting costs no
// requests beyond the listing it already does.
export function tallyFiles(inventory: BucketInventory, files: readonly Pick<FileEntry, "kind" | "size">[]): BucketInventory {
  for (const f of files) {
    const bytes = bytesOf(f.size);
    const t = (inventory.byKind[f.kind] ??= { files: 0, bytes: 0 });
    t.files++;
    t.bytes += bytes;
    inventory.files++;
    inventory.bytes += bytes;
  }
  return inventory;
}

export function inventoryRows(inventory: BucketInventory): { kind: FileKind; label: string; tally: KindTally; share: number }[] {
  return INVENTORY_KINDS.flatMap(({ kind, label }) => {
    const tally = inventory.byKind[kind];
    if (!tally?.files) return [];
    return [{ kind, label, tally, share: inventory.bytes ? tally.bytes / inventory.bytes : 0 }];
  });
}
