"use client";

import { toast } from "sonner";
import { openCopyLinkDialog } from "@/components/common/copy-link-dialog";
import { awsCliCommands } from "@/lib/aws-cli";
import { formatBytes } from "@/lib/format";
import { downloadHref } from "@/lib/paths";
import { writeClipboard } from "./clipboard";
import type { DownloadBudget } from "./download-budget";
import { s3Uri, type FileItem, type Item } from "./items";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const filesOf = (items: readonly Item[]) => items.filter((it): it is FileItem => !it.isFolder);

/** One `s3://bucket/key` per line; folders end in "/". */
export async function copyS3Paths(bucket: string, items: readonly Item[]): Promise<boolean> {
  const text = items.map((it) => s3Uri(bucket, it)).join("\n");
  try {
    await writeClipboard(text);
    toast.success(`Copied ${plural(items.length, "S3 path")}`, { description: items.length === 1 ? text : undefined });
    return true;
  } catch {
    toast.error("Couldn’t copy the S3 paths", { description: "Your browser blocked clipboard access." });
    return false;
  }
}

/**
 * One `aws s3 cp` command per line (recursive for folders), for selections too big for the browser:
 * the CLI isn't bound by the bulk download limits and resumes failed parts.
 */
export async function copyAwsCliCommands(bucket: string, items: readonly Item[]): Promise<boolean> {
  const text = awsCliCommands(bucket, items.map((it) => it.id));
  try {
    await writeClipboard(text);
    toast.success(`Copied ${plural(items.length, "AWS CLI command")}`, { description: items.length === 1 ? text : undefined });
    return true;
  } catch {
    toast.error("Couldn’t copy the AWS CLI commands", { description: "Your browser blocked clipboard access." });
    return false;
  }
}

// Asks how long the links should work, then copies one presigned URL per file. S3 has no link for a folder.
export async function copyS3Links(items: readonly Item[]): Promise<boolean> {
  const files = filesOf(items);
  if (files.length === 0) {
    toast.error("Folders don’t have S3 links", { description: "Select files to copy their links, or copy the S3 paths instead." });
    return false;
  }
  const subject = files.length === 1 ? files[0].name : plural(files.length, "file");
  const copied = await openCopyLinkDialog({ keys: files.map((f) => f.file.key), subject, skipped: items.length - files.length });
  return copied !== null;
}

/** Gap between downloads: browsers drop clicks that land together. */
const DOWNLOAD_GAP_MS = 350;

/**
 * Starts one download per file, a moment apart, each through /api/files/download (a redirect to a
 * presigned URL that saves under the file's own name). Resolves once the last one has started.
 * The caller checks the budget first; this refuses one that is over it anyway.
 */
export async function downloadFiles(budget: DownloadBudget): Promise<boolean> {
  const { files, folders, bytes } = budget;
  if (budget.reason) {
    toast.error("Can’t download this selection", { description: budget.reason });
    return false;
  }
  const notes: string[] = [];
  // Chrome and Safari ask once before a page starts several downloads; until allowed, only the first arrives.
  if (files.length > 1) notes.push("If only one arrives, allow multiple downloads when the browser asks.");
  if (folders) notes.push(`${plural(folders, "folder")} skipped.`);
  toast.success(`Downloading ${plural(files.length, "file")} · ${formatBytes(bytes)}`, { description: notes.join(" ") || undefined });

  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, DOWNLOAD_GAP_MS));
    const a = document.createElement("a");
    a.href = downloadHref(files[i].file.key);
    a.download = files[i].name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
  }
  return true;
}
