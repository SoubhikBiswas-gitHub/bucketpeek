"use client";
// Static so the player styles are in the first paint, not loaded with the lazy player chunk.
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import "../video/video-player.css";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaErrorDetail, PlayerSrc } from "@vidstack/react";
import { Spinner } from "@/components/ui/spinner";
import { extOf } from "@/lib/kinds";
import type { VideoMode } from "@/lib/types";
import { ConvertingOverlay, type StreamReason } from "../video/converting-overlay";
import { FallbackPanel } from "../video/fallback-panel";
import { PlayerNote } from "../video/player-note";
import { StagePanel } from "../video/stage-panel";
import type { PlaybackPosition } from "../video/lens-player";
import { streamFailure, useConversion } from "../video/use-conversion";

export interface VideoPlayerProps {
  fileKey: string;
  name: string;
  // Short type label, e.g. "AVI".
  type: string;
  url: string;
  mode: VideoMode;
  canConvert: boolean;
  // Set when the server chose to stream a browser-playable container (fragmented, or a huge index).
  streamReason?: "fragments" | "layout";
  why?: string;
  downloadHref: string;
}

// Vidstack touches browser APIs as it mounts; render it on the client behind a same-size placeholder.
const LensPlayer = dynamic(() => import("../video/lens-player").then((m) => m.LensPlayer), {
  ssr: false,
  loading: () => (
    <StagePanel aria-label="Loading player">
      <Spinner className="size-5 text-text-3" />
    </StagePanel>
  ),
});

type Stage =
  // `expiredUrl`: that link expired and a fresh one was asked for; the player restarts when it arrives.
  // `streamFailed`: the slow-file stream couldn't be converted, so play the original and don't switch again.
  | { kind: "direct"; attempt: number; noPicture: boolean; expiredUrl?: string; streamFailed?: boolean }
  | { kind: "convert"; reason: StreamReason }
  | { kind: "unsupported"; reason: "format" | "codec" }
  | { kind: "expired" }
  | { kind: "stalled" };

// A presigned URL's path may not end in a known extension, so give the browser an explicit type.
function directSrc(url: string, name: string): PlayerSrc {
  const ext = extOf(name);
  const type = ext === "webm" || ext === "mkv" ? "video/webm" : ext === "ogv" ? "video/ogg" : "video/mp4";
  return { src: url, type };
}

// After a media error, tells an expired link apart from a codec the browser can't decode.
async function probe(url: string): Promise<"ok" | "expired" | "unknown"> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    ctrl.abort(); // Only the status matters; don't download the video.
    if (res.status === 403 || res.status === 400) return "expired";
    return res.ok ? "ok" : "unknown";
  } catch {
    // Bucket without CORS, offline, or timed out. Assume a decode problem and let conversion decide.
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

function initialStage(mode: VideoMode, streamReason?: "fragments" | "layout"): Stage {
  if (mode === "convert") return { kind: "convert", reason: streamReason ?? "format" };
  if (mode === "unsupported") return { kind: "unsupported", reason: "format" };
  return { kind: "direct", attempt: 0, noPicture: false };
}

export function VideoPlayer(props: VideoPlayerProps) {
  // Only a new file starts over. A fresh link for the same file keeps playing from the same spot.
  return <VideoStage key={props.fileKey} {...props} />;
}

// More expired links than this within RELINK_WINDOW_MS means fresh links don't help (e.g. a wrong clock).
const MAX_RELINKS = 3;
const RELINK_WINDOW_MS = 60_000;
// While waiting for a fresh link, ask again this often: a refresh can fail or return the same link.
const RELINK_RETRY_MS = 3000;

function VideoStage({ fileKey, name, type, url, mode, canConvert, streamReason, why, downloadHref }: VideoPlayerProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(() => initialStage(mode, streamReason));
  const [hlsAttempt, setHlsAttempt] = useState(0);
  const [hlsError, setHlsError] = useState<{ message: string; reason: string | null } | null>(null);
  const { state: conversion, retry } = useConversion(fileKey, stage.kind === "convert");

  // Fetch the player code while the server prepares the stream. Otherwise the <video> element starts
  // the playlist with the browser's own HLS until hls.js arrives, then starts over (~350 ms lost).
  useEffect(() => {
    if (stage.kind !== "convert") return;
    void import("hls.js");
    void import("../video/lens-player");
  }, [stage.kind]);
  const common = { downloadHref, fileKey, name };
  // Survives player restarts (fresh link, retry, converted stream) so each continues where the last stopped.
  const position = useRef<PlaybackPosition["current"]>({ time: 0, playing: false });
  const relinks = useRef<number[]>([]);

  const relink = useCallback(() => {
    const now = Date.now();
    relinks.current = [...relinks.current.filter((t) => now - t < RELINK_WINDOW_MS), now];
    if (relinks.current.length > MAX_RELINKS) setStage({ kind: "expired" });
    else router.refresh();
  }, [router]);

  // A link signed within the same second as the expired one is identical, so no new player mounts.
  const waitingForLink = stage.kind === "direct" && stage.expiredUrl === url;
  useEffect(() => {
    if (!waitingForLink) return;
    const timer = setInterval(relink, RELINK_RETRY_MS);
    return () => clearInterval(timer);
  }, [waitingForLink, relink]);

  const switchToStream = useCallback(() => setStage({ kind: "convert", reason: "slow" }), []);
  // The stream was only a speed-up: when the server can't convert the file, the browser may still play it.
  const backToDirect = useCallback(() => setStage({ kind: "direct", attempt: Date.now(), noPicture: false, streamFailed: true }), []);
  const slowStreamFailed =
    stage.kind === "convert" && stage.reason === "slow" && (conversion.phase === "failed" || conversion.phase === "offline");

  const convertOrExplain = useCallback(
    () => setStage(canConvert ? { kind: "convert", reason: "codec" } : { kind: "unsupported", reason: "codec" }),
    [canConvert],
  );

  const onDirectError = useCallback(
    async (detail: MediaErrorDetail) => {
      const code = detail.code ?? detail.mediaError?.code;
      if (code === 1) return; // Aborted by the user or a source change.
      const linkExpired = (code === 2 || code === 3 || code === 4) && (await probe(url)) === "expired";
      if (linkExpired) {
        // Presigned links expire. Ask the page for fresh ones; the new link restarts the player where it was.
        setStage((s) => (s.kind === "direct" ? { ...s, expiredUrl: url } : s));
        relink();
        return;
      }
      // 4 is also what browsers report for an HTTP error; the link is fine, so it's the codec.
      if (code === 3 || code === 4) convertOrExplain();
      else setStage({ kind: "stalled" });
    },
    [url, convertOrExplain, relink],
  );

  // Rendered, not set in an effect: once the slow-file stream fails, the original plays again.
  const current: Stage = slowStreamFailed ? { kind: "direct", attempt: -1, noPicture: false, streamFailed: true } : stage;

  switch (current.kind) {
    case "direct":
      return (
        <LensPlayer
          // A new link or a retry mounts a fresh player, which resumes from `position`.
          key={`${current.attempt}\n${url}`}
          src={directSrc(url, name)}
          title={name}
          positionRef={position}
          onFatalError={onDirectError}
          // Direct playback that is slow to start or keeps stalling (e.g. a fragmented file the server
          // didn't recognize) switches to the server stream, at the same position.
          onSlow={canConvert && !current.streamFailed ? switchToStream : undefined}
          onNoPicture={() => setStage({ ...current, noPicture: true })}
        >
          {current.expiredUrl === url && <PlayerNote icon="busy" text="The link expired. Getting a fresh one…" />}
          {current.noPicture && (
            <PlayerNote
              icon="info"
              text="Only audio is playing. This browser can’t decode the video in this file."
              action={canConvert ? { label: "Convert for playback", onClick: convertOrExplain } : undefined}
            />
          )}
        </LensPlayer>
      );

    case "unsupported":
      return (
        <FallbackPanel
          {...common}
          title="This video can’t play in the browser"
          message={
            current.reason === "codec"
              ? `This ${type} file uses a video codec the browser can’t decode, such as HEVC or ProRes. Download it to watch in a desktop player like VLC.`
              : `Browsers can’t play ${type} files. Download it to watch in a desktop player like VLC.`
          }
          showInstallHint={!canConvert}
        />
      );

    case "expired":
      return (
        <FallbackPanel
          {...common}
          title="This playback link has expired"
          message="Links to files in S3 are valid for a limited time. Reload to get a fresh one."
          action={{ label: "Reload", onClick: () => router.refresh() }}
        />
      );

    case "stalled":
      return (
        <FallbackPanel
          {...common}
          icon="offline"
          title="The video stopped loading"
          message="The connection dropped while loading the video. Check your network and try again."
          action={{
            label: "Try again",
            onClick: () => {
              relinks.current = [];
              setStage({ kind: "direct", attempt: Date.now(), noPicture: false });
            },
          }}
        />
      );

    case "convert": {
      if (conversion.phase === "failed") {
        return (
          <FallbackPanel
            {...common}
            title={conversion.title === "Conversion failed" ? "This video couldn’t be converted" : conversion.title}
            message={conversion.message}
            detail={conversion.detail}
            action={conversion.retryable ? { label: "Try again", onClick: retry } : undefined}
          />
        );
      }
      if (conversion.phase === "offline") {
        return (
          <FallbackPanel
            {...common}
            icon="offline"
            title="Can’t reach Deccan Lens"
            message="The conversion status couldn’t be loaded. Check that the app is still running, then try again."
            action={{ label: "Try again", onClick: retry }}
          />
        );
      }
      if (conversion.phase === "direct") {
        // The server fixed the file's layout or index on the fly; it plays like any direct file.
        if (hlsError) {
          return (
            <FallbackPanel
              {...common}
              title="This video can’t be played"
              message="Even with its index fixed, the browser couldn’t play this file. Download it to try a desktop player like VLC."
              detail={hlsError.message}
            />
          );
        }
        return (
          <LensPlayer
            key={`fixed-${hlsAttempt}`}
            src={directSrc(conversion.url, name)}
            title={name}
            autoPlay
            positionRef={position}
            onFatalError={(d) => setHlsError({ message: d.message || "Playback stopped.", reason: null })}
          />
        );
      }
      if (conversion.phase !== "ready") {
        return <ConvertingOverlay type={type} reason={current.reason} why={why} startedAt={conversion.startedAt} />;
      }
      if (hlsError?.reason) {
        return <FallbackPanel {...common} title="This video can’t be played" message={hlsError.reason} />;
      }
      if (hlsError) {
        return (
          <FallbackPanel
            {...common}
            title="Playback of the converted video stopped"
            message="Part of the video couldn’t be converted or loaded. Try again to continue from the same spot, or download the original file."
            detail={hlsError.message}
            action={{
              label: "Try again",
              onClick: () => {
                setHlsError(null);
                setHlsAttempt((n) => n + 1);
              },
            }}
          />
        );
      }
      return (
        <LensPlayer
          key={hlsAttempt}
          hls
          autoPlay={hlsAttempt === 0}
          src={{ src: conversion.playlist, type: "application/x-mpegurl" }}
          title={name}
          positionRef={position}
          onFatalError={(d) => {
            if (current.reason === "slow") return backToDirect();
            const message = d.message || "The stream stopped unexpectedly.";
            void streamFailure(conversion.id).then((reason) => setHlsError({ message, reason }));
          }}
        />
      );
    }
  }
}
