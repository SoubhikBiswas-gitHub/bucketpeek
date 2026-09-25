"use client";

import { useSyncExternalStore, type CSSProperties } from "react";

// The visual viewport shrinks when a phone's on-screen keyboard opens (100dvh does not), so it
// is exposed as `--lens-vvh` for dialogs to size themselves to the space actually visible.
function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
}

const getSnapshot = () => (window.visualViewport ? Math.round(window.visualViewport.height) : 0);
const getServerSnapshot = () => 0;

export function useViewportStyle(): CSSProperties {
  const height = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return height ? ({ "--lens-vvh": `${height}px` } as CSSProperties) : {};
}
