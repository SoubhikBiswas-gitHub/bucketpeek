"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, FileVideo, HeartPulse, RefreshCw, Wrench } from "lucide-react";
import { writeClipboard } from "@/components/browser/clipboard";
import { CopyButton } from "@/components/common/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/format";
import { viewHref } from "@/lib/paths";
import type { BucketHealth, HealthProblem, HealthProblemKind } from "@/lib/types";
import { toast } from "sonner";
import { BucketOverview } from "./bucket-overview";
import { useBucketHealth } from "./use-bucket-health";

// Rows per group before "Show all", and at most after it (the copy button covers the rest).
const FIRST_ROWS = 10;
const MAX_ROWS = 500;

const GROUPS: { kind: HealthProblemKind; title: string; what: string; fix: string; tone: "danger" | "brand" }[] = [
  {
    kind: "damaged",
    title: "Damaged",
    what: "The file’s index doesn’t point at its video, in a way Deccan Lens can’t correct. No player can show it.",
    fix: "Re-export it from the original recording.",
    tone: "danger",
  },
  {
    kind: "empty",
    title: "Empty",
    what: "The file is 0 bytes: the upload stored nothing.",
    fix: "Upload it again from the source.",
    tone: "danger",
  },
  {
    kind: "no-index",
    title: "No index",
    what: "The file has video data but no index (moov), usually a recording that stopped before it finished.",
    fix: "Re-export it, or recover it from the recorder.",
    tone: "danger",
  },
  {
    kind: "unreadable",
    title: "Couldn’t be read",
    what: "Reading the file failed, or it isn’t a valid MP4/MOV.",
    fix: "Check the file; open it to see the error.",
    tone: "danger",
  },
  {
    kind: "repairable",
    title: "Repaired when played",
    what: "The index points a fixed distance off for part of the file. Deccan Lens corrects it on the fly, but other players show black or fail.",
    fix: "Re-export it so it plays everywhere.",
    tone: "brand",
  },
];

export function HealthReport({ bucket }: { bucket: string }) {
  const { health, error, rescan } = useBucketHealth();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text-1">
            <HeartPulse aria-hidden className="size-5 text-brand" />
            Bucket health
          </h1>
          <p className="mt-1 text-sm text-text-2">
            Every video in <span className="font-mono break-all text-text-1">{bucket}</span>, checked once when the bucket was first opened.
          </p>
        </div>
        {health && health.status !== "running" && (
          <Button variant="outline" size="sm" onClick={() => void rescan()}>
            <RefreshCw aria-hidden data-icon="inline-start" />
            Scan again
          </Button>
        )}
      </header>

      {/* Padded so cards' outlines (drawn just outside them) aren't clipped by the scroll edge. */}
      <div className="-mx-1 min-h-0 flex-1 overflow-auto overscroll-contain px-1 pt-1">
        {error && !health ? (
          <p role="alert" className="text-sm text-danger">
            Couldn’t load the check: {error}
          </p>
        ) : !health ? (
          <div className="grid place-items-center py-16">
            <Spinner className="size-5 text-text-3" />
          </div>
        ) : (
          <>
            {health.status === "done" && (
              <div className="pb-4">
                <BucketOverview health={health} />
              </div>
            )}
            <Body health={health} bucket={bucket} />
          </>
        )}
      </div>
    </div>
  );
}

function Body({ health, bucket }: { health: BucketHealth; bucket: string }) {
  if (health.status === "none") return null;
  if (health.status === "failed") {
    return (
      <p role="alert" className="text-sm text-danger">
        The last check stopped: {health.error}
      </p>
    );
  }
  if (health.status === "running") {
    const { folders, videos, checked, checkingSince, startedAt } = health.progress;
    const listing = checked === 0;
    const left = timeLeft(checkingSince ?? startedAt, checked, videos);
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Spinner className="size-4 text-brand" />
            {listing ? "Finding videos…" : "Checking videos…"}
          </CardTitle>
          <CardDescription aria-live="polite">
            {listing
              ? `${folders.toLocaleString()} folders, ${videos.toLocaleString()} videos so far`
              : `${checked.toLocaleString()} of ${videos.toLocaleString()} videos checked${left ? ` · ${left}` : ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={listing || !videos ? 0 : Math.min(100, (checked / videos) * 100)} aria-label="Check progress" />
          <p className="mt-3 text-xs text-text-3">You can keep browsing; this runs on the server and is saved when it finishes.</p>
        </CardContent>
      </Card>
    );
  }

  const t = health.totals;
  const attention = t.empty + t.noIndex + t.repairable + t.damaged + t.unreadable;
  const fine = t.videos - attention;
  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<FileVideo aria-hidden className="size-4 text-text-3" />} label="Videos checked" value={t.videos.toLocaleString()} note={`${formatBytes(t.bytes)} in ${t.folders.toLocaleString()} folders`} />
        <Stat icon={<CircleCheck aria-hidden className="size-4 text-kind-data" />} label="Play fine" value={fine.toLocaleString()} note={t.videos ? `${((fine / t.videos) * 100).toFixed(1)}%` : "—"} />
        <Stat
          icon={<CircleAlert aria-hidden className={attention ? "size-4 text-danger" : "size-4 text-text-3"} />}
          label="Need attention"
          value={attention.toLocaleString()}
          note={`Checked ${new Date(health.finishedAt).toLocaleString()}`}
        />
      </div>

      {attention === 0 ? (
        <Empty className="border border-line-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleCheck aria-hidden />
            </EmptyMedia>
            <EmptyTitle>Every video looks fine</EmptyTitle>
            <EmptyDescription>No empty, damaged or unreadable videos were found.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        GROUPS.map((g) => {
          const items = health.problems.filter((p) => p.kind === g.kind);
          return items.length ? <Group key={g.kind} group={g} items={items} bucket={bucket} /> : null;
        })
      )}
    </div>
  );
}

// "about 6 min left", from the pace so far; nothing until there's enough to go on.
function timeLeft(since: string | undefined, checked: number, total: number): string | null {
  if (!since || checked < 50 || checked >= total) return null;
  const elapsed = Date.now() - new Date(since).getTime();
  if (elapsed < 5000) return null;
  const seconds = ((total - checked) * elapsed) / checked / 1000;
  if (seconds < 60) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `about ${minutes} min left` : `about ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

function Stat({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="flex items-center gap-2 text-xs text-text-2">
          {icon}
          {label}
        </span>
        <span className="text-2xl font-semibold tabular-nums text-text-1">{value}</span>
        <span className="truncate text-xs text-text-3">{note}</span>
      </CardContent>
    </Card>
  );
}

function Group({ group, items, bucket }: { group: (typeof GROUPS)[number]; items: HealthProblem[]; bucket: string }) {
  const paths = items.map((p) => `s3://${bucket}/${p.key}`).join("\n");
  const [all, setAll] = useState(false);
  const shown = items.slice(0, all ? MAX_ROWS : FIRST_ROWS);
  return (
    <section aria-labelledby={`health-${group.kind}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 max-w-3xl">
          <h2 id={`health-${group.kind}`} className="flex items-center gap-2 text-sm font-semibold text-text-1">
            {group.kind === "repairable" ? <Wrench aria-hidden className="size-4 text-brand" /> : <CircleAlert aria-hidden className="size-4 text-danger" />}
            {group.title}
            <Badge variant={group.tone === "danger" ? "destructive" : "default"}>{items.length.toLocaleString()}</Badge>
          </h2>
          <p className="mt-1 text-sm text-text-2">
            {group.what} <span className="text-text-1">{group.fix}</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await writeClipboard(paths);
              toast.success(`Copied ${items.length.toLocaleString()} S3 path${items.length === 1 ? "" : "s"}`);
            } catch {
              toast.error("Couldn’t copy the S3 paths", { description: "Your browser blocked clipboard access." });
            }
          }}
        >
          Copy all S3 paths
        </Button>
      </div>
      <ul className="divide-y divide-line-1 overflow-hidden rounded-lg border border-line-1 bg-surface-1">
        {shown.map((p) => {
          const slash = p.key.lastIndexOf("/");
          return (
            <li key={p.key} className="flex min-w-0 items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <Link href={viewHref(p.key)} className="block truncate text-sm text-text-1 hover:underline" title={p.key}>
                  {p.key.slice(slash + 1)}
                </Link>
                <p className="truncate font-mono text-xs text-text-3" title={p.detail}>
                  {slash > 0 ? p.key.slice(0, slash + 1) : "/"}
                </p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-text-2">{formatBytes(p.size)}</span>
              <CopyButton value={`s3://${bucket}/${p.key}`} label="Copy S3 path" size="icon-sm" />
            </li>
          );
        })}
      </ul>
      {items.length > FIRST_ROWS && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${items.length.toLocaleString()}`}
          </Button>
          {all && items.length > MAX_ROWS && (
            <span className="text-xs text-text-3">
              Showing {MAX_ROWS.toLocaleString()} of {items.length.toLocaleString()}. “Copy all S3 paths” copies every one.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
