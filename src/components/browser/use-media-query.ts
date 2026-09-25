"use client";

import { useCallback, useSyncExternalStore } from "react";

// The server (and first client render) assumes `false`.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// Below Tailwind's `sm` breakpoint.
export const MOBILE_QUERY = "(max-width: 639.98px)";
