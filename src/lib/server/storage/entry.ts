import { baseName, extOf, kindOf, typeLabel } from "@/lib/kinds";
import type { FileEntry } from "@/lib/types";

export function toFileEntry(key: string, size: number, modified: Date | undefined | null): FileEntry {
  return {
    key,
    name: baseName(key),
    ext: extOf(key),
    kind: kindOf(key),
    type: typeLabel(key),
    size,
    modified: modified ? modified.toISOString() : null,
  };
}
