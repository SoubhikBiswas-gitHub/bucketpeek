"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { downloadHref } from "@/lib/paths";

// `null` during SSR and hydration, so callers render a neutral placeholder instead of guessing.
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}

export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)") ?? false;
}

// Only works on the `/view?key=` route.
export function useDownloadHref(): string | null {
  const key = useSearchParams().get("key");
  return key ? downloadHref(key) : null;
}

function fullscreenElement(): Element | null {
  const d = document as Document & { webkitFullscreenElement?: Element | null };
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

// `supported` is false on iOS Safari and in locked-down iframes.
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const supported = useSyncExternalStore(
    () => () => {},
    () => {
      const d = document as Document & { webkitFullscreenEnabled?: boolean };
      return Boolean(d.fullscreenEnabled ?? d.webkitFullscreenEnabled);
    },
    () => false,
  );
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(fullscreenElement() === ref.current && ref.current !== null);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [ref]);

  const toggle = useCallback(async () => {
    const el = ref.current as (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }) | null;
    if (!el) return;
    try {
      if (fullscreenElement()) {
        const d = document as Document & { webkitExitFullscreen?: () => Promise<void> };
        await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      } else {
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch {
      // Denied by the browser (no user gesture, permissions policy). Nothing useful to show.
    }
  }, [ref]);

  return { supported, active, toggle };
}

export function isInteractiveTarget(target: EventTarget | null, container: Element): boolean {
  if (!(target instanceof Element) || target === container) return false;
  return Boolean(
    target.closest("button, a, input, select, textarea, [role=slider], [role=menuitem], [contenteditable=true]"),
  );
}
