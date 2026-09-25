"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Database, FolderOpen, SearchX } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { BrowseOverview } from "@/components/health/bucket-overview";
import { RetryButton } from "@/components/common/retry-button";
import { Button } from "@/components/ui/button";
import { KIND_GROUPS } from "@/lib/kinds";
import { crumbsOf, parentOf } from "@/lib/paths";
import type { DownloadLimits } from "@/lib/download-limits";
import type { Listing } from "@/lib/types";
import { lastOpened, useEntryActions } from "./entry-actions";
import { FileGrid } from "./file-grid";
import { FileList } from "./file-list";
import {
  filterItems,
  folderHref,
  groupCounts,
  parseParams,
  searchFor,
  sortItems,
  toItems,
  type BrowserParams,
  type Item,
  type KindFilter,
  type SortDir,
  type SortKey,
  type ViewMode,
} from "./items";
import { SelectionBar } from "./selection-bar";
import { Toolbar } from "./toolbar";
import { BrowseHeader } from "./browse-header";
import { useAllPages } from "./use-all-pages";
import { useSelection } from "./use-selection";

export interface FileBrowserProps {
  listing: Listing;
  bucket: string;
  /** From the server's environment; limits what the selection bar's Download may fetch. */
  downloadLimits: DownloadLimits;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest("[role=dialog], [role=alertdialog], [role=menu]");
}

export function FileBrowser({ listing: firstPage, bucket, downloadLimits }: FileBrowserProps) {
  const { listing, loadingMore, error: pageError } = useAllPages(firstPage);
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useMemo(() => parseParams(searchParams), [searchParams]);
  const { prefix } = listing;
  const { type, sort, dir, view } = params;

  // The search box updates instantly; filtering follows at deferred priority and the URL is debounced.
  const [query, setQuery] = useState(params.q);
  const [urlQ, setUrlQ] = useState(params.q);
  if (params.q !== urlQ) {
    setUrlQ(params.q);
    if (params.q !== query.trim()) setQuery(params.q);
  }
  const deferredQuery = useDeferredValue(query);

  const writeParams = useCallback(
    (patch: Partial<BrowserParams>) => {
      const current = parseParams(new URLSearchParams(window.location.search));
      const next = { ...current, ...patch };
      window.history.replaceState(null, "", `${window.location.pathname}${searchFor(prefix, next)}`);
    },
    [prefix],
  );

  useEffect(() => {
    if (query.trim() === params.q) return;
    const t = setTimeout(() => writeParams({ q: query }), 250);
    return () => clearTimeout(t);
  }, [query, params.q, writeParams]);

  const all = useMemo(() => toItems(listing), [listing]);
  // Type counts follow the search, so each segment says how many results it would show.
  const matching = useMemo(() => filterItems(all, deferredQuery, "all"), [all, deferredQuery]);
  const counts = useMemo(() => groupCounts(matching), [matching]);
  const present = useMemo(() => groupCounts(all), [all]);
  const items = useMemo(
    () => sortItems(filterItems(matching, "", type), sort, dir),
    [matching, type, sort, dir],
  );
  const filtering = deferredQuery.trim() !== "" || type !== "all";

  // Roving focus is tracked by id so filtering and sorting keep the same item active.
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = Math.max(0, activeId ? items.findIndex((it) => it.id === activeId) : 0);
  const setActive = useCallback((i: number) => setActiveId(items[i]?.id ?? null), [items]);

  useEffect(() => {
    const id = lastOpened(prefix);
    // Restoring focus position after coming back from a file.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id && all.some((it) => it.id === id)) setActiveId(id);
  }, [prefix, all]);

  const actions = useEntryActions(bucket, prefix, { sort, dir, view });
  const selection = useSelection(items);
  const { toggle, selectAll, clear } = selection;
  const handlers = useMemo(
    () => ({
      onOpen: actions.open,
      onParent: prefix ? () => router.push(folderHref(parentOf(prefix), { sort, dir, view })) : undefined,
      onToggle: (item: Item, range: boolean) => toggle(item.id, range),
      onSelectAll: selectAll,
      onClearSelection: clear,
    }),
    [actions.open, prefix, router, sort, dir, view, toggle, selectAll, clear],
  );

  // "/" focuses search from anywhere on the page.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const clearFilters = useCallback(() => {
    setQuery("");
    writeParams({ q: "", type: "all" });
    searchRef.current?.focus();
  }, [writeParams]);

  const header = <BrowseHeader bucket={bucket} listing={listing} loadingMore={loadingMore} error={pageError} />;

  if (all.length === 0 && !loadingMore) {
    return (
      <>
        {header}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto rounded-lg border border-dashed border-line-2">
          <EmptyFolder bucket={bucket} prefix={prefix} keep={{ sort, dir, view }} />
        </div>
      </>
    );
  }

  const folderName = crumbsOf(prefix).at(-1)?.name ?? bucket;
  const label = `Contents of ${folderName}`;
  const shared = { items, label, query: deferredQuery, active: activeIndex, setActive, actions, handlers, prefix, selection };

  return (
    <>
      {header}
      {!prefix && (
        <div className="shrink-0 pb-3">
          <BrowseOverview />
        </div>
      )}
      <div className="shrink-0 pb-3">
        <Toolbar
          searchRef={searchRef}
          query={query}
          onQuery={setQuery}
          shown={items.length}
          matched={matching.length}
          total={all.length}
          filtering={filtering}
          type={type}
          onType={(t: KindFilter) => writeParams({ type: t })}
          counts={counts}
          present={present}
          fileCount={listing.files.length}
          sort={sort}
          dir={dir}
          onSort={(s: SortKey, d: SortDir) => writeParams({ sort: s, dir: d })}
          view={view}
          onView={(v: ViewMode) => writeParams({ view: v })}
        />
      </div>
      {selection.items.length > 0 && (
        <div className="shrink-0 pb-3">
          <SelectionBar bucket={bucket} selection={selection} shown={items.length} downloadLimits={downloadLimits} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto rounded-lg border border-dashed border-line-2">
          <NoMatches query={deferredQuery.trim()} type={type} onClear={clearFilters} />
        </div>
      ) : view === "grid" ? (
        <FileGrid {...shared} />
      ) : (
        <FileList {...shared} sort={sort} dir={dir} onSort={(s, d) => writeParams({ sort: s, dir: d })} />
      )}
    </>
  );
}

function NoMatches({ query, type, onClear }: { query: string; type: KindFilter; onClear: () => void }) {
  const group = KIND_GROUPS.find((g) => g.id === type);
  const what = group ? group.label.toLowerCase() : "items";
  const title = query ? `No ${what} match “${query}”` : `No ${what} in this folder`;
  return (
    <EmptyState
      icon={SearchX}
      title={title}
      description={
        query
          ? "Search looks at names in this folder only, not in subfolders."
          : "Try another type, or open a subfolder."
      }
      action={
        <Button variant="outline" onClick={onClear} className="h-11 sm:h-8">
          Clear filters
        </Button>
      }
    />
  );
}

function EmptyFolder({
  bucket,
  prefix,
  keep,
}: {
  bucket: string;
  prefix: string;
  keep: Pick<BrowserParams, "sort" | "dir" | "view">;
}) {
  if (!prefix) {
    return (
      <EmptyState
        icon={Database}
        title="This bucket is empty"
        description={
          <>
            <span className="font-mono text-text-1">{bucket}</span> has no files yet. Upload files with the AWS console or CLI,
            then refresh.
          </>
        }
        action={
          <>
            <RetryButton label="Refresh" variant="outline" />
            <Button asChild>
              <Link href="/setup">Connect a different bucket</Link>
            </Button>
          </>
        }
      />
    );
  }
  const parent = parentOf(prefix);
  const parentName = crumbsOf(parent).at(-1)?.name;
  return (
    <EmptyState
      icon={FolderOpen}
      title="This folder is empty"
      description="There are no files or subfolders under this path. If you just uploaded something, refresh."
      action={
        <>
          <Button asChild variant="outline">
            <Link href={folderHref(parent, keep)}>
              <ArrowLeft aria-hidden data-icon="inline-start" />
              <span className="max-w-72 truncate">{parentName ? `Back to ${parentName}` : "Back to bucket root"}</span>
            </Link>
          </Button>
          <RetryButton label="Refresh" variant="ghost" />
        </>
      }
    />
  );
}
