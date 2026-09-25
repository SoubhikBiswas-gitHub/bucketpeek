"use client";

import { useSyncExternalStore } from "react";
import { parseDate } from "./file-info";

// A shared one-second clock that only runs while the tab is visible; coming back ticks at once.
const listeners = new Set<() => void>();
let timer: number | undefined;

function emit() {
  for (const l of listeners) l();
}

function sync() {
  const shouldRun = listeners.size > 0 && document.visibilityState === "visible";
  if (shouldRun && timer === undefined) timer = window.setInterval(emit, 1000);
  if (!shouldRun && timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") emit();
  sync();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) document.addEventListener("visibilitychange", onVisibility);
  listeners.add(listener);
  sync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) document.removeEventListener("visibilitychange", onVisibility);
    sync();
  };
}

// Whole seconds, so the snapshot is stable within a second.
const getSnapshot = () => Math.floor(Date.now() / 1000);
// The server doesn't know the viewer's clock; render a placeholder until hydration.
const getServerSnapshot = () => null;

export const AUTO_REFRESH_MS = 60_000;

export type ExpiryPhase = "pending" | "ok" | "expired";

export interface LinkExpiry {
  phase: ExpiryPhase;
  // Milliseconds left, or null before hydration or when the expiry time is unknown.
  remainingMs: number | null;
  expiresAt: Date | null;
}

export function useLinkExpiry(expiresAtIso: string): LinkExpiry {
  const nowSec = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const expiresAt = parseDate(expiresAtIso);
  if (nowSec === null || !expiresAt) return { phase: "pending", remainingMs: null, expiresAt };
  const remainingMs = expiresAt.getTime() - nowSec * 1000;
  const phase = remainingMs <= 0 ? "expired" : "ok";
  return { phase, remainingMs, expiresAt };
}

// True while audio plays. A refreshed link would restart a song, but a video resumes from the same
// spot, so only audio holds back the automatic refresh.
export function isAudioPlaying(): boolean {
  if (document.querySelector('[data-media-player][data-playing="true"]:not(.lens-player)')) return true;
  return Array.from(document.querySelectorAll<HTMLAudioElement>("audio")).some((m) => !m.paused && !m.ended && m.readyState > 2);
}
