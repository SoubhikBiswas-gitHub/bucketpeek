"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

function detectMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

// The server render assumes a Mac, then corrects after hydration.
export function useIsMac(): boolean {
  return useSyncExternalStore(noop, detectMac, () => true);
}

export function openCommandMenu(): void {
  window.dispatchEvent(new Event("lens:open-command"));
}
