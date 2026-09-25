"use client";

import { Suspense, use, useId, useState } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { CopyButton } from "@/components/common/copy-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  bareEtag,
  encryptionLabel,
  flattenJson,
  formatBitrate,
  formatChannels,
  formatDuration,
  formatFrameRate,
  formatSampleRate,
  formatSeconds,
  healthSummary,
  type DetailPart,
  type DetailResponses,
  type ObjectDetails,
  type StreamDetails,
  type VideoDetails,
} from "@/lib/file-details";
import { formatBytes } from "@/lib/format";
import { baseName } from "@/lib/kinds";
import { viewHref } from "@/lib/paths";
import type { FileMeta } from "@/lib/types";
import { cn } from "@/lib/utils";
import { detailPart, forgetPart, type PartResult } from "./file-details-data";
import { exactDateTime, parseDate } from "./file-info";

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Separator className="bg-line-1" />
      <h3 id={id} className="text-xs font-semibold tracking-wide text-text-2 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="pt-1 text-[13px] font-medium text-text-1">{children}</h4>;
}

// A label over a value, with a copy button when there's something worth pasting.
export function Fact({
  label,
  children,
  copy,
  copyLabel,
  mono = false,
  sub,
}: {
  label: string;
  children: React.ReactNode;
  copy?: string | null;
  copyLabel?: string;
  mono?: boolean;
  sub?: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs font-medium [overflow-wrap:anywhere] text-text-3">{label}</dt>
      <dd className="flex min-w-0 items-start gap-2 text-sm text-text-1">
        <span className="min-w-0 flex-1">
          <span dir="auto" className={cn("block [overflow-wrap:anywhere]", mono && "font-mono text-[13px] break-all")}>
            {children}
          </span>
          {sub && <span className="mt-0.5 block text-xs [overflow-wrap:anywhere] text-text-3">{sub}</span>}
        </span>
        {copy ? (
          <CopyButton
            value={copy}
            label={copyLabel ?? `Copy ${label}`}
            className="-my-2 size-10 shrink-0 text-text-2 hover:text-text-1 sm:-my-1 sm:size-7"
          />
        ) : null}
      </dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-text-3">{children}</p>;
}

function Loading({ rows, label }: { rows: number; label: string }) {
  return (
    <div role="status" aria-label={`Loading ${label}`} className="grid gap-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className={cn("h-4", i % 2 ? "w-3/5" : "w-4/5")} />
        </div>
      ))}
    </div>
  );
}

// Fetches one part when first shown and renders it; a slow part never holds up the others.
function Part<P extends DetailPart>({
  bucket,
  fileKey,
  part,
  fallback,
  children,
}: {
  bucket: string;
  fileKey: string;
  part: P;
  fallback: React.ReactNode;
  children: (data: DetailResponses[P]) => React.ReactNode;
}) {
  // Bumped by Retry so the new promise is read.
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    forgetPart(bucket, fileKey, part);
    setAttempt((n) => n + 1);
  };
  return (
    <Suspense fallback={fallback}>
      <Resolved key={attempt} promise={detailPart(bucket, fileKey, part)} onRetry={retry}>
        {children}
      </Resolved>
    </Suspense>
  );
}

function Resolved<P extends DetailPart>({
  promise,
  onRetry,
  children,
}: {
  promise: Promise<PartResult<P>>;
  onRetry: () => void;
  children: (data: DetailResponses[P]) => React.ReactNode;
}) {
  const result = use(promise);
  if (result.ok) return children(result.data);
  return (
    <div className="grid justify-items-start gap-2">
      <p className="text-sm text-text-2">
        <span className="font-medium text-text-1">{result.error.title}.</span> {result.error.message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw aria-hidden data-icon="inline-start" />
        Try again
      </Button>
    </div>
  );
}

export function S3Section({ bucket, file }: { bucket: string; file: FileMeta }) {
  return (
    <Section title="S3 object">
      <Part bucket={bucket} fileKey={file.key} part="s3" fallback={<Loading rows={4} label="S3 object details" />}>
        {(d) => <S3Facts d={d} />}
      </Part>
    </Section>
  );
}

const CHECKSUM_TYPES: Record<string, string> = { FULL_OBJECT: "Full object", COMPOSITE: "Composite (per part)" };

function S3Facts({ d }: { d: ObjectDetails }) {
  // Local (mock) storage answers with nothing but nulls.
  if (d.etag === null && d.storageClass === null && d.tags === null) {
    return <Muted>Files in a local folder have no S3 object metadata.</Muted>;
  }
  const date = (iso: string | null) => {
    const p = parseDate(iso);
    return p ? exactDateTime(p) : iso;
  };
  return (
    <>
      <dl className="grid gap-4">
        {d.etag && (
          <Fact
            label="ETag"
            mono
            copy={bareEtag(d.etag)}
            sub={d.multipartParts ? `Multipart upload in ${d.multipartParts.toLocaleString("en-US")} parts` : undefined}
          >
            {bareEtag(d.etag)}
          </Fact>
        )}
        {d.storageClass && (
          <Fact label="Storage class" mono copy={d.storageClass} sub={d.archiveStatus ?? undefined}>
            {d.storageClass}
          </Fact>
        )}
        {d.restore && (
          <Fact label="Restore" mono copy={d.restore}>
            {d.restore}
          </Fact>
        )}
        {d.versionId && (
          <Fact label="Version ID" mono copy={d.versionId}>
            {d.versionId}
          </Fact>
        )}
        {d.contentEncoding && (
          <Fact label="Content encoding" mono copy={d.contentEncoding}>
            {d.contentEncoding}
          </Fact>
        )}
        {d.contentLanguage && (
          <Fact label="Content language" mono copy={d.contentLanguage}>
            {d.contentLanguage}
          </Fact>
        )}
        {d.cacheControl && (
          <Fact label="Cache-Control" mono copy={d.cacheControl}>
            {d.cacheControl}
          </Fact>
        )}
        {d.contentDisposition && (
          <Fact label="Content-Disposition" mono copy={d.contentDisposition}>
            {d.contentDisposition}
          </Fact>
        )}
        {d.expires && (
          <Fact label="Expires header" copy={d.expires}>
            {date(d.expires)}
          </Fact>
        )}
        <Fact
          label="Encryption"
          copy={d.serverSideEncryption}
          sub={d.bucketKeyEnabled ? "S3 Bucket Key enabled" : undefined}
        >
          {d.serverSideEncryption ? encryptionLabel(d.serverSideEncryption) : d.sseCustomerAlgorithm ? `SSE-C (${d.sseCustomerAlgorithm})` : "None reported"}
        </Fact>
        {d.kmsKeyId && (
          <Fact label="KMS key ID" mono copy={d.kmsKeyId}>
            {d.kmsKeyId}
          </Fact>
        )}
        {d.checksums.map((c) => (
          <Fact
            key={c.algorithm}
            label={`Checksum (${c.algorithm})`}
            copyLabel={`Copy ${c.algorithm} checksum`}
            mono
            copy={c.value}
            sub={d.checksumType ? (CHECKSUM_TYPES[d.checksumType] ?? d.checksumType) : undefined}
          >
            {c.value}
          </Fact>
        ))}
        {d.expiration && (
          <Fact label="Lifecycle expiry" mono copy={d.expiration}>
            {d.expiration}
          </Fact>
        )}
        {d.replicationStatus && <Fact label="Replication">{d.replicationStatus}</Fact>}
        {d.objectLockMode && (
          <Fact label="Object Lock" sub={d.objectLockRetainUntil ? `Retained until ${date(d.objectLockRetainUntil)}` : undefined}>
            {d.objectLockMode}
          </Fact>
        )}
        {d.objectLockLegalHold && <Fact label="Legal hold">{d.objectLockLegalHold}</Fact>}
      </dl>

      <SubHeading>User metadata</SubHeading>
      {d.metadata.length ? (
        <dl className="grid gap-4">
          {d.metadata.map((m) => (
            <Fact key={m.key} label={`x-amz-meta-${m.key}`} mono copy={m.value}>
              {m.value}
            </Fact>
          ))}
        </dl>
      ) : (
        <Muted>None</Muted>
      )}

      <SubHeading>Tags</SubHeading>
      {d.tags?.status === "ok" ? (
        d.tags.tags.length ? (
          <dl className="grid gap-4">
            {d.tags.tags.map((t) => (
              <Fact key={t.key} label={t.key} mono copy={t.value} copyLabel={`Copy tag ${t.key}`}>
                {t.value}
              </Fact>
            ))}
          </dl>
        ) : (
          <Muted>None</Muted>
        )
      ) : d.tags?.status === "denied" ? (
        <Muted>Tags: not readable with these keys</Muted>
      ) : (
        <Muted>Tags couldn’t be read{d.tags?.status === "error" ? `: ${d.tags.message}` : "."}</Muted>
      )}
    </>
  );
}

export function VideoSection({ bucket, file }: { bucket: string; file: FileMeta }) {
  return (
    <Section title="Video">
      <Part bucket={bucket} fileKey={file.key} part="video" fallback={<Loading rows={5} label="video details" />}>
        {(r) =>
          r.status === "ok" ? (
            <VideoFacts v={r.video} />
          ) : (
            <div className="grid gap-1">
              <p className="text-sm text-text-1">Video details unavailable</p>
              {r.status === "unavailable" && <p className="text-xs [overflow-wrap:anywhere] text-text-3">{r.reason}</p>}
            </div>
          )
        }
      </Part>
    </Section>
  );
}

const STREAM_NAMES: Record<string, string> = { video: "Video", audio: "Audio", subtitle: "Subtitle", data: "Data", attachment: "Attachment" };

function VideoFacts({ v }: { v: VideoDetails }) {
  const f = v.format;
  const seconds = formatSeconds(f.duration);
  const counts = new Map<string, number>();
  return (
    <>
      <dl className="grid gap-4">
        {(f.longName || f.name) && (
          <Fact label="Container" copy={f.name} copyLabel="Copy container format" sub={f.longName && f.name ? f.name : undefined}>
            {f.longName ?? f.name}
          </Fact>
        )}
        {f.duration !== null && (
          <Fact label="Duration" copy={seconds} copyLabel="Copy duration in seconds" sub={`${seconds} seconds`}>
            <span className="tabular-nums">{formatDuration(f.duration)}</span>
          </Fact>
        )}
        {f.bitRate !== null && (
          <Fact label="Overall bitrate" copy={String(f.bitRate)} copyLabel="Copy overall bitrate in bits per second" sub={`${f.bitRate.toLocaleString("en-US")} b/s`}>
            {formatBitrate(f.bitRate)}
          </Fact>
        )}
        {f.startTime !== null && f.startTime !== 0 && <Fact label="Start time">{formatSeconds(f.startTime)} s</Fact>}
      </dl>

      {v.streams.map((s) => {
        const n = (counts.get(s.type) ?? 0) + 1;
        counts.set(s.type, n);
        const perType = v.streams.filter((x) => x.type === s.type).length;
        const name = `${STREAM_NAMES[s.type] ?? s.type} stream${perType > 1 ? ` ${n}` : ""}`;
        return (
          <div key={s.index} className="grid gap-4">
            <SubHeading>
              {name} <span className="font-normal text-text-3">#{s.index}</span>
            </SubHeading>
            <StreamFacts s={s} name={name.toLowerCase()} />
          </div>
        );
      })}

      {f.tags.length > 0 && (
        <>
          <SubHeading>Container tags</SubHeading>
          <dl className="grid gap-4">
            {f.tags.map((t) => (
              <TagFact key={t.key} k={t.key} value={t.value} />
            ))}
          </dl>
        </>
      )}
    </>
  );
}

function TagFact({ k, value, scope }: { k: string; value: string; scope?: string }) {
  const d = /(^|_)(creation_)?time$|date$/i.test(k) ? parseDate(value) : null;
  return (
    <Fact label={k} mono copy={value} copyLabel={`Copy ${scope ? `${scope} ` : ""}${k}`} sub={d ? exactDateTime(d) : undefined}>
      {value}
    </Fact>
  );
}

function StreamFacts({ s, name }: { s: StreamDetails; name: string }) {
  const codecNote = [s.profile, s.level ? `level ${s.level}` : null].filter(Boolean).join(", ");
  const picture = [s.bitDepth ? `${s.bitDepth}-bit` : null, s.colorSpace, s.fieldOrder].filter(Boolean).join(" · ");
  const avg = s.avgFrameRate && s.avgFrameRate !== s.frameRate ? formatFrameRate(s.avgFrameRate) : null;
  return (
    <dl className="grid gap-4">
      {s.codec && (
        <Fact label="Codec" copy={s.codec} copyLabel={`Copy ${name} codec`} sub={s.codecLong}>
          <span className="font-mono text-[13px]">{s.codec}</span>
          {codecNote && <span className="text-text-2"> ({codecNote})</span>}
        </Fact>
      )}
      {s.codecString && (
        <Fact label="Codec string" mono copy={s.codecString} copyLabel={`Copy ${name} codec string`} sub={s.codecTag ? `Tag ${s.codecTag}` : undefined}>
          {s.codecString}
        </Fact>
      )}
      {s.type === "video" && (
        <>
          {s.width && s.height && (
            <Fact
              label="Resolution"
              copy={`${s.width}x${s.height}`}
              copyLabel={`Copy ${name} resolution`}
              sub={s.displayAspectRatio ? `Display aspect ${s.displayAspectRatio}` : undefined}
            >
              <span className="tabular-nums">
                {s.width} × {s.height}
              </span>
            </Fact>
          )}
          {s.frameRate && (
            <Fact label="Frame rate" copy={s.frameRate} copyLabel={`Copy ${name} frame rate`} sub={[s.frameRate, avg ? `average ${avg}` : null].filter(Boolean).join(" · ")}>
              {formatFrameRate(s.frameRate) ?? s.frameRate}
            </Fact>
          )}
          {s.pixelFormat && (
            <Fact label="Pixel format" mono copy={s.pixelFormat} copyLabel={`Copy ${name} pixel format`} sub={picture || undefined}>
              {s.pixelFormat}
            </Fact>
          )}
          <Fact label="Rotation">{s.rotation ? `${s.rotation}°` : "None"}</Fact>
        </>
      )}
      {s.type === "audio" && (
        <>
          {s.sampleRate && (
            <Fact label="Sample rate" copy={String(s.sampleRate)} copyLabel={`Copy ${name} sample rate`} sub={s.sampleFormat ?? undefined}>
              {formatSampleRate(s.sampleRate)}
            </Fact>
          )}
          {(s.channels || s.channelLayout) && <Fact label="Channels">{formatChannels(s.channels, s.channelLayout)}</Fact>}
        </>
      )}
      {s.bitRate !== null && (
        <Fact label="Bitrate" copy={String(s.bitRate)} copyLabel={`Copy ${name} bitrate in bits per second`}>
          {formatBitrate(s.bitRate)}
        </Fact>
      )}
      {(s.duration !== null || s.frames !== null) && (
        <Fact label="Length">
          {[
            s.duration !== null ? `${formatDuration(s.duration)} (${formatSeconds(s.duration)} s)` : null,
            s.frames !== null ? `${s.frames.toLocaleString("en-US")} ${s.type === "video" ? "frames" : "packets"}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Fact>
      )}
      {s.language && <Fact label="Language">{s.language}</Fact>}
      {s.tags
        .filter((t) => t.key !== "language")
        .map((t) => (
          <TagFact key={t.key} k={t.key} value={t.value} scope={name} />
        ))}
    </dl>
  );
}

const TONES = { ok: "text-text-1", warn: "text-brand", bad: "text-danger", none: "text-text-2" } as const;

export function HealthSection({ bucket, file }: { bucket: string; file: FileMeta }) {
  return (
    <Section title="Health">
      <Part bucket={bucket} fileKey={file.key} part="health" fallback={<Loading rows={1} label="health" />}>
        {(h) => {
          const s = healthSummary(h, file);
          const checked = h.status === "done" ? parseDate(h.finishedAt) : null;
          return (
            <dl className="grid gap-4">
              <Fact
                label="Bucket check"
                sub={
                  <>
                    {s.detail}
                    {s.detail && checked ? " " : ""}
                    {checked && <>Checked {exactDateTime(checked)}. </>}
                    <Link href="/health" className="text-brand underline-offset-4 hover:underline">
                      Bucket health
                    </Link>
                  </>
                }
              >
                <span className={cn("font-medium", TONES[s.tone])}>{s.label}</span>
              </Fact>
            </dl>
          );
        }}
      </Part>
    </Section>
  );
}

export function SidecarSection({ bucket, file }: { bucket: string; file: FileMeta }) {
  // Appears only when the sidecar exists, so nothing is drawn while looking for it.
  return (
    <Part bucket={bucket} fileKey={file.key} part="sidecar" fallback={null}>
      {(r) => {
        if (r.status === "none") return null;
        const name = baseName(r.key);
        const open = (
          <Link href={viewHref(r.key)} className="font-mono text-[13px] break-all text-brand underline-offset-4 hover:underline">
            {name}
          </Link>
        );
        if (r.status !== "ok") {
          return (
            <Section title="Sidecar metadata">
              <p className="text-sm text-text-2">
                {open}{" "}
                {r.status === "too-big"
                  ? `is ${formatBytes(r.size)}, larger than the 64 KB shown here.`
                  : r.status === "invalid"
                    ? `isn’t valid JSON: ${r.message}`
                    : `couldn’t be read: ${r.message}`}
              </p>
            </Section>
          );
        }
        const { rows, truncated } = flattenJson(r.data);
        return (
          <Section title="Sidecar metadata">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">{open}</span>
              <CopyButton value={JSON.stringify(r.data, null, 2)} label="Copy JSON" showLabel variant="outline" toastMessage="JSON copied" />
            </div>
            <dl className="grid gap-4">
              {rows.map((row, i) => (
                <Fact key={i} label={row.label} mono copy={row.value} copyLabel={`Copy ${row.label}`}>
                  {row.value}
                </Fact>
              ))}
            </dl>
            {truncated && <Muted>Only the first {rows.length} values are shown. Open the file for the rest.</Muted>}
          </Section>
        );
      }}
    </Part>
  );
}
