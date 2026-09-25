"use client";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import "./video-player.css";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  isHLSProvider,
  isVideoProvider,
  MediaPlayer,
  MediaProvider,
  type MediaErrorDetail,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
  type PlayerSrc,
} from "@vidstack/react";
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import { PlayerPreferences } from "./player-storage";

export interface LensPlayerProps {
  src: PlayerSrc;
  title: string;
  // Converted HLS stream: a growing EVENT playlist that should still behave like a normal video.
  hls?: boolean;
  autoPlay?: boolean;
  onFatalError: (detail: MediaErrorDetail) => void;
  // Metadata loaded but no picture: the browser decoded audio only (unsupported video codec).
  onNoPicture?: () => void;
  // A new player given the same object (fresh link, retry) starts at that time and resumes if it was playing.
  positionRef?: PlaybackPosition;
  // Called once: no metadata after SLOW_START_MS, or a stall longer than SLOW_STALL_MS.
  onSlow?: () => void;
  children?: React.ReactNode;
}

export interface PlaybackPosition {
  current: { time: number; playing: boolean };
}

const FRAME_STYLE: React.CSSProperties = {
  position: "relative",
  containerType: "size",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
  minHeight: "12rem",
  // The same surface as the image and PDF viewers: no black bars beside a picture that doesn't fill the stage.
  background: "var(--surface-0)",
};

function boxStyle(ratio: number): React.CSSProperties {
  return {
    "--lens-ratio": ratio,
    // Breathing room around the picture, as the image viewer has; none on phones where space is short.
    "--lens-gap": "clamp(0px, 1.5cqw, 12px)",
    position: "relative",
    aspectRatio: ratio,
    width: `min(100cqw - 2 * var(--lens-gap), (100cqh - 2 * var(--lens-gap)) * ${ratio})`,
    maxWidth: "100%",
    maxHeight: "100cqh",
    background: "#000",
    borderRadius: "var(--lens-gap)",
    overflow: "hidden",
  } as React.CSSProperties;
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// A well-formed file has its metadata in about a second even at 150 ms per request (docs/costs.md).
export const SLOW_START_MS = 6000;
// Bad layouts are caught at page load, so a stall is usually the network, and switching to the server
// stream is slower than waiting: only a long stall counts.
export const SLOW_STALL_MS = 15000;

// Keys the player handles itself; they must not reach page-level shortcuts (←/→ for prev/next file).
const PLAYER_KEYS = new Set([
  " ",
  "k",
  "K",
  "j",
  "J",
  "l",
  "L",
  "f",
  "F",
  "m",
  "M",
  "i",
  "I",
  "c",
  "C",
  "<",
  ">",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
]);

export function LensPlayer({
  src,
  title,
  hls,
  autoPlay,
  onFatalError,
  onNoPicture,
  positionRef,
  onSlow,
  children,
}: LensPlayerProps) {
  const player = useRef<MediaPlayerInstance>(null);
  const resumed = useRef(false);
  const storage = useMemo(() => new PlayerPreferences(), []);
  // The player hugs the picture's real aspect ratio (16:9 until metadata arrives) inside the stage.
  const [ratio, setRatio] = useState(16 / 9);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A failed <source> child fires its error on <source>, not <video>, so Vidstack never reports it and
  // the spinner would run forever. Catch it in the capture phase.
  useEffect(() => {
    if (!video) return;
    const onSourceError = (e: Event) => {
      if (e.target instanceof HTMLSourceElement) {
        onFatalError({ message: "The browser couldn’t load this video.", code: 4 });
      }
    };
    video.addEventListener("error", onSourceError, true);
    return () => video.removeEventListener("error", onSourceError, true);
  }, [video, onFatalError]);

  useEffect(() => {
    if (!video || !onSlow) return;
    let fired = false;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      if (fired) return;
      fired = true;
      onSlow();
    };
    // Browsers hold back loading in a tab nobody is looking at, so only visible time counts as slow.
    let start: ReturnType<typeof setTimeout> | undefined;
    const armStart = () => {
      clearTimeout(start);
      if (document.hidden) return;
      start = setTimeout(() => {
        if (!document.hidden && video.readyState < HTMLMediaElement.HAVE_METADATA && !video.error) fire();
      }, SLOW_START_MS);
    };
    armStart();
    document.addEventListener("visibilitychange", armStart);
    const onWaiting = () => {
      clearTimeout(stall);
      const seeking = video.seeking;
      stall = setTimeout(() => {
        if (!document.hidden && (seeking || !video.paused) && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && !video.error) fire();
      }, SLOW_STALL_MS);
    };
    const onProgress = () => clearTimeout(stall);
    video.addEventListener("seeked", onProgress);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onProgress);
    video.addEventListener("canplay", onProgress);
    video.addEventListener("pause", onProgress);
    return () => {
      clearTimeout(start);
      clearTimeout(stall);
      document.removeEventListener("visibilitychange", armStart);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onProgress);
      video.removeEventListener("canplay", onProgress);
      video.removeEventListener("pause", onProgress);
      video.removeEventListener("seeked", onProgress);
    };
  }, [video, onSlow]);

  function onProviderChange(provider: MediaProviderAdapter | null) {
    setVideo(isVideoProvider(provider) ? provider.video : null);
    if (isHLSProvider(provider)) {
      // Use the bundled hls.js instead of Vidstack's default CDN download.
      // Vidstack doesn't check for a destroyed player once the import resolves and dispatches on null,
      // so after an unmount the import never settles.
      provider.library = () => import("hls.js").then((lib) => (mounted.current ? lib : new Promise<never>(() => {})));
      provider.config = {
        // Load from where a restarted player resumes, not from 0 and then seek (that converts a part nobody watches).
        startPosition: positionRef?.current.time ?? 0,
        // Keep what has been watched so seeking back doesn't refetch.
        backBufferLength: 90,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 6,
        // The server converts a segment before answering, and a seek starts ffmpeg at a new spot:
        // allow for that before the first byte instead of timing out and asking again.
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 60_000,
            maxLoadTimeMs: 120_000,
            timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
            errorRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
          },
        },
      };
    }
  }

  function onCanPlay() {
    const p = player.current;
    if (p && positionRef && !resumed.current) {
      resumed.current = true;
      const { time, playing } = positionRef.current;
      if (time > 0) p.currentTime = time;
      if (playing) p.play().catch(() => {});
    }
    const video = p?.el?.querySelector("video");
    if (!video) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      onNoPicture?.();
      return;
    }
    const next = Math.min(
      4,
      Math.max(0.25, video.videoWidth / video.videoHeight),
    );
    if (Math.abs(next - ratio) > 0.01) setRatio(next);
  }

  return (
    <div
      className="lens-player-frame"
      // Page-level code (auto-refresh, shortcuts) detects the player and whether it is playing.
      data-video-player=""
      data-playing={playing ? "true" : undefined}
      // Critical sizing is inline so the player never mounts at 0x0 before the stylesheet applies;
      // a 0x0 player would never load its source.
      style={FRAME_STYLE}
      // Swallow player shortcuts so page-level handlers (prev/next file) don't also fire.
      onKeyDown={(e) => {
        if (!e.metaKey && !e.ctrlKey && !e.altKey && PLAYER_KEYS.has(e.key))
          e.stopPropagation();
      }}
    >
      <div
        className="lens-player-box"
        style={boxStyle(ratio)}
      >
        <MediaPlayer
          ref={player}
          className="lens-player"
          data-video-player=""
          src={src}
          title={title}
          playsInline
          autoPlay={Boolean(autoPlay)}
          preload="metadata"
          load="eager"
          // A growing HLS playlist would otherwise be treated as live (no seeking, LIVE badge).
          streamType={hls ? "on-demand" : "unknown"}
          storage={storage}
          keyTarget="player"
          onProviderChange={onProviderChange}
          onCanPlay={onCanPlay}
          onSeeking={(time) => {
            // A seek that fails (e.g. on an expired link) never reports a time update; keep its target.
            if (positionRef && resumed.current) positionRef.current.time = time;
          }}
          onTimeUpdate={(d) => {
            // Before resuming, the new player reports 0; don't lose the saved time.
            if (positionRef && resumed.current) positionRef.current.time = d.currentTime;
          }}
          onPlaying={() => {
            setPlaying(true);
            if (positionRef) positionRef.current.playing = true;
          }}
          onPause={() => {
            setPlaying(false);
            // A failed load (expired link, dropped connection) pauses too; only a real pause should stick,
            // so the player that replaces this one keeps playing.
            const failed = Boolean(player.current?.el?.querySelector("video")?.error) || player.current?.state.error;
            if (positionRef && resumed.current && !failed) positionRef.current.playing = false;
          }}
          onEnded={() => setPlaying(false)}
          onEmptied={() => setPlaying(false)}
          onError={onFatalError}
        >
          <MediaProvider />
          <DefaultVideoLayout
            icons={defaultLayoutIcons}
            colorScheme="dark"
            playbackRates={PLAYBACK_RATES}
            // The page header already has Download; casting isn't useful for bucket files.
            slots={{ googleCastButton: null }}
            noAudioGain
            seekStep={5}
          />
          {/* Inside the player so notes stay visible in fullscreen. */}
          {children}
        </MediaPlayer>
      </div>
    </div>
  );
}
