"use client";

import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

export const MAX_RECENTS = 8;

const RecentSchema = z.object({
  type: z.enum(["folder", "file"]),
  // Folder prefix (with trailing slash) or object key.
  path: z.string().min(1).max(2048),
  at: z.number(),
});

export type Recent = z.infer<typeof RecentSchema>;

const EMPTY: readonly Recent[] = Object.freeze([]);
const storageKey = (bucket: string) => `lens:recents:v1:${bucket}`;

const memory = new Map<string, readonly Recent[]>();
const listeners = new Set<() => void>();

function readStorage(bucket: string): readonly Recent[] {
  try {
    const raw = window.localStorage.getItem(storageKey(bucket));
    if (!raw) return EMPTY;
    const parsed = z.array(RecentSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.slice(0, MAX_RECENTS) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function load(bucket: string): readonly Recent[] {
  let value = memory.get(bucket);
  if (!value) {
    value = readStorage(bucket);
    memory.set(bucket, value);
  }
  return value;
}

function write(bucket: string, next: readonly Recent[]): void {
  memory.set(bucket, next);
  try {
    if (next.length) window.localStorage.setItem(storageKey(bucket), JSON.stringify(next));
    else window.localStorage.removeItem(storageKey(bucket));
  } catch {
    // Private mode or quota: keep the in-memory copy for this tab.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("lens:recents:")) {
      memory.clear();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function recordRecent(bucket: string, entry: Omit<Recent, "at">): void {
  const current = load(bucket);
  const first = current[0];
  if (first && first.type === entry.type && first.path === entry.path) return;
  const next = [
    { ...entry, at: Date.now() },
    ...current.filter((r) => !(r.type === entry.type && r.path === entry.path)),
  ].slice(0, MAX_RECENTS);
  write(bucket, next);
}

export function clearRecents(bucket: string): void {
  write(bucket, EMPTY);
}

export function useRecents(bucket: string): readonly Recent[] {
  const getSnapshot = useCallback(() => load(bucket), [bucket]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
