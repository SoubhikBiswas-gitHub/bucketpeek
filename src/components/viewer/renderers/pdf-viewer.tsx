"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Download, ExternalLink, FileWarning, Maximize2, Minimize2 } from "lucide-react";
import { KindIcon } from "@/components/common/kind-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDownloadHref, useFullscreen, useMediaQuery } from "../media/hooks";
import { ToolButton } from "../media/tool-button";

export interface PdfViewerProps {
  url: string;
  name: string;
}

// After this long without a load event, offer the new-tab route while the embed keeps trying.
const SLOW_AFTER_MS = 12_000;

type Probe = { ok: true } | { ok: false; status: number };

// SigV4 presigned URLs carry their own lifetime in X-Amz-Date + X-Amz-Expires.
function presignedExpired(url: string): boolean {
  try {
    const q = new URL(url, "http://local").searchParams;
    const date = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(q.get("X-Amz-Date") ?? "");
    const expires = Number(q.get("X-Amz-Expires"));
    if (!date || !expires) return false;
    const [, y, mo, d, h, mi, se] = date.map(Number);
    return Date.now() > Date.UTC(y, mo - 1, d, h, mi, se) + expires * 1000;
  } catch {
    return false;
  }
}

// `navigator.pdfViewerEnabled` is false on most phones and where the built-in viewer is turned off.
function usePdfViewerEnabled(): boolean | null {
  return useSyncExternalStore(
    () => () => {},
    () => (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false,
    () => null,
  );
}

// Embedded PDFs don't work on phones, tablets or browsers without a built-in viewer, so those get a card.
export function PdfViewer({ url, name }: PdfViewerProps) {
  const viewerEnabled = usePdfViewerEnabled();
  const touchOrNarrow = useMediaQuery("(pointer: coarse), (max-width: 639px)");

  if (viewerEnabled === null || touchOrNarrow === null) return <PdfSkeleton />;
  if (!viewerEnabled || touchOrNarrow) return <PdfCard url={url} name={name} />;
  return <PdfEmbed url={url} name={name} />;
}

function PdfEmbed({ url, name }: PdfViewerProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(frameRef);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [expired] = useState(() => presignedExpired(url));

  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, []);

  // An iframe can't report HTTP errors. Presigned links carry their expiry, so check that first;
  // same-origin links (mock mode, proxies) can also be probed for a status without CORS noise.
  useEffect(() => {
    if (expired) return;
    let target: URL;
    try {
      target = new URL(url, window.location.href);
    } catch {
      return;
    }
    if (target.origin !== window.location.origin) return;
    const ctrl = new AbortController();
    fetch(target, { headers: { Range: "bytes=0-0" }, signal: ctrl.signal, cache: "no-store" })
      .then((r) => {
        void r.body?.cancel();
        setProbe(r.ok ? { ok: true } : { ok: false, status: r.status });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [url, expired]);

  if (expired) return <PdfCard url={url} name={name} status={403} />;
  if (probe && !probe.ok) return <PdfCard url={url} name={name} status={probe.status} />;

  return (
    <div ref={frameRef} className="flex h-full min-h-0 flex-col bg-surface-1">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-1 px-1.5 sm:px-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-1.5">
          <KindIcon kind="pdf" size={16} />
          <span className="truncate text-[13px] text-text-2" title={name}>
            {name}
          </span>
        </div>
        <div className="flex shrink-0 items-center" role="group" aria-label="PDF controls">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon" className="text-text-2">
                <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open PDF in a new tab">
                  <ExternalLink />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Open in new tab
            </TooltipContent>
          </Tooltip>
          {fullscreen.supported && (
            <ToolButton
              label={fullscreen.active ? "Exit full screen" : "Full screen"}
              onClick={() => void fullscreen.toggle()}
            >
              {fullscreen.active ? <Minimize2 /> : <Maximize2 />}
            </ToolButton>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-surface-0">
        <iframe
          src={url}
          title={`PDF preview of ${name}`}
          referrerPolicy="no-referrer"
          allow="fullscreen"
          onLoad={() => setLoaded(true)}
          className={cn(
            "absolute inset-0 size-full border-0 transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
        {!loaded && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
            <Skeleton className="absolute inset-x-[max(1.5rem,calc(50%-18rem))] inset-y-6 rounded-md bg-surface-2/70" />
            <div className="relative flex flex-col items-center gap-2 text-[13px] text-text-2" role="status">
              <Spinner aria-hidden className="size-5 text-text-3" />
              Loading PDF
            </div>
          </div>
        )}
        {slow && !loaded && (
          <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-2 bg-surface-2 px-4 py-3 shadow-lg sm:inset-x-auto sm:left-1/2 sm:flex-nowrap sm:w-[min(36rem,calc(100%-1.5rem))] sm:-translate-x-1/2">
            <p className="min-w-0 flex-1 text-[13px] text-text-2">
              This PDF is taking a while. It may open faster in a new tab.
            </p>
            <Button asChild size="sm" variant="outline">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink data-icon="inline-start" />
                Open in new tab
              </a>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PdfSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy>
      <div className="flex h-11 shrink-0 items-center border-b border-line-1 px-3">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="relative min-h-0 flex-1 bg-surface-0">
        <Skeleton className="absolute inset-x-[max(1.5rem,calc(50%-18rem))] inset-y-6 rounded-md bg-surface-2/70" />
      </div>
    </div>
  );
}

function statusMessage(status?: number): { title: string; body: string } | null {
  if (status === undefined) return null;
  if (status === 403) {
    return { title: "The PDF link has expired", body: "Reload the page to get a fresh link, or download the file." };
  }
  if (status === 404)
    return { title: "This PDF no longer exists", body: "It may have been moved or deleted from the bucket." };
  return { title: "This PDF couldn’t be loaded", body: `The storage service answered with an error (${status}).` };
}

function PdfCard({ url, name, status }: PdfViewerProps & { status?: number }) {
  const dl = useDownloadHref();
  const error = statusMessage(status);

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-5 py-8 text-center">
      <div
        className={cn(
          "grid size-16 shrink-0 place-items-center rounded-xl border",
          error ? "border-danger-line bg-danger-mist text-danger" : "border-line-2 bg-surface-2",
        )}
      >
        {error ? (
          <FileWarning aria-hidden size={28} strokeWidth={1.5} />
        ) : (
          <KindIcon kind="pdf" size={30} strokeWidth={1.5} />
        )}
      </div>
      <h2 className="mt-5 max-w-md text-[17px] font-semibold tracking-tight text-text-1">
        {error ? error.title : "Open the PDF to read it"}
      </h2>
      <p className="mt-2 max-w-sm text-[13px] leading-relaxed [overflow-wrap:anywhere] text-text-2">
        {error
          ? error.body
          : `This browser can’t show PDFs inside the page. Open ${name} in your PDF viewer or save a copy.`}
      </p>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2 sm:w-auto sm:max-w-none sm:flex-row">
        {!error && (
          <Button asChild size="lg">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink data-icon="inline-start" />
              Open PDF
            </a>
          </Button>
        )}
        {dl && (
          <Button asChild size="lg" variant={error ? "default" : "outline"}>
            <a href={dl} download>
              <Download data-icon="inline-start" />
              Download
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
