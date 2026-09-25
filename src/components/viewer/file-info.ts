import { format, formatDistanceToNow, isValid } from "date-fns";
import type { FileKind } from "@/lib/types";

const KIND_LABELS: Record<FileKind, string> = {
  video: "Video",
  image: "Image",
  audio: "Audio",
  pdf: "PDF document",
  markdown: "Markdown document",
  json: "JSON data",
  table: "Table",
  code: "Source code",
  text: "Plain text",
  archive: "Archive",
  other: "Other file",
};

export function kindLabel(kind: FileKind): string {
  return KIND_LABELS[kind] ?? KIND_LABELS.other;
}

export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isValid(d) ? d : null;
}

export function shortDate(d: Date): string {
  return format(d, "MMM d, yyyy");
}

export function exactDateTime(d: Date): string {
  return format(d, "MMM d, yyyy, h:mm:ss a");
}

export function relativeDate(d: Date): string {
  return formatDistanceToNow(d, { addSuffix: true });
}

export function exactBytes(n: number): string {
  const safe = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  return `${safe.toLocaleString("en-US")} ${safe === 1 ? "byte" : "bytes"}`;
}

export function s3Uri(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}
