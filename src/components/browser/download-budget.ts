import type { DownloadLimits } from "@/lib/download-limits";
import { formatBytes, plural } from "@/lib/format";
import type { FileItem, Item } from "./items";

/** Pure bulk download budget: what a selection would download, and whether it may. No React here. */

export interface DownloadBudget {
  /** Selected files, in display order. Folders are never downloaded. */
  files: FileItem[];
  /** Folders in the selection, skipped by Download. */
  folders: number;
  /** Total size of `files`. */
  bytes: number;
  /** Share of the size limit in use, 0 to 1, for the meter. */
  used: number;
  /** "820 MB of 1 GB". */
  usage: string;
  overBytes: boolean;
  overFiles: boolean;
  /** Why Download is unavailable, in a sentence; null when it can start. */
  reason: string | null;
}

export function downloadBudget(items: readonly Item[], limits: DownloadLimits): DownloadBudget {
  const files = items.filter((it): it is FileItem => !it.isFolder);
  let bytes = 0;
  for (const f of files) bytes += f.file.size;
  const overBytes = bytes > limits.maxBytes;
  const overFiles = files.length > limits.maxFiles;

  const max = formatBytes(limits.maxBytes);
  // Just over the limit rounds to the limit itself ("1 GB of 1 GB"), so say "more than" instead.
  const size = overBytes && formatBytes(bytes) === max ? `more than ${max}` : formatBytes(bytes);
  const atOnce = `${plural(limits.maxFiles, "file")} at once`;
  const way = "deselect files, download them one at a time, or copy AWS CLI commands.";
  let reason: string | null = null;
  if (files.length === 0) reason = "Folders can’t be downloaded. Select files to download them.";
  else if (overBytes && overFiles)
    reason = `Selection is ${size} in ${plural(files.length, "file")}. Bulk download is limited to ${max} and ${atOnce} — ${way}`;
  else if (overBytes) reason = `Selection is ${size}. Bulk download is limited to ${max} — ${way}`;
  else if (overFiles) reason = `${plural(files.length, "file")} selected. Up to ${atOnce} — ${way}`;

  return {
    files,
    folders: items.length - files.length,
    bytes,
    used: Math.min(1, bytes / limits.maxBytes),
    usage: `${formatBytes(bytes)} of ${max}`,
    overBytes,
    overFiles,
    reason,
  };
}
