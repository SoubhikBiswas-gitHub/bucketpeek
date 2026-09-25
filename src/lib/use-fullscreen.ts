"use client";

import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
};

// Pop-ups portal into this element while it is fullscreen: the browser only paints its subtree,
// so anything portaled to <body> would be invisible.
export function useFullscreenElement(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => (document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : null),
    () => null,
  );
}
