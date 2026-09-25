"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clock, Link2 } from "lucide-react";
import type { CopiedLinks } from "@/components/common/copy-link-dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ShareLinkControlProps {
  // The link copied last on this page, or null before any.
  copied: CopiedLinks | null;
  // Opens the copy dialog; resolves true once a link is on the clipboard.
  onCopy: () => Promise<boolean>;
}

const SEGMENT =
  "h-8 rounded-none border-0 bg-transparent shadow-none hover:bg-input/50 focus-visible:z-10 max-sm:h-11";

// Copy link, and after a copy, when that link stops working (full on wide screens, the IST time on narrow).
export function ShareLinkControl({ copied, onCopy }: ShareLinkControlProps) {
  const [justCopied, setJustCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (!(await onCopy())) return;
    setJustCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setJustCopied(false), 1800);
  }

  const CopyIcon = justCopied ? Check : Link2;

  return (
    <div
      role="group"
      aria-label="Share link"
      className="inline-flex min-w-0 shrink-0 items-stretch overflow-hidden rounded-full border border-input bg-input/30"
    >
      <Button variant="ghost" onClick={copy} className={cn(SEGMENT, "gap-1.5 pr-2.5 pl-3 max-sm:w-12 max-sm:pr-0 max-sm:pl-1")}>
        <CopyIcon aria-hidden className={cn(justCopied && "text-brand")} />
        <span className="max-sm:sr-only">{justCopied ? "Copied" : "Copy link"}</span>
      </Button>

      {copied && (
        <>
          <span aria-hidden className="w-px shrink-0 bg-input" />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                aria-label={`Copied link works until ${copied.until.both}. Show details`}
                className={cn(SEGMENT, "gap-1.5 pr-3 pl-2.5 font-normal text-text-2 tabular-nums hover:text-text-1")}
              >
                <Clock aria-hidden />
                <span aria-hidden className="hidden xl:inline">
                  Works until {copied.until.both}
                </span>
                <span aria-hidden className="xl:hidden">
                  <span className="max-sm:hidden">Until </span>
                  {copied.until.short}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1rem))] gap-3 border border-line-2 bg-surface-2 p-4 ring-0">
              <div className="grid gap-1">
                <p className="text-sm font-medium text-text-1">The link you copied works until</p>
                <p className="text-[13px] text-text-1 tabular-nums">{copied.until.utc}</p>
                <p className="text-[13px] text-text-1 tabular-nums">{copied.until.ist}</p>
              </div>
              <p className="text-xs leading-relaxed text-text-3">
                Anyone with it can open the file until then. To pick another time, copy the link again.
              </p>
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
