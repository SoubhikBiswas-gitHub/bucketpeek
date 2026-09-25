"use client";

import { useState } from "react";
import { ChevronsDown, Download, Info, RotateCw, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DocNotice, TRUNCATED_TEXT } from "./doc-chrome";
import { CONFIRM_ALL_BYTES, STEP_BYTES, type LoadMode, type TextLoader } from "./use-text-loader";

export interface LoadMoreFooterProps {
  loader: TextLoader;
  downloadHref: string;
  // "stream" offers Load next + Load all; "full" offers one button that loads the whole file.
  variant?: "stream" | "full";
  fullLabel?: string;
  // Replaces "Showing 512 KB of 38.2 MB" while nothing extra is loaded yet.
  message?: React.ReactNode;
}

export function LoadMoreFooter({ loader, downloadHref, variant = "stream", fullLabel = "Load all", message }: LoadMoreFooterProps) {
  const [confirming, setConfirming] = useState(false);
  const { status, loaded, total, error } = loader;

  if (status === "done") return null;
  if (status === "unavailable") return <DocNotice downloadHref={downloadHref}>{message ?? TRUNCATED_TEXT}</DocNotice>;

  const loading = status === "loading";
  const shown = total !== null ? Math.min(loaded, total) : loaded;
  const remaining = total !== null ? Math.max(0, total - shown) : null;
  const stepLabel = `Load next ${formatBytes(remaining !== null ? Math.min(STEP_BYTES, remaining) : STEP_BYTES)}`;

  const start = (mode: LoadMode) => {
    if (mode === "all" && total !== null && total > CONFIRM_ALL_BYTES) setConfirming(true);
    else loader.load(mode);
  };

  const summary = loading ? (
    <>
      Loading{total !== null ? ` ${formatBytes(shown)} of ${formatBytes(total)}` : ""}…
    </>
  ) : status === "error" ? (
    <span className="text-danger">Couldn&apos;t load more. {error}</span>
  ) : shown > 512 * 1024 || !message ? (
    <>
      Showing <span className="text-text-1 tabular-nums">{formatBytes(shown)}</span>
      {total !== null && (
        <>
          {" "}
          of <span className="text-text-1 tabular-nums">{formatBytes(total)}</span>
        </>
      )}
      {total === null && " of this file"}.
    </>
  ) : (
    message
  );

  const Lead = loading ? Spinner : status === "error" ? TriangleAlert : Info;

  return (
    <div
      role="note"
      aria-busy={loading || undefined}
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line-1 bg-surface-2 px-3 py-1.5 text-[13px] text-text-2 sm:px-4"
    >
      <Lead aria-hidden strokeWidth={1.75} className={cn("size-4 shrink-0", status === "error" ? "text-danger" : "text-text-3")} />
      <p aria-live="polite" className="min-w-0 flex-1 text-pretty">
        {summary}
      </p>
      <div className="flex shrink-0 items-center gap-0.5">
        {status === "error" ? (
          <Button variant="ghost" size="xs" onClick={() => loader.load("next")}>
            <RotateCw aria-hidden strokeWidth={1.75} className="size-3.5" data-icon="inline-start" />
            Try again
          </Button>
        ) : variant === "stream" ? (
          <>
            <Button variant="ghost" size="xs" disabled={loading} onClick={() => start("next")}>
              <ChevronsDown aria-hidden strokeWidth={1.75} className="size-3.5" data-icon="inline-start" />
              {stepLabel}
            </Button>
            <Button variant="ghost" size="xs" disabled={loading} onClick={() => start("all")}>
              {fullLabel}
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="xs" disabled={loading} onClick={() => start("all")} className="text-brand hover:text-brand">
            <ChevronsDown aria-hidden strokeWidth={1.75} className="size-3.5" data-icon="inline-start" />
            {fullLabel}
          </Button>
        )}
        <Button asChild variant="ghost" size="xs">
          <a href={downloadHref} download>
            <Download aria-hidden strokeWidth={1.75} className="size-3.5" data-icon="inline-start" />
            <span className="max-sm:sr-only">Download</span>
          </a>
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load all {total !== null ? formatBytes(total) : "of this file"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Very large files can make this tab slow or run out of memory. Downloading the file is often the better
              choice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => loader.load("all")}>Load all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
