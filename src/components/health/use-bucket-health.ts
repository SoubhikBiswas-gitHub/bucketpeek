"use client";

import { useCallback, useEffect, useState } from "react";
import type { BucketHealth } from "@/lib/types";

const POLL_MS = 2000;

const load = (url: string, init: RequestInit) =>
  fetch(url, { cache: "no-store", ...init }).then((r) =>
    r.ok ? (r.json() as Promise<BucketHealth>) : Promise.reject(new Error(`Status ${r.status}`)),
  );

// The connected bucket's video check. With no report yet this starts one (the first visit);
// while it runs this polls for progress. `rescan` starts a new check.
export function useBucketHealth() {
  const [health, setHealth] = useState<BucketHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    load("/api/health", { signal: ctrl.signal })
      // Reading is side-effect free; starting the first check is a POST.
      .then((h) => (h.status === "none" ? load("/api/health", { method: "POST", signal: ctrl.signal }) : h))
      .then((h) => {
        setHealth(h);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Couldn’t load the check.");
      });
    return () => ctrl.abort();
  }, [tick]);

  const running = health?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => clearTimeout(t);
  }, [running, health]);

  const rescan = useCallback(async () => {
    const r = await fetch("/api/health?rescan=1", { method: "POST", cache: "no-store" });
    if (r.ok) setHealth((await r.json()) as BucketHealth);
  }, []);

  return { health, error, rescan };
}

// Problems that need someone's attention (empty, no index, damaged, unreadable, repaired on the fly).
export function attentionCount(h: BucketHealth | null): number | null {
  if (h?.status !== "done") return null;
  const t = h.totals;
  return t.empty + t.noIndex + t.repairable + t.damaged + t.unreadable;
}
