import {
  File as FileIcon,
  FileArchive,
  FileBraces,
  FileCode,
  FileImage,
  FileMusic,
  FilePlay,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  type LucideProps,
} from "lucide-react";
import { kindColor } from "@/lib/kinds";
import type { FileKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<FileKind | "folder", React.ComponentType<LucideProps>> = {
  folder: Folder,
  video: FilePlay,
  image: FileImage,
  audio: FileMusic,
  pdf: FileText,
  markdown: FileType,
  json: FileBraces,
  table: FileSpreadsheet,
  code: FileCode,
  text: FileTerminal,
  archive: FileArchive,
  other: FileIcon,
};

const LABELS: Record<FileKind | "folder", string> = {
  folder: "Folder",
  video: "Video",
  image: "Image",
  audio: "Audio",
  pdf: "PDF",
  markdown: "Markdown",
  json: "JSON",
  table: "Table",
  code: "Code",
  text: "Text",
  archive: "Archive",
  other: "File",
};

export interface KindIconProps extends Omit<LucideProps, "color"> {
  kind: FileKind | "folder";
  tile?: boolean;
  // Defaults to size + 14.
  tileSize?: number;
  // Accessible name. When omitted the icon is decorative.
  label?: string;
}

export function kindLabel(kind: FileKind | "folder"): string {
  return LABELS[kind];
}

export function KindIcon({ kind, size = 18, strokeWidth = 1.75, tile = false, tileSize, label, className, ...rest }: KindIconProps) {
  const Icon = ICONS[kind] ?? FileIcon;
  const color = kindColor(kind);
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };

  const glyph = (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      style={{ color }}
      className={cn("shrink-0", !tile && className)}
      {...(tile ? { "aria-hidden": true as const } : a11y)}
      {...rest}
    />
  );
  if (!tile) return glyph;

  const edge = tileSize ?? Number(size) + 14;
  return (
    <span
      {...a11y}
      className={cn("inline-grid shrink-0 place-items-center rounded-md border", className)}
      style={{
        width: edge,
        height: edge,
        color,
        backgroundColor: `color-mix(in oklab, ${color} 10%, transparent)`,
        borderColor: `color-mix(in oklab, ${color} 22%, transparent)`,
      }}
    >
      {glyph}
    </span>
  );
}
