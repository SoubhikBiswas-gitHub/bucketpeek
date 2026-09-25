"use client";

import { useRef } from "react";
import Link from "next/link";
import { CopyButton } from "@/components/common/copy-button";
import { KindIcon } from "@/components/common/kind-icon";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBytes } from "@/lib/format";
import { browseHref } from "@/lib/paths";
import type { FileMeta } from "@/lib/types";
import { HealthSection, S3Section, SidecarSection, VideoSection } from "./file-details-sections";
import { exactBytes, exactDateTime, kindLabel, parseDate, relativeDate, s3Uri } from "./file-info";

export interface FileDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: FileMeta;
  bucket: string;
  region: string;
  folder: string;
  // Where focus goes on close when the element that opened the sheet is gone (a menu item).
  fallbackFocus?: React.RefObject<HTMLElement | null>;
}

/** Side sheet with every fact about the object, each copyable value one click away. */
export function FileDetailsSheet({ open, onOpenChange, file, bucket, region, folder, fallbackFocus }: FileDetailsSheetProps) {
  const modified = parseDate(file.modified);
  // Opened from state (a button or a menu item), so there's no trigger for Radix to return focus to.
  const returnFocus = useRef<HTMLElement | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-line-1 bg-surface-1 outline-none sm:max-w-md"
        // Focus the panel itself rather than the first copy button, so its tooltip doesn't pop open.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const from = document.activeElement;
          returnFocus.current = from instanceof HTMLElement && from !== document.body ? from : null;
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        onCloseAutoFocus={(e) => {
          const el = returnFocus.current?.isConnected ? returnFocus.current : fallbackFocus?.current;
          if (el?.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <SheetHeader className="gap-1.5 border-b border-line-1 px-5 pt-5 pb-4 pr-14">
          <SheetTitle className="text-[15px] font-semibold">File details</SheetTitle>
          <SheetDescription dir="auto" className="text-text-2 [overflow-wrap:anywhere]">
            {file.name}
          </SheetDescription>
        </SheetHeader>

        <div
          data-testid="file-details-body"
          className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-4"
        >
          <dl className="grid gap-5">
            <CopyRow label="Full key" copyLabel="Copy full key" value={file.key} copiedMessage="Key copied" />
            <CopyRow label="S3 URI" copyLabel="Copy S3 URI" value={s3Uri(bucket, file.key)} copiedMessage="S3 URI copied" />
          </dl>

          <Separator className="bg-line-1" />

          <dl className="grid gap-5">
            <Row label="Kind">
              <span className="inline-flex items-center gap-2">
                <KindIcon kind={file.kind} size={16} />
                {kindLabel(file.kind)}
                <span className="text-text-3">{file.type}</span>
              </span>
            </Row>
            <Row label="Size">
              {formatBytes(file.size)}
              <span className="block font-mono text-xs text-text-3 tabular-nums">{exactBytes(file.size)}</span>
            </Row>
            <Row label="Content type">
              {file.contentType ? (
                <span className="font-mono text-[13px] break-all">{file.contentType}</span>
              ) : (
                <span className="text-text-3">Not set</span>
              )}
            </Row>
            <Row label="Last modified">
              {modified ? (
                <>
                  <time dateTime={modified.toISOString()}>{exactDateTime(modified)}</time>
                  <span className="block text-xs text-text-3">
                    {relativeDate(modified)} · <span className="font-mono">{modified.toISOString()}</span>
                  </span>
                </>
              ) : (
                <span className="text-text-3">Unknown</span>
              )}
            </Row>
          </dl>

          <Separator className="bg-line-1" />

          <dl className="grid gap-5">
            <Row label="Folder">
              <Link
                href={browseHref(folder)}
                onClick={() => onOpenChange(false)}
                className="font-mono text-[13px] break-all text-brand underline-offset-4 hover:underline"
              >
                {folder || "/"}
              </Link>
            </Row>
            <Row label="Bucket">
              <span className="font-mono text-[13px] break-all">{bucket}</span>
            </Row>
            {region && (
              <Row label="Region">
                <span className="font-mono text-[13px]">{region}</span>
              </Row>
            )}
          </dl>

          <S3Section bucket={bucket} file={file} />
          {file.kind === "video" && (
            <>
              <VideoSection bucket={bucket} file={file} />
              <HealthSection bucket={bucket} file={file} />
            </>
          )}
          <SidecarSection bucket={bucket} file={file} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Offers a line break after every "/" so long keys wrap at path boundaries before breaking mid-name. */
function PathText({ value }: { value: string }) {
  const parts = value.split("/");
  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </span>
  ));
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium text-text-3">{label}</dt>
      <dd className="min-w-0 text-sm text-text-1">{children}</dd>
    </div>
  );
}

function CopyRow({
  label,
  copyLabel,
  value,
  copiedMessage,
}: {
  label: string;
  copyLabel: string;
  value: string;
  copiedMessage: string;
}) {
  return (
    <div className="grid gap-1.5">
      <dt className="text-xs font-medium text-text-3">{label}</dt>
      <dd className="flex min-w-0 items-start gap-2 rounded-lg border border-line-1 bg-surface-2 py-1.5 pr-1.5 pl-3">
        <span
          dir="auto"
          className="min-w-0 flex-1 py-1 font-mono text-[13px] leading-relaxed text-text-1 select-all [overflow-wrap:anywhere]"
        >
          <PathText value={value} />
        </span>
        <CopyButton
          value={value}
          label={copyLabel}
          toastMessage={copiedMessage}
          className="size-11 shrink-0 text-text-2 hover:text-text-1 sm:size-7"
        />
      </dd>
    </div>
  );
}
