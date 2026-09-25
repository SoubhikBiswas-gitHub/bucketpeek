"use client";
import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { StagePanel } from "./stage-panel";

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function useElapsed(startedAt: number) {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(mountedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // startedAt can briefly predate this overlay (switching from direct playback); never count that time.
  return Math.max(0, now - Math.max(startedAt, mountedAt));
}

export interface ConvertingOverlayProps {
  // Short type label, e.g. "AVI".
  type: string;
  startedAt: number;
  reason: StreamReason;
  // The server's own explanation, when it chose to stream the file.
  why?: string;
}

// The container or codec needs converting, the file is fragmented or has an index too big to wait for,
// or direct playback turned out slow.
export type StreamReason = "format" | "codec" | "fragments" | "layout" | "slow";

const COPY: Record<StreamReason, { title: (type: string) => string; body: (type: string) => string }> = {
  format: { title: (t) => `Converting ${t} for playback`, body: (t) => `Browsers can’t play ${t} files, so it’s converted on this machine as it plays.` },
  codec: {
    title: (t) => `Converting ${t} for playback`,
    body: () => "This browser can’t decode the video inside this file, so it’s converted on this machine as it plays.",
  },
  fragments: {
    title: () => "Preparing the stream",
    body: () => "This file is recorded in fragments. Deccan Lens sends them in playing order, so it starts without reading the whole file first.",
  },
  layout: { title: () => "Preparing the stream", body: () => "This file isn’t laid out for streaming, so Deccan Lens streams it instead." },
  slow: {
    title: () => "Switching to a faster stream",
    body: () => "The file was slow to load directly, so Deccan Lens streams it instead. Playback continues from the same spot.",
  },
};

export function ConvertingOverlay({ type, startedAt, reason, why }: ConvertingOverlayProps) {
  const elapsed = useElapsed(startedAt);
  const slow = elapsed > 10_000;
  const stepText = "Reading the video";

  return (
    <StagePanel
      aria-busy="true"
      aria-labelledby="convert-title"
      aria-describedby="convert-reason"
      style={{ backgroundImage: "radial-gradient(50% 55% at 50% 45%, var(--brand-mist), transparent)" }}
    >
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div
          role="status"
          className="flex flex-col items-center"
          // Announce the step once; the ticking clock stays out of the live region.
        >
          <span className="relative mb-5 grid size-12 place-items-center" aria-hidden>
            <span className="absolute inset-0 rounded-full border-2 border-white/10 motion-reduce:border-brand/60" />
            {/* Sized so the spinner's arc (radius 9 of 24) lies on the 48px track's centerline, 2px thick. */}
            <Spinner
              aria-hidden
              strokeWidth={0.78}
              className="absolute -top-[6.667px] -left-[6.667px] size-[61.333px] text-brand [animation-duration:900ms] motion-reduce:hidden"
            />
            <Film size={18} strokeWidth={1.75} className="text-text-2" />
          </span>
          <h2 id="convert-title" className="text-[15px] font-medium text-text-1 sm:text-base">
            {COPY[reason].title(type)}
          </h2>
          <span className="sr-only">{stepText}</span>
        </div>
        <p id="convert-reason" className="mt-1.5 text-[13px] leading-relaxed text-pretty text-text-2 sm:text-sm">
          {reason === "layout" && why ? why : COPY[reason].body(type)}
        </p>

        <div
          className="relative mt-6 h-1 w-full max-w-60 overflow-hidden rounded-full bg-white/10"
          aria-hidden
        >
          <span className="lens-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-brand" />
        </div>

        <p className="mt-3 flex items-center gap-2 text-xs text-text-3">
          <span>{stepText}</span>
          <span aria-hidden className="text-line-3">
            ·
          </span>
          <span className="font-mono tabular-nums" aria-label={`${Math.floor(elapsed / 1000)} seconds elapsed`}>
            {clock(elapsed)}
          </span>
        </p>
        {slow && (
          <p className="mt-3 text-xs text-text-3">The bucket is slow to answer. Large files can take a little longer to open.</p>
        )}
      </div>
    </StagePanel>
  );
}
