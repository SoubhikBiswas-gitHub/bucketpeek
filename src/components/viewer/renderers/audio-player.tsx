"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useWavesurfer } from "@wavesurfer/react";
import Hover from "wavesurfer.js/plugins/hover";
import { AudioLines, Download, ExternalLink, Gauge, Info, Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isInteractiveTarget, useDownloadHref } from "../media/hooks";
import { MediaSlider } from "../media/slider";
import { ToolButton } from "../media/tool-button";

export interface AudioPlayerProps {
  url: string;
  name: string;
  size: number;
}

// The waveform needs the whole file in memory; past this size playback uses the native player only.
const WAVEFORM_MAX_BYTES = 50 * 1024 * 1024;
const WAVE_HEIGHT = 112;
const SKIP_SECONDS = 5;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

type Fallback = { reason: "size" | "decode" } | null;

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const parts = [m ? `${m} minute${m === 1 ? "" : "s"}` : "", `${s % 60} second${s % 60 === 1 ? "" : "s"}`];
  return parts.filter(Boolean).join(" ");
}

// Canvas can't read CSS variables, so resolve the palette once on the client.
function readPalette() {
  const fallback = { brand: "#f5a524", wave: "#525252", hover: "#b4b4b4", label: "#ededed", labelBg: "#292929" };
  if (typeof document === "undefined") return fallback;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;
  return {
    brand: v("--brand", fallback.brand),
    wave: v("--line-3", fallback.wave),
    hover: v("--text-2", fallback.hover),
    label: v("--text-1", fallback.label),
    labelBg: v("--surface-3", fallback.labelBg),
  };
}

export function AudioPlayer({ url, name, size }: AudioPlayerProps) {
  const [fallback, setFallback] = useState<Fallback>(size > WAVEFORM_MAX_BYTES ? { reason: "size" } : null);
  const onFail = useCallback(() => setFallback({ reason: "decode" }), []);

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-3 sm:p-6">
      <div className="w-full max-w-3xl">
        {size === 0 ? (
          <p className="rounded-lg border border-line-1 bg-surface-0 px-4 py-6 text-center text-[13px] text-text-2">
            This audio file is empty, so there is nothing to play.
          </p>
        ) : fallback ? (
          <NativeAudio url={url} name={name} reason={fallback.reason} />
        ) : (
          <WaveformPlayer url={url} name={name} onFail={onFail} />
        )}
      </div>
    </div>
  );
}

function WaveformPlayer({ url, name, onFail }: { url: string; name: string; onFail: () => void }) {
  const waveRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const palette = useMemo(() => readPalette(), []);
  const plugins = useMemo(
    () => [
      Hover.create({
        lineColor: palette.hover,
        lineWidth: 1,
        labelColor: palette.label,
        labelBackground: palette.labelBg,
        labelSize: 11,
        formatTimeCallback: formatTime,
      }),
    ],
    [palette],
  );

  const { wavesurfer, isReady, isPlaying, currentTime } = useWavesurfer({
    container: waveRef,
    url,
    height: WAVE_HEIGHT,
    waveColor: palette.wave,
    progressColor: palette.brand,
    cursorColor: palette.brand,
    cursorWidth: 2,
    barWidth: 2,
    barGap: 2,
    barRadius: 2,
    barMinHeight: 1,
    normalize: true,
    dragToSeek: true,
    hideScrollbar: true,
    plugins,
  });

  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!wavesurfer) return;
    const offs = [
      wavesurfer.on("loading", (p) => setLoading(p)),
      wavesurfer.on("ready", (d) => setDuration(d)),
      wavesurfer.on("decode", (d) => setDuration(d)),
      wavesurfer.on("error", () => onFail()),
    ];
    return () => offs.forEach((off) => off());
  }, [wavesurfer, onFail]);

  const toggle = useCallback(() => {
    if (!wavesurfer || !isReady) return;
    wavesurfer.playPause().catch(() => undefined);
  }, [wavesurfer, isReady]);

  const skip = useCallback((s: number) => wavesurfer?.skip(s), [wavesurfer]);

  const changeRate = (value: string) => {
    const r = Number(value);
    setRate(r);
    wavesurfer?.setPlaybackRate(r);
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    wavesurfer?.setVolume(v);
    if (v > 0 && muted) {
      setMuted(false);
      wavesurfer?.setMuted(false);
    }
  };

  const toggleMute = useCallback(() => {
    wavesurfer?.setMuted(!muted);
    setMuted(!muted);
  }, [wavesurfer, muted]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isInteractiveTarget(e.target, e.currentTarget)) return;
    let handled = true;
    switch (e.key) {
      case " ":
      case "k":
      case "K":
        toggle();
        break;
      case "ArrowLeft":
      case "j":
      case "J":
        skip(-SKIP_SECONDS);
        break;
      case "ArrowRight":
      case "l":
      case "L":
        skip(SKIP_SECONDS);
        break;
      case "Home":
        wavesurfer?.setTime(0);
        break;
      case "End":
        if (duration) wavesurfer?.setTime(Math.max(0, duration - 0.05));
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const shownVolume = muted ? 0 : volume;
  const VolumeIcon = shownVolume === 0 ? VolumeX : shownVolume < 0.5 ? Volume1 : Volume2;
  const pctLoaded = Math.round(loading);

  return (
    <div
      role="group"
      data-media-player
      data-playing={isPlaying ? "true" : undefined}
      aria-roledescription="audio player"
      aria-label={name}
      aria-describedby={hintId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="rounded-lg outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
    >
      <span id={hintId} className="sr-only">
        Space plays or pauses, left and right arrows skip 5 seconds, M mutes. Click the waveform to seek.
      </span>

      <div className="relative rounded-lg border border-line-1 bg-surface-0 px-3 py-3 sm:px-4">
        <div
          ref={waveRef}
          aria-hidden
          className={cn("cursor-pointer transition-opacity duration-300", isReady ? "opacity-100" : "opacity-0")}
          style={{ height: WAVE_HEIGHT }}
        />
        {!isReady && <WaveSkeleton percent={pctLoaded} />}
      </div>

      <div className="mt-3 flex items-center gap-2 sm:gap-3">
        <Button
          type="button"
          size="icon-lg"
          onClick={toggle}
          disabled={!isReady}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="size-11 rounded-full"
        >
          {!isReady ? (
            <Spinner aria-hidden className="size-5" />
          ) : isPlaying ? (
            <Pause className="size-5 fill-current" />
          ) : (
            <Play className="size-5 translate-x-px fill-current" />
          )}
        </Button>

        <p className="min-w-0 font-mono text-[13px] tabular-nums text-text-2">
          <span className="sr-only">Elapsed {spokenTime(currentTime)}, </span>
          <span aria-hidden className="text-text-1">
            {formatTime(currentTime)}
          </span>
          <span aria-hidden className="mx-1.5 text-text-3">
            /
          </span>
          <span className="sr-only">{duration ? `duration ${spokenTime(duration)}` : "duration unknown"}</span>
          <span aria-hidden>{duration ? formatTime(duration) : "–:––"}</span>
        </p>

        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 font-mono tabular-nums text-text-2"
                    aria-label={`Playback speed, ${rate}×`}
                    disabled={!isReady}
                  >
                    <Gauge data-icon="inline-start" className="[stroke-width:1.75]" />
                    {rate}×
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Playback speed
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuLabel>Playback speed</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={String(rate)} onValueChange={changeRate}>
                {RATES.map((r) => (
                  <DropdownMenuRadioItem key={r} value={String(r)} className="font-mono tabular-nums">
                    {r === 1 ? "1× (normal)" : `${r}×`}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <ToolButton
            label={muted ? "Unmute" : "Mute"}
            shortcut="M"
            onClick={toggleMute}
            aria-pressed={muted}
            disabled={!isReady}
          >
            <VolumeIcon />
          </ToolButton>
          <MediaSlider
            label="Volume"
            valueText={`${Math.round(shownVolume * 100)}%`}
            min={0}
            max={1}
            step={0.05}
            value={[shownVolume]}
            onValueChange={([v]) => changeVolume(v ?? 0)}
            disabled={!isReady}
            className="hidden w-24 sm:flex"
          />
        </div>
      </div>
    </div>
  );
}

// Deterministic placeholder bars so the skeleton looks like audio, not a grey box.
const SKELETON_BARS = Array.from({ length: 96 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 0.37) * 0.6 + Math.sin(i * 1.13) * 0.3 + Math.sin(i * 0.07) * 0.25);
  // Whole percents keep the SSR markup identical to what the browser serializes.
  return Math.round(Math.max(0.08, Math.min(1, v)) * 100);
});

function WaveSkeleton({ percent }: { percent: number }) {
  return (
    <div className="absolute inset-x-3 inset-y-3 flex flex-col sm:inset-x-4" role="status">
      <div aria-hidden className="flex h-full animate-pulse items-center gap-[2px] overflow-hidden">
        {SKELETON_BARS.map((h, i) => (
          <span key={i} className="w-[2px] shrink-0 rounded-full bg-surface-3" style={{ height: `${h}%` }} />
        ))}
      </div>
      <span className="absolute right-0 bottom-0 rounded bg-surface-0/90 px-1.5 text-xs tabular-nums text-text-3">
        {percent > 0 && percent < 100 ? `Loading waveform ${percent}%` : "Loading waveform"}
      </span>
    </div>
  );
}

function NativeAudio({ url, name, reason }: { url: string; name: string; reason: "size" | "decode" }) {
  const dl = useDownloadHref();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="rounded-lg border border-danger-line bg-danger-mist p-4">
        <div className="flex gap-3">
          <AudioLines aria-hidden className="mt-px size-5 shrink-0 text-danger" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium text-text-1">This audio can’t be played here</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-text-2">
              Your browser doesn’t support this format or codec, or the link has expired. Download it to play it in
              another app.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {dl && (
                <Button asChild>
                  <a href={dl} download>
                    <Download data-icon="inline-start" />
                    Download
                  </a>
                </Button>
              )}
              <Button asChild variant="outline">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink data-icon="inline-start" />
                  Open in new tab
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line-1 bg-surface-0 p-2">
        <audio
          controls
          preload="metadata"
          src={url}
          aria-label={name}
          onError={() => setFailed(true)}
          className="block h-11 w-full [color-scheme:dark]"
        >
          <a href={url}>Open the audio file</a>
        </audio>
      </div>
      <p className="flex items-start gap-2 text-[13px] text-text-3">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {reason === "size"
          ? "Waveform skipped because the file is over 50 MB. Playback streams normally."
          : "The waveform couldn’t be drawn for this file. Playback still works."}
      </p>
    </div>
  );
}
