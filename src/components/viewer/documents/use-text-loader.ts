"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AppError, TextChunk as TextRange } from "@/lib/types";

// Bytes the server already put in the preview.
export const PREVIEW_BYTES = 512 * 1024;
// One "Load next" step.
export const STEP_BYTES = 2 * 1024 * 1024;
// The endpoint's maximum `length`; "Load all" walks the file in requests this big.
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
// Loading everything past this size asks first.
export const CONFIRM_ALL_BYTES = 50 * 1024 * 1024;

export type LoadMode = "next" | "all";

export interface TextChunk {
  text: string;
  // First chunk restarts at byte 0 and replaces the preview text.
  first: boolean;
  done: boolean;
}

export interface TextLoader {
  // "unavailable" when the range endpoint is missing or the key can't be read from the link.
  status: "idle" | "loading" | "error" | "done" | "unavailable";
  loaded: number;
  total: number | null;
  error: string | null;
  load: (mode: LoadMode) => void;
}

export function keyFromDownloadHref(href: string): string | null {
  const q = href.indexOf("?");
  if (q < 0) return null;
  return new URLSearchParams(href.slice(q + 1)).get("key");
}

type RangeError = Error & { status?: number; missingEndpoint?: boolean };

async function fetchRange(key: string, offset: number, length: number, signal?: AbortSignal): Promise<TextRange> {
  const res = await fetch(`/api/files/text?key=${encodeURIComponent(key)}&offset=${offset}&length=${length}`, {
    signal,
    cache: "no-store",
  });
  const json = res.headers.get("content-type")?.includes("application/json");
  if (res.ok && json) return (await res.json()) as TextRange;

  let message = `The server answered ${res.status}.`;
  if (json) {
    try {
      const body = (await res.json()) as { error?: Partial<AppError> };
      message = body.error?.message ?? message;
    } catch {
      // Keep the status message.
    }
  }
  const err = new Error(message) as RangeError;
  err.status = res.status;
  // A non-JSON 404 is the framework's page: the route isn't there.
  err.missingEndpoint = !json && (res.status === 404 || res.status === 405);
  throw err;
}

// The first request restarts at byte 0: the preview may have been cut inside a multi-byte character,
// and re-reading 512 KB is cheap next to getting that boundary wrong.
export function useTextLoader({
  downloadHref,
  enabled,
  onChunk,
}: {
  downloadHref: string;
  enabled: boolean;
  onChunk: (chunk: TextChunk) => void;
}): TextLoader {
  const key = keyFromDownloadHref(downloadHref);
  const [state, setState] = useState<Omit<TextLoader, "load">>({
    status: key ? "idle" : "unavailable",
    loaded: PREVIEW_BYTES,
    total: null,
    error: null,
  });
  const next = useRef<number | null>(null);
  const started = useRef(false);
  const busy = useRef(false);
  const chunkRef = useRef(onChunk);
  useEffect(() => {
    chunkRef.current = onChunk;
  });

  // Learn the file size up front so the footer can say "512 KB of 38.2 MB".
  useEffect(() => {
    if (!enabled || !key) return;
    const ctl = new AbortController();
    fetchRange(key, 0, 1, ctl.signal)
      .then((r) => setState((s) => ({ ...s, total: r.total })))
      .catch((e: RangeError) => {
        if (ctl.signal.aborted) return;
        // Without the endpoint, fall back to the download-only notice.
        if (e.missingEndpoint) setState((s) => ({ ...s, status: "unavailable" }));
      });
    return () => ctl.abort();
  }, [enabled, key]);

  const load = useCallback(
    async (mode: LoadMode) => {
      if (!key || busy.current) return;
      busy.current = true;
      setState((s) => ({ ...s, status: "loading", error: null }));
      try {
        let first = !started.current;
        let offset = first ? 0 : (next.current ?? 0);
        let total = state.total;
        // "next" reads one step past what is shown; "all" keeps going to the end.
        let budget = mode === "next" ? (first ? PREVIEW_BYTES : 0) + STEP_BYTES : Infinity;
        for (;;) {
          const length = Math.min(budget, MAX_REQUEST_BYTES);
          const r = await fetchRange(key, offset, length);
          total = r.total;
          const done = r.nextOffset === null;
          chunkRef.current({ text: r.text, first, done });
          const end = r.nextOffset ?? r.total;
          budget -= end - offset;
          offset = end;
          next.current = r.nextOffset;
          started.current = true;
          first = false;
          setState((s) => ({ ...s, loaded: end, total, status: done ? "done" : "loading" }));
          if (done || budget <= 0) break;
        }
        setState((s) => ({ ...s, status: next.current === null ? "done" : "idle" }));
      } catch (e) {
        const err = e as RangeError;
        setState((s) => ({
          ...s,
          status: err.missingEndpoint ? "unavailable" : "error",
          error: err.message || "The request failed.",
        }));
      } finally {
        busy.current = false;
      }
    },
    [key, state.total],
  );

  return { ...state, load };
}
