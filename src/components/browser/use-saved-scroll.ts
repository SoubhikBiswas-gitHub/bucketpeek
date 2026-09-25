"use client";

import { useEffect } from "react";

const PREFIX = "lens:scroll:";

// Set after the first client render so restored offsets never cause a hydration mismatch.
let hydrated = false;

function read(key: string): number {
  try {
    return Number(sessionStorage.getItem(PREFIX + key)) || 0;
  } catch {
    return 0;
  }
}

// Per folder, for the session: the browser only restores window scroll, not a scroll region's.
// Returns the virtualizer's `initialOffset`; the virtualizer applies it on mount.
export function useSavedScroll(ref: React.RefObject<HTMLElement | null>, key: string): () => number {
  useEffect(() => {
    hydrated = true;
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!el.isConnected) return;
        try {
          sessionStorage.setItem(PREFIX + key, String(Math.round(el.scrollTop)));
        } catch {
          // Storage unavailable.
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [ref, key]);

  return () => (hydrated ? read(key) : 0);
}
