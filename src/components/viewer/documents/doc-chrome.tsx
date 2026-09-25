import { Download, FileX, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Server-safe (no hooks). A renderer is a column that fills the stage: a fixed toolbar, one body that
// scrolls on its own, and an optional footer notice.

export function DocFrame({ className, children, ...rest }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="doc-frame"
      className={cn("lens-syntax flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface-1", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function DocToolbar({ className, children, ...rest }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="doc-toolbar"
      className={cn(
        "flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-1 bg-surface-1 px-2 py-1.5 sm:px-3",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function DocMeta({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("min-w-0 truncate text-[13px] text-text-3 tabular-nums", className)}>{children}</p>;
}

export function MetaDot() {
  return (
    <span aria-hidden className="px-1.5 text-line-3">
      ·
    </span>
  );
}

export interface DocNoticeProps {
  children: React.ReactNode;
  downloadHref?: string;
  className?: string;
}

export function DocNotice({ children, downloadHref, className }: DocNoticeProps) {
  return (
    <div
      role="note"
      className={cn(
        "flex min-h-9 shrink-0 items-center gap-2 border-t border-line-1 bg-surface-2 px-3 py-1.5 text-[13px] text-text-2 sm:px-4",
        className,
      )}
    >
      <Info aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-text-3" />
      <p className="min-w-0 flex-1 text-pretty">{children}</p>
      {downloadHref && (
        <Button asChild variant="ghost" size="xs" className="shrink-0 text-brand hover:text-brand">
          <a href={downloadHref} download>
            <Download aria-hidden data-icon="inline-start" strokeWidth={1.75} className="size-3.5" />
            Download
          </a>
        </Button>
      )}
    </div>
  );
}

export const TRUNCATED_TEXT = "Showing the first 512 KB. Download the file to see all of it.";

export function TruncatedNotice({ downloadHref, children }: { downloadHref: string; children?: React.ReactNode }) {
  return <DocNotice downloadHref={downloadHref}>{children ?? TRUNCATED_TEXT}</DocNotice>;
}

export function EmptyDocument({
  title = "This file is empty.",
  description = "There is nothing to preview. The object exists but holds 0 bytes.",
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <div className="grid size-10 place-items-center rounded-lg border border-line-2 bg-surface-2 text-text-2">
        <FileX aria-hidden className="size-5" strokeWidth={1.75} />
      </div>
      <p className="text-[15px] font-medium text-text-1">{title}</p>
      {description && <p className="max-w-sm text-sm text-pretty text-text-2">{description}</p>}
    </div>
  );
}
