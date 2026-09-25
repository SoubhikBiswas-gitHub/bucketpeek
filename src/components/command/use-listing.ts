"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { z } from "zod";
import type { Listing } from "@/lib/types";

const LIST_LIMIT = 1000;
// Cached listings are shown instantly; after this long they are also refreshed in the background.
const STALE_MS = 60_000;

const ListingSchema = z.object({
  prefix: z.string(),
  folders: z.array(z.object({ name: z.string(), prefix: z.string() })),
  files: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      ext: z.string(),
      kind: z.enum(["video", "image", "audio", "pdf", "markdown", "json", "table", "code", "text", "archive", "other"]),
      type: z.string(),
      size: z.number(),
      modified: z.string().nullable(),
    }),
  ),
  truncated: z.boolean(),
});

export type ListingErrorKind = "auth" | "unavailable" | "network" | "server";

export interface ListingError {
  kind: ListingErrorKind;
  title: string;
  message: string;
}

export type ListingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; listing: Listing; refreshing: boolean }
  | { status: "error"; error: ListingError };

class ListingFetchError extends Error {
  constructor(readonly info: ListingError) {
    super(info.message);
  }
}

const cache = new Map<string, { listing: Listing; at: number }>();
const cacheKey = (bucket: string, prefix: string) => `${bucket}\u0000${prefix}`;

export function peekListing(bucket: string, prefix: string): Listing | undefined {
  return cache.get(cacheKey(bucket, prefix))?.listing;
}

function messageFrom(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("error" in body)) return undefined;
  const error = (body as { error: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return undefined;
}

async function fetchListing(prefix: string, signal: AbortSignal): Promise<Listing> {
  let res: Response;
  try {
    res = await fetch(`/api/list?prefix=${encodeURIComponent(prefix)}&limit=${LIST_LIMIT}`, {
      signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ListingFetchError({
      kind: "network",
      title: "Can't reach Deccan Lens",
      message: "Check your network connection, then try again.",
    });
  }

  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  const body: unknown = isJson ? await res.json().catch(() => null) : null;

  if (res.status === 401) {
    throw new ListingFetchError({
      kind: "auth",
      title: "Your session has ended",
      message: "Reconnect the bucket in connection settings to keep browsing.",
    });
  }
  if (!isJson || (res.status === 404 && !messageFrom(body))) {
    throw new ListingFetchError({
      kind: "unavailable",
      title: "Folder search isn't available",
      message: "The listing service didn't respond as expected. Try again in a moment.",
    });
  }
  if (!res.ok) {
    throw new ListingFetchError({
      kind: "server",
      title: "Couldn't list this folder",
      message: messageFrom(body) ?? `The server returned status ${res.status}.`,
    });
  }

  const parsed = ListingSchema.safeParse(body);
  if (!parsed.success) {
    throw new ListingFetchError({
      kind: "unavailable",
      title: "Couldn't read this folder",
      message: "The listing came back in an unexpected format.",
    });
  }
  return parsed.data;
}

interface Settled {
  key: string;
  error: ListingError | null;
}

// Cached prefixes resolve synchronously on render, so revisiting a folder never flashes a spinner.
export function useListing(
  bucket: string,
  prefix: string | null,
  { debounceMs = 0 }: { debounceMs?: number } = {},
): ListingState & { retry: () => void } {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);

  const key = prefix === null ? null : cacheKey(bucket, prefix);

  useEffect(() => {
    if (prefix === null || key === null) return;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < STALE_MS) return;

    const controller = new AbortController();
    const delay = hit ? 0 : debounceMs;
    const timer = window.setTimeout(() => {
      if (hit) setRefreshingKey(key);
      fetchListing(prefix, controller.signal)
        .then((listing) => {
          cache.set(key, { listing, at: Date.now() });
          setSettled({ key, error: null });
          bump();
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          // A failed background refresh keeps showing the cached copy.
          if (hit) return;
          const info =
            e instanceof ListingFetchError
              ? e.info
              : { kind: "server" as const, title: "Couldn't list this folder", message: "Something went wrong. Try again." };
          setSettled({ key, error: info });
        })
        .finally(() => {
          if (!controller.signal.aborted) setRefreshingKey((k) => (k === key ? null : k));
        });
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, prefix, debounceMs, attempt]);

  const retry = useCallback(() => {
    setSettled(null);
    setAttempt((n) => n + 1);
  }, []);

  if (key === null) return { status: "idle", retry };
  const hit = cache.get(key);
  if (hit) return { status: "ready", listing: hit.listing, refreshing: refreshingKey === key, retry };
  if (settled?.key === key && settled.error) return { status: "error", error: settled.error, retry };
  return { status: "loading", retry };
}
