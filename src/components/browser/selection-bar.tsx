"use client";

import { useId, useMemo, useState } from "react";
import { Copy, Download, Link2, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DownloadLimits } from "@/lib/download-limits";
import { cn } from "@/lib/utils";
import { copyAwsCliCommands, copyS3Links, copyS3Paths, downloadFiles } from "./bulk-actions";
import { downloadBudget, type DownloadBudget } from "./download-budget";
import type { Selection } from "./use-selection";

export interface SelectionBarProps {
  bucket: string;
  selection: Selection;
  /** Items shown, for "Select all N". */
  shown: number;
  downloadLimits: DownloadLimits;
}

/**
 * Actions for the selected items, between the toolbar and the listing. Selecting and copying are
 * unlimited, but Download works only while the selected files fit the download limits: selections
 * here are often tens of GB, and every byte downloaded is billed as S3 egress. Bigger selections
 * can be fetched with the copied AWS CLI commands instead.
 */
export function SelectionBar({ bucket, selection, shown, downloadLimits }: SelectionBarProps) {
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { items, state } = selection;
  const budget = useMemo(() => downloadBudget(items, downloadLimits), [items, downloadLimits]);
  const files = budget.files.length;
  const { folders } = budget;
  const over = budget.overBytes || budget.overFiles;
  const ids = useId();
  const usageId = `${ids}-usage`;
  const reasonId = `${ids}-reason`;

  const what = [files ? `${files.toLocaleString()} file${files === 1 ? "" : "s"}` : "", folders ? `${folders.toLocaleString()} folder${folders === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      role="toolbar"
      aria-label="Selected items"
      className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-brand-line bg-brand-mist px-2 py-1.5 sm:px-3"
    >
      <Checkbox
        checked={state === "all" ? true : "indeterminate"}
        onCheckedChange={() => (state === "all" ? selection.clear() : selection.selectAll())}
        aria-label={state === "all" ? "Clear selection" : "Select all"}
        className="ml-1"
      />
      {/* One polite region for the count and the download usage, so each change is announced once. */}
      <p className="mr-auto min-w-0 truncate text-sm text-text-1" aria-live="polite">
        <span className="font-medium tabular-nums">{items.length.toLocaleString()} selected</span>
        <span className="hidden text-text-2 sm:inline"> · {what}</span>
        {files > 0 && (
          <span className="sr-only">
            , {budget.usage} to download{over ? ", over the download limit" : ""}
          </span>
        )}
        {state !== "all" && (
          <Button variant="link" size="sm" className="ml-2" onClick={selection.selectAll}>
            Select all {shown.toLocaleString()}
            <span className="sr-only"> items</span>
          </Button>
        )}
      </p>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {files > 0 ? (
            <UsageMeter id={usageId} budget={budget} />
          ) : (
            // Same slot as the meter, so selecting a folder doesn't make the bar (and the list) jump.
            <span aria-hidden className="w-28 truncate text-xs text-text-2">
              No files selected
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              {/*
                aria-disabled rather than disabled: the button stays focusable and hoverable, so the
                reason is reachable by keyboard, screen reader and tooltip.
              */}
              <Button
                variant="outline"
                size="sm"
                aria-disabled={budget.reason !== null || downloading}
                aria-describedby={budget.reason ? reasonId : files > 0 ? usageId : undefined}
                onClick={async () => {
                  if (budget.reason || downloading) return;
                  setDownloading(true);
                  await downloadFiles(budget);
                  setDownloading(false);
                }}
                className="max-sm:h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-line-2 aria-disabled:hover:bg-surface-2 aria-disabled:active:translate-y-0"
              >
                <Download aria-hidden data-icon="inline-start" />
                Download
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{budget.reason ?? "One download per file, straight from S3"}</TooltipContent>
          </Tooltip>
        </div>
        <Button variant="outline" size="sm" onClick={() => void copyS3Paths(bucket, items)} className="max-sm:h-11">
          <Copy aria-hidden data-icon="inline-start" />
          Copy S3 paths
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              // aria-disabled, not disabled, when only folders are selected: the tooltip says why.
              disabled={busy}
              aria-disabled={files === 0 || undefined}
              onClick={async () => {
                // With only folders, this explains that folders have no links.
                if (files === 0) return void copyS3Links(items);
                setBusy(true);
                await copyS3Links(items);
                setBusy(false);
              }}
              className="max-sm:h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-line-2 aria-disabled:hover:bg-surface-2"
            >
              <Link2 aria-hidden data-icon="inline-start" />
              Copy S3 links
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            {files === 0
              ? "Folders don’t have S3 links. Select files, or copy the S3 paths instead."
              : "Presigned HTTPS links that open each file from S3, for as long as you choose"}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={() => void copyAwsCliCommands(bucket, items)} className="max-sm:h-11">
              <Terminal aria-hidden data-icon="inline-start" />
              Copy AWS CLI commands
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            One aws s3 cp command per item, folders recursive. The CLI splits big files into parts and retries failed ones.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={() => selection.clear()} className="max-sm:size-11">
              <X aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Clear selection <Kbd>Esc</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      {/*
        Over a limit, the reason is shown, not just a tooltip: touch has no hover. With only folders
        selected, "No files selected" says enough on screen. Not live: the count region above speaks.
      */}
      {budget.reason && (
        <p id={reasonId} className={over ? "basis-full px-1 text-xs text-pretty text-danger" : "sr-only"}>
          {budget.reason}
        </p>
      )}
    </div>
  );
}

/** "820 MB of 1 GB" over a slim bar that turns red past the size limit. Hidden from screen readers, which hear it in the live region. */
function UsageMeter({ id, budget }: { id: string; budget: DownloadBudget }) {
  const over = budget.overBytes;
  return (
    <div aria-hidden className="flex w-28 flex-col gap-1">
      <span id={id} className={cn("truncate text-xs tabular-nums", over ? "text-danger" : "text-text-2")}>
        {budget.usage}
      </span>
      {/* Clamped: Radix treats a value past max as invalid. The 2% floor keeps a sliver visible. */}
      <Progress
        value={Math.min(100, Math.max(budget.used * 100, budget.bytes > 0 ? 2 : 0))}
        data-over={over || undefined}
        className="bg-line-2 *:data-[slot=progress-indicator]:rounded-full *:data-[slot=progress-indicator]:duration-200 motion-reduce:*:data-[slot=progress-indicator]:transition-none data-over:*:data-[slot=progress-indicator]:bg-danger"
      />
    </div>
  );
}
