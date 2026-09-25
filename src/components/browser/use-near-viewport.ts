"use client";

import { createContext, useContext, useEffect, useState, type RefObject } from "react";

// The scroll container tiles live in. Previews load when their tile is within it (plus a margin).
export const PreviewRootContext = createContext<RefObject<HTMLElement | null> | null>(null);

// Load a little ahead of scrolling: half a screen above and below.
const MARGIN = "50% 0px";
// A tile must stay in range this long before it loads, so flinging through a folder loads nothing.
const DWELL_MS = 150;

type Callback = (near: boolean) => void;
const observers = new WeakMap<Element | Document, { io: IntersectionObserver; callbacks: Map<Element, Callback> }>();

// One IntersectionObserver per scroll container, shared by all its tiles.
function observe(root: HTMLElement | null, el: Element, cb: Callback): () => void {
  const scope = root ?? document;
  let entry = observers.get(scope);
  if (!entry) {
    const callbacks = new Map<Element, Callback>();
    const io = new IntersectionObserver(
      (records) => {
        for (const r of records) callbacks.get(r.target)?.(r.isIntersecting);
      },
      { root, rootMargin: MARGIN },
    );
    entry = { io, callbacks };
    observers.set(scope, entry);
  }
  const { io, callbacks } = entry;
  callbacks.set(el, cb);
  io.observe(el);
  return () => {
    io.unobserve(el);
    callbacks.delete(el);
  };
}

// True once `ref` has stayed near the visible part of its scroll container for DWELL_MS; false as
// soon as it leaves, and always false when `enabled` is false.
export function useNearViewport(ref: RefObject<Element | null>, enabled: boolean): boolean {
  const rootRef = useContext(PreviewRootContext);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let timer: number | undefined;
    const stop = observe(rootRef?.current ?? null, el, (isNear) => {
      window.clearTimeout(timer);
      if (isNear) timer = window.setTimeout(() => setNear(true), DWELL_MS);
      else setNear(false);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [ref, rootRef, enabled]);

  return enabled && near;
}
