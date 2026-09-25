"use client";
import { useCallback, useEffect, useState } from "react";
import type { ConvertJob, ConvertStatus } from "@/lib/types";

export type ConversionState =
  // POST /api/convert in flight: the server is reading the video's length.
  | { phase: "starting"; startedAt: number }
  // The whole video is playable; the server converts each part as the player asks for it.
  | { phase: "ready"; id: string; playlist: string }
  // No conversion needed: the server serves the original fixed (layout or damaged index) from `url`.
  | { phase: "direct"; url: string }
  | { phase: "failed"; title: string; message: string; detail?: string; retryable: boolean }
  | { phase: "offline" };

interface ApiError {
  title: string;
  message: string;
  detail?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

const MAX_NETWORK_FAILURES = 4;

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: ApiError } | null)?.error;
    throw new HttpError(res.status, {
      title: err?.title ?? "Conversion failed",
      message: err?.message ?? `The server answered with status ${res.status}.`,
      detail: err?.detail,
    });
  }
  return body as T;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export async function streamFailure(id: string): Promise<string | null> {
  try {
    const s = await request<ConvertStatus>(`/api/convert/${id}`, {});
    return s.failed ? s.error : null;
  } catch {
    return null;
  }
}

export function useConversion(fileKey: string, enabled: boolean) {
  const [state, setState] = useState<ConversionState>(() => ({ phase: "starting", startedAt: Date.now() }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    let failures = 0;

    (async () => {
      setState({ phase: "starting", startedAt: Date.now() });
      while (!signal.aborted) {
        try {
          const job = await request<ConvertJob>(`/api/convert?key=${encodeURIComponent(fileKey)}`, { method: "POST", signal });
          setState(job.direct ? { phase: "direct", url: job.direct } : { phase: "ready", id: job.id, playlist: job.playlist });
          return;
        } catch (e) {
          if (isAbort(e)) return;
          if (e instanceof HttpError) {
            // 401/404/415/422/501 won't change by retrying; server errors might.
            setState({ phase: "failed", ...e.body, retryable: e.status >= 500 && e.status !== 501 });
            return;
          }
          if (++failures >= MAX_NETWORK_FAILURES) {
            setState({ phase: "offline" });
            return;
          }
          await delay(1000 * 2 ** failures, signal);
        }
      }
    })();

    return () => ctrl.abort();
  }, [fileKey, enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
