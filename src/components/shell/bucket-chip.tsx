"use client";

import { useRef } from "react";
import Link from "next/link";
import { ChevronsUpDown, FlaskConical, Settings2 } from "lucide-react";
import { CopyButton } from "@/components/common/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BucketHealth, ConnectionInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { attentionCount, useBucketHealth } from "@/components/health/use-bucket-health";
import { Spinner } from "@/components/ui/spinner";
import { regionName } from "./regions";

/**
 * "Connected" is a status signal, so it keeps a fixed success green rather than the brand color.
 * #3ecf8e on the chip's surface is above 7:1.
 */
const CONNECTED = "#3ecf8e";

function StatusDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: CONNECTED, boxShadow: `0 0 0 3px color-mix(in oklab, ${CONNECTED} 18%, transparent)` }}
    />
  );
}

const DEMO_HINT = "Showing the local sample folder, not AWS. Run npm run dev for your real bucket.";

/** Sits next to the chip so it can carry its own tooltip; icon-only on phones. */
function DemoBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/*
          Classes go on the Badge (merged there), not the button: Slot only concatenates.
          overflow-visible keeps the enlarged touch target (the ::after) hittable.
        */}
        <Badge
          asChild
          className="relative flex h-6 cursor-help justify-start gap-1.5 overflow-visible py-0 transition-none max-sm:w-6 max-sm:justify-center max-sm:px-0 pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 [&>svg]:size-3.5!"
        >
          <button type="button" aria-label={`Demo data. ${DEMO_HINT}`}>
            <FlaskConical aria-hidden className="shrink-0" strokeWidth={1.9} />
            <span className="hidden sm:inline">Demo data</span>
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        {DEMO_HINT}
      </TooltipContent>
    </Tooltip>
  );
}

export function BucketChip({ connection, demo = false }: { connection: ConnectionInfo; demo?: boolean }) {
  const { bucket } = connection;
  // Mock mode reports a placeholder region, so it isn't shown as if it were real.
  const region = demo ? "" : connection.region;
  const regionLabel = region ? regionName(region) : "";
  const uri = `s3://${bucket}`;
  const contentRef = useRef<HTMLDivElement>(null);
  // Mounted on every page: the first time a bucket is opened this starts its one-time video check.
  const { health } = useBucketHealth();

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${demo ? "Demo mode, " : ""}connected to ${bucket}${region ? ` in ${region}` : ""}. Show connection details`}
                className={cn(
                  "group/chip relative flex h-8 min-w-0 items-center gap-2 rounded-md border border-line-2 bg-surface-1 pr-1.5 pl-2.5 text-left",
                  "transition-[background-color,border-color] duration-150 hover:border-line-3 hover:bg-surface-2",
                  "aria-expanded:border-line-3 aria-expanded:bg-surface-2",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5",
                )}
              >
                <StatusDot />
                <span className="min-w-0 truncate font-mono text-[13px] leading-none text-text-1">{bucket}</span>
                {region && (
                  <span className="hidden shrink-0 items-center gap-2 md:flex">
                    <span aria-hidden className="h-3.5 w-px bg-line-2" />
                    <span className="font-mono text-xs leading-none text-text-3">{region}</span>
                  </span>
                )}
                <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-text-3 group-hover/chip:text-text-2" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-[min(28rem,calc(100vw-2rem))]">
            <span className="font-mono break-all">{bucket}</span>
            {regionLabel && <span className="shrink-0 text-text-2"> · {regionLabel}</span>}
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          ref={contentRef}
          tabIndex={-1}
          aria-label="Connection details"
          // Focus the panel, not its first copy button, so a tooltip doesn't pop open unasked.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            contentRef.current?.focus();
          }}
          align="start"
          sideOffset={8}
          className="w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-x-hidden overflow-y-auto p-0"
        >
          <div className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2 text-xs font-medium text-text-2">
              <StatusDot />
              {demo ? "Demo connection" : "Connected bucket"}
            </div>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 pt-0.5 font-mono text-sm leading-snug break-all text-text-1">{bucket}</p>
              <CopyButton value={bucket} label="Copy bucket name" className="-mt-0.5 -mr-1.5" />
            </div>
            {demo && (
              <p className="mt-1 flex gap-2 rounded-md border border-brand-line bg-brand-mist px-2.5 py-2 text-xs leading-relaxed text-text-1">
                <FlaskConical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-brand" strokeWidth={1.9} />
                <span>
                  Showing the local sample folder, not AWS. Run <code className="font-mono text-brand">npm run dev</code> for
                  your real bucket.
                </span>
              </p>
            )}
          </div>
          <Separator className="bg-line-2" />
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2.5 p-4 text-sm">
            <dt className="text-text-3">Region</dt>
            <dd className="min-w-0 text-text-1">
              {demo ? (
                <span className="text-text-2">Local sample folder</span>
              ) : region ? (
                <>
                  {regionLabel !== region && <span className="mr-1.5">{regionLabel}</span>}
                  <span className="font-mono text-xs text-text-2">{region}</span>
                </>
              ) : (
                <span className="text-text-2">Unknown</span>
              )}
            </dd>
            <dt className="text-text-3">Videos</dt>
            <dd className="min-w-0 text-text-1">
              <HealthLine demo={demo} health={health} />
            </dd>
            <dt className="text-text-3">Share links</dt>
            <dd className="text-text-2">Expiry chosen when you copy one</dd>
            <dt className="text-text-3">S3 URI</dt>
            <dd className="-my-1 flex min-w-0 items-start gap-1">
              <span className="min-w-0 flex-1 pt-1 font-mono text-xs leading-snug break-all text-text-2">{uri}</span>
              <CopyButton value={uri} label="Copy S3 URI" size="icon-xs" className="mt-0.5" />
            </dd>
          </dl>
          <div className="border-t border-line-2 bg-surface-1 p-2.5">
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/setup">
                <Settings2 aria-hidden data-icon="inline-start" />
                Edit connection
              </Link>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {demo && <DemoBadge />}
    </div>
  );
}

/** The one-time video check, in a line: progress while it runs, then what needs attention. */
function HealthLine({ demo, health }: { demo: boolean; health: BucketHealth | null }) {
  if (!health || health.status === "none") return <span className="text-text-2">Not checked yet</span>;
  if (health.status === "running") {
    const { videos, checked } = health.progress;
    return (
      <span className="flex items-center gap-1.5 text-text-2">
        <Spinner className="size-3 text-brand" />
        {checked ? `Checking ${checked.toLocaleString()} of ${videos.toLocaleString()}` : "Finding videos…"}
      </span>
    );
  }
  const count = attentionCount(health);
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className={count ? "text-danger" : "text-text-1"}>
        {health.status === "failed" ? "Check failed" : count ? `${count.toLocaleString()} need attention` : demo ? "All fine" : "All play fine"}
      </span>
      <Link href="/health" className="text-xs text-brand hover:underline">
        View report
      </Link>
    </span>
  );
}
