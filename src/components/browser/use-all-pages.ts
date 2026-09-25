"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppError, Listing } from "@/lib/types";

export const PAGE_SIZE = 5000;

export interface PagedListing {
  listing: Listing;
  loadingMore: boolean;
  // Set when a later page failed; everything loaded so far stays usable.
  error: AppError | null;
}

type Extra = Pick<Listing, "folders" | "files">;

// Starts from the server-rendered first page and fetches the rest one page at a time, appending
// as each arrives. Aborts when the folder changes or the page unmounts.
export function useAllPages(first: Listing): PagedListing {
  const [extra, setExtra] = useState<Extra>({ folders: [], files: [] });
  const [loadingMore, setLoadingMore] = useState(Boolean(first.nextCursor));
  const [error, setError] = useState<AppError | null>(null);

  // A refresh brings a new first page: start over so deleted items don't linger.
  const [base, setBase] = useState(first);
  if (base !== first) {
    setBase(first);
    setExtra({ folders: [], files: [] });
    setLoadingMore(Boolean(first.nextCursor));
    setError(null);
  }

  useEffect(() => {
    let cursor = first.nextCursor;
    if (!cursor) return;
    const controller = new AbortController();

    (async () => {
      try {
        while (cursor) {
          const qs = new URLSearchParams({ prefix: first.prefix, limit: String(PAGE_SIZE), cursor });
          const res = await fetch(`/api/list?${qs}`, { signal: controller.signal, cache: "no-store" });
          const body = (await res.json().catch(() => null)) as Listing | { error: AppError } | null;
          if (!res.ok || !body || "error" in body) {
            throw body && "error" in body
              ? body.error
              : { title: "Couldn’t load the rest of this folder", message: `The server answered ${res.status}.`, status: res.status };
          }
          const page = body;
          setExtra((prev) => ({ folders: prev.folders.concat(page.folders), files: prev.files.concat(page.files) }));
          // Guard against a cursor that doesn't advance, which would loop forever.
          cursor = page.nextCursor && page.nextCursor !== cursor ? page.nextCursor : null;
        }
        setLoadingMore(false);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(
          e && typeof e === "object" && "title" in e
            ? (e as AppError)
            : { title: "Couldn’t load the rest of this folder", message: "Check your connection and refresh.", status: 0 },
        );
        setLoadingMore(false);
      }
    })();

    return () => controller.abort();
  }, [first]);

  const listing = useMemo<Listing>(() => {
    if (!extra.folders.length && !extra.files.length) return first;
    // Pages can overlap at their edges; keep the first copy of each folder and key.
    const seenFolders = new Set(first.folders.map((f) => f.prefix));
    const seenFiles = new Set(first.files.map((f) => f.key));
    return {
      ...first,
      folders: first.folders.concat(extra.folders.filter((f) => !seenFolders.has(f.prefix) && seenFolders.add(f.prefix))),
      files: first.files.concat(extra.files.filter((f) => !seenFiles.has(f.key) && seenFiles.add(f.key))),
      truncated: loadingMore,
      nextCursor: null,
    };
  }, [first, extra, loadingMore]);

  return { listing, loadingMore, error };
}
