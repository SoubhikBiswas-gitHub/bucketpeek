"use client";

import { useId, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronDown, HeartPulse, RefreshCw } from "lucide-react";
import { KindIcon } from "@/components/common/kind-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useMediaQuery, MOBILE_QUERY } from "@/components/browser/use-media-query";
import { formatBytes, formatDateTime, formatRelative, plural } from "@/lib/format";
import { inventoryRows } from "@/lib/inventory";
import { kindColor } from "@/lib/kinds";
import type { BucketHealth, BucketInventory } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useBucketHealth } from "./use-bucket-health";

// Open or closed, as the viewer last left it; unset means open from `sm`, closed on phones.
const OPEN_KEY = "lens:bucket-overview";
const listeners = new Set<() => void>();
let memory: boolean | null | undefined;

function readOpen(): boolean | null {
  if (memory !== undefined) return memory;
  try {
    const v = window.localStorage.getItem(OPEN_KEY);
    return v === "open" ? true : v === "closed" ? false : null;
  } catch {
    return null;
  }
}

function writeOpen(open: boolean) {
  memory = open;
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "open" : "closed");
  } catch {
    // Storage blocked: remembered for this page load only.
  }
  listeners.forEach((l) => l());
}

function subscribeOpen(onChange: () => void) {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}

function useOpenPreference(): [boolean, (open: boolean) => void] {
  const saved = useSyncExternalStore(subscribeOpen, readOpen, () => null);
  const mobile = useMediaQuery(MOBILE_QUERY);
  return [saved ?? !mobile, writeOpen];
}

// Fetching the health also starts the one-time bucket check the first time a bucket is opened.
export function BrowseOverview() {
  const { health, error, rescan } = useBucketHealth();
  return <BucketOverview health={health} error={error} onRescan={rescan} collapsible healthLink />;
}

export interface BucketOverviewProps {
  health: BucketHealth | null;
  error?: string | null;
  // Left out on a page with its own "Scan again".
  onRescan?: () => Promise<void> | void;
  collapsible?: boolean;
  healthLink?: boolean;
}

export function BucketOverview({ health, error, onRescan, collapsible = false, healthLink = false }: BucketOverviewProps) {
  const titleId = useId();
  const [savedOpen, setOpen] = useOpenPreference();
  const open = collapsible ? savedOpen : true;

  const inventory: BucketInventory | undefined =
    health?.status === "done" ? health.inventory : health?.status === "running" ? health.progress.inventory : undefined;
  const running = health?.status === "running";
  const hasCards = !!inventory?.files;

  const heading = "text-sm font-semibold whitespace-nowrap text-text-1";

  return (
    <Card size="sm" className="gap-0 py-0" role="region" aria-labelledby={titleId}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex min-h-11 items-center gap-x-3 px-3 py-1.5">
          {collapsible && hasCards ? (
            // Disclosure pattern: the heading holds the button, whose aria-expanded tells the state.
            <h2 id={titleId} className="shrink-0">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className={cn("-ml-1.5 px-1.5 aria-expanded:bg-transparent aria-expanded:hover:bg-surface-3", heading)}>
                  <ChevronDown aria-hidden className={cn("transition-transform duration-150 motion-reduce:transition-none", !open && "-rotate-90")} />
                  Bucket overview
                </Button>
              </CollapsibleTrigger>
            </h2>
          ) : (
            <h2 id={titleId} className={cn("shrink-0", heading)}>
              Bucket overview
            </h2>
          )}
          <Summary health={health} error={error ?? null} />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onRescan && health && needsRescan(health) && (
              <Button variant="outline" size="sm" onClick={() => void onRescan()}>
                <RefreshCw aria-hidden data-icon="inline-start" />
                Scan again
              </Button>
            )}
            {healthLink && (
              <Button asChild variant="ghost" size="sm" className="text-text-2 hover:text-text-1">
                <Link href="/health" aria-label="Bucket health">
                  <HeartPulse aria-hidden data-icon="inline-start" />
                  <span className="max-sm:hidden">Bucket health</span>
                </Link>
              </Button>
            )}
          </div>
        </div>

        {running && health.progress.checked > 0 && (
          <Progress
            className="mx-3 mb-2 w-auto"
            value={health.progress.videos ? Math.min(100, (health.progress.checked / health.progress.videos) * 100) : 0}
            aria-label="Video check progress"
          />
        )}

        {hasCards && (
          <CollapsibleContent>
            <KindCards inventory={inventory} />
            {health?.status === "done" && (
              // The facts the header drops on phones.
              <p className="px-3 pb-2.5 -mt-1 text-xs text-text-3 sm:hidden">
                {plural(health.totals.folders, "folder")} · counted {formatRelative(health.finishedAt)}
              </p>
            )}
          </CollapsibleContent>
        )}
      </Collapsible>
    </Card>
  );
}

// A report saved before the overview existed, or a check that stopped.
function needsRescan(h: BucketHealth): boolean {
  return h.status === "failed" || (h.status === "done" && !h.inventory);
}

function Summary({ health, error }: { health: BucketHealth | null; error: string | null }) {
  const line = "min-w-0 flex-1 truncate text-xs text-text-2";
  if (!health || health.status === "none") {
    if (error) return <p className={cn(line, "text-danger")}>Couldn’t load the overview: {error}</p>;
    return (
      <p className={cn(line, "flex items-center gap-1.5")}>
        <Spinner aria-hidden className="size-3 text-text-3" />
        Loading…
      </p>
    );
  }
  if (health.status === "failed") return <p className={cn(line, "text-danger")} title={health.error}>The count stopped: {health.error}</p>;
  if (health.status === "running") {
    const { folders, videos, checked, inventory } = health.progress;
    const files = inventory?.files ?? 0;
    return (
      <p className={cn(line, "flex items-center gap-1.5")} role="status" aria-live="polite">
        <Spinner aria-hidden className="size-3 shrink-0 text-brand" />
        <span className="truncate">
          {checked === 0
            ? `Counting files… ${plural(files, "file")}${inventory ? ` · ${formatBytes(inventory.bytes)}` : ""} in ${plural(folders, "folder")} so far`
            : `${plural(files, "file")} counted · checking videos, ${checked.toLocaleString("en-US")} of ${videos.toLocaleString("en-US")}`}
        </span>
      </p>
    );
  }
  if (!health.inventory) {
    return (
      <p className={line} title="This report was saved before the overview existed.">
        Scan again to see the overview
      </p>
    );
  }
  const { files, bytes } = health.inventory;
  return (
    <p className={line}>
      <span className="font-medium text-text-1">{plural(files, "file")}</span>
      {" · "}
      <span className="font-medium text-text-1">{formatBytes(bytes)}</span>
      <span className="max-sm:hidden">
        {" · "}
        {plural(health.totals.folders, "folder")}
        {" · counted "}
        <time dateTime={health.finishedAt} title={formatDateTime(health.finishedAt)}>
          {formatRelative(health.finishedAt)}
        </time>
      </span>
    </p>
  );
}

function KindCards({ inventory }: { inventory: BucketInventory }) {
  const rows = inventoryRows(inventory);
  return (
    <ul aria-label="Files by type" className="flex flex-wrap gap-2 px-3 pb-2.5">
      {rows.map(({ kind, label, tally, share }) => (
        <li
          key={kind}
          data-kind={kind}
          title={`${percent(share)} of the bucket’s bytes`}
          className="relative flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-line-1 bg-surface-2 py-1.5 pr-3 pl-2"
        >
          <KindIcon kind={kind} size={14} tile tileSize={26} />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="flex items-baseline gap-1 whitespace-nowrap">
              <span className="text-sm font-semibold tabular-nums text-text-1">{tally.files.toLocaleString("en-US")}</span>
              <span className="text-xs text-text-2">{label}</span>
            </span>
            <span className="text-xs whitespace-nowrap tabular-nums text-text-3">{formatBytes(tally.bytes)}</span>
          </span>
          <span
            aria-hidden
            className="absolute bottom-0 left-0 h-0.5"
            style={{ width: `max(2px, ${share * 100}%)`, backgroundColor: `color-mix(in oklab, ${kindColor(kind)} 70%, transparent)` }}
          />
        </li>
      ))}
    </ul>
  );
}

const percent = (share: number) => (share >= 0.995 ? "100%" : share < 0.01 ? "under 1%" : `${Math.round(share * 100)}%`);
