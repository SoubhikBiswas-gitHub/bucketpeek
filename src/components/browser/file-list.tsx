"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  createColumnHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { KindIcon } from "@/components/common/kind-icon";
import { Pill } from "@/components/common/pill";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { kindColor } from "@/lib/kinds";
import { cn } from "@/lib/utils";
import { EntryContextMenu, InlineActions, MoreActions, rememberOpened, type EntryActions } from "./entry-actions";
import { defaultDir, type Item, type SortDir, type SortKey } from "./items";
import { Highlight } from "./highlight";
import { useMediaQuery, MOBILE_QUERY } from "./use-media-query";
import { useRoving, type RovingHandlers } from "./use-roving";
import { useSavedScroll } from "./use-saved-scroll";
import type { Selection } from "./use-selection";

const features = tableFeatures({ rowSortingFeature });
const helper = createColumnHelper<typeof features, Item>();

const columns = helper.columns([
  helper.display({ id: "select", header: "Select", enableSorting: false }),
  helper.accessor("name", { header: "Name", sortDescFirst: false }),
  helper.accessor((row) => (row.isFolder ? "Folder" : row.file.type), { id: "type", header: "Type", sortDescFirst: false }),
  helper.accessor((row) => (row.isFolder ? -1 : row.file.size), { id: "size", header: "Size", sortDescFirst: true }),
  helper.accessor((row) => (row.isFolder ? null : row.file.modified), {
    id: "modified",
    header: "Modified",
    sortDescFirst: true,
  }),
  helper.display({ id: "actions", header: "Actions", enableSorting: false }),
]);

// Narrow screens drop columns instead of scrolling sideways: below md the date goes, below sm type
// and size move under the name.
const TRACKS =
  "grid-cols-[1.25rem_minmax(0,1fr)_auto] sm:grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_6rem_4.75rem] md:grid-cols-[1.25rem_minmax(0,1fr)_6.5rem_6.5rem_10rem_4.75rem]";

const CELL: Record<string, string> = {
  select: "flex items-center",
  name: "min-w-0",
  type: "hidden min-w-0 sm:flex",
  size: "hidden sm:block text-right tabular-nums text-text-2",
  modified: "hidden md:block truncate pl-6 tabular-nums text-text-2",
  actions: "flex items-center justify-end",
};

const HEAD: Record<string, string> = {
  name: "pl-[30px]",
  type: "hidden sm:flex",
  size: "hidden sm:flex justify-end",
  modified: "hidden md:flex pl-6",
};

const ROW_HEIGHT = 44;
const MOBILE_ROW_HEIGHT = 60;
const HEADER_HEIGHT = 36;

export interface FileListProps {
  items: Item[];
  label: string;
  query: string;
  sort: SortKey;
  dir: SortDir;
  onSort: (sort: SortKey, dir: SortDir) => void;
  active: number;
  setActive: (i: number) => void;
  actions: EntryActions;
  handlers: RovingHandlers;
  prefix: string;
  selection: Selection;
}

export function FileList({
  items,
  label,
  query,
  sort,
  dir,
  onSort,
  active,
  setActive,
  actions,
  handlers,
  prefix,
  selection,
}: FileListProps) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const rowHeight = mobile ? MOBILE_ROW_HEIGHT : ROW_HEIGHT;
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialOffset = useSavedScroll(scrollRef, `list:${prefix}`);

  const sorting = useMemo<SortingState>(() => [{ id: sort, desc: dir === "desc" }], [sort, dir]);

  const table = useTable({
    features,
    columns,
    data: items,
    getRowId: (row) => row.id,
    // Rows arrive sorted (folders first, natural order); the table owns column state and header behavior.
    manualSorting: true,
    enableSortingRemoval: false,
    enableMultiSort: false,
    state: { sorting },
    onSortingChange: (updater: Updater<SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      if (!s) return;
      const key = s.id as SortKey;
      // A different column starts in its natural direction; the same column flips.
      onSort(key, key === sort ? (s.desc ? "desc" : "asc") : defaultDir(key));
    },
  });

  const rows = table.getRowModel().rows;
  const headerHeight = mobile ? 0 : HEADER_HEIGHT;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    initialOffset,
    estimateSize: () => rowHeight,
    overscan: 10,
    paddingStart: headerHeight,
    scrollPaddingStart: headerHeight,
    initialRect: { width: 1432, height: 640 },
    getItemKey: (i) => rows[i]?.id ?? i,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight, headerHeight]);

  const { onKeyDown, tabIndexOf } = useRoving({
    container: scrollRef,
    items,
    active,
    setActive,
    cols: 1,
    page: () => Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? 600) - headerHeight) / rowHeight) - 1),
    scrollTo: (i) => virtualizer.scrollToIndex(i, { align: "auto" }),
    handlers,
  });

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={label}
      aria-rowcount={items.length + 1}
      aria-colcount={6}
      aria-multiselectable
      onKeyDown={onKeyDown}
      className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-line-1 bg-surface-1 [scrollbar-gutter:stable]"
    >
      <div role="rowgroup" className="sticky top-0 z-10 hidden sm:block">
        {table.getHeaderGroups().map((group) => (
          <div
            key={group.id}
            role="row"
            aria-rowindex={1}
            className={cn(
              "grid items-center gap-x-3 border-b border-line-1 bg-surface-2 px-3 text-[13px] font-medium text-text-2",
              TRACKS,
            )}
            style={{ height: HEADER_HEIGHT }}
          >
            {group.headers.map((header) => {
              const col = header.column;
              if (header.id === "select") {
                return (
                  <div key={header.id} role="columnheader" className={CELL.select}>
                    <Checkbox
                      checked={selection.state === "all" ? true : selection.state === "some" ? "indeterminate" : false}
                      onCheckedChange={() => (selection.state === "all" ? selection.clear() : selection.selectAll())}
                      aria-label={selection.state === "all" ? "Clear selection" : "Select all"}
                    />
                  </div>
                );
              }
              if (!col.getCanSort()) {
                return (
                  <div key={header.id} role="columnheader" className="sr-only">
                    <table.FlexRender header={header} />
                  </div>
                );
              }
              const isSorted = col.getIsSorted();
              const Icon = isSorted === "asc" ? ArrowUp : isSorted === "desc" ? ArrowDown : ChevronsUpDown;
              const right = header.id === "size";
              return (
                <div
                  key={header.id}
                  role="columnheader"
                  aria-sort={isSorted === "asc" ? "ascending" : isSorted === "desc" ? "descending" : "none"}
                  className={cn("min-w-0", HEAD[header.id])}
                >
                  <button
                    type="button"
                    onClick={col.getToggleSortingHandler()}
                    className={cn(
                      "group/sort -mx-1.5 inline-flex h-7 max-w-full items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-surface-3 hover:text-text-1 focus-visible:outline-offset-0",
                      isSorted && "text-text-1",
                      right && "flex-row-reverse",
                    )}
                  >
                    <span className="truncate">
                      <table.FlexRender header={header} />
                    </span>
                    <Icon
                      aria-hidden
                      className={cn(
                        "size-3.5 shrink-0",
                        isSorted
                          ? "text-brand"
                          : "text-text-3 opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
                      )}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div
        role="rowgroup"
        className="absolute inset-x-0 top-0"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          return (
            <ListRow
              key={row.id}
              item={row.original}
              index={v.index}
              top={v.start}
              height={rowHeight}
              last={v.index === rows.length - 1}
              tabIndex={tabIndexOf(v.index)}
              isActive={v.index === active}
              query={query}
              actions={actions}
              prefix={prefix}
              onFocusRow={setActive}
              selected={selection.has(row.id)}
              onToggle={selection.toggle}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ListRowProps {
  item: Item;
  index: number;
  top: number;
  height: number;
  last: boolean;
  tabIndex: number;
  isActive: boolean;
  query: string;
  actions: EntryActions;
  prefix: string;
  onFocusRow: (i: number) => void;
  selected: boolean;
  onToggle: (id: string, range: boolean) => void;
}

const ListRow = memo(function ListRow({
  item,
  index,
  top,
  height,
  last,
  tabIndex,
  isActive,
  query,
  actions,
  prefix,
  onFocusRow,
  selected,
  onToggle,
}: ListRowProps) {
  const href = actions.href(item);
  const file = item.isFolder ? null : item.file;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="row"
          aria-rowindex={index + 2}
          aria-selected={selected}
          data-selected={selected || undefined}
          data-nav-index={index}
          tabIndex={tabIndex}
          onFocus={(e) => {
            if (e.target === e.currentTarget) onFocusRow(index);
          }}
          onPointerEnter={() => actions.prefetch(item)}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a, button, [role=menuitem]")) return;
            if (e.shiftKey) onToggle(item.id, true);
            else actions.open(item, e.metaKey || e.ctrlKey);
          }}
          onAuxClick={(e) => {
            if (e.button === 1 && !(e.target as HTMLElement).closest("a, button")) actions.open(item, true);
          }}
          className={cn(
            "group/row absolute inset-x-0 top-0 grid cursor-pointer items-center gap-x-3 pr-1 pl-3 select-none sm:pr-3",
            "transition-colors duration-100 hover:bg-surface-2 focus-visible:bg-surface-2 data-[state=open]:bg-surface-2",
            "data-selected:bg-brand-mist data-selected:hover:bg-brand-mist",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
            !last && "border-b border-line-1",
            TRACKS,
          )}
          style={{ height, transform: `translateY(${top}px)` }}
        >
          <div role="gridcell" className={CELL.select}>
            <Checkbox
              checked={selected}
              tabIndex={-1}
              aria-label={`Select ${item.name}`}
              // onClick rather than onCheckedChange: Shift needs the click event.
              onClick={(e) => {
                e.stopPropagation();
                onToggle(item.id, e.shiftKey);
              }}
            />
          </div>
          <div role="gridcell" className={cn(CELL.name, "flex items-center gap-3")}>
            <KindIcon kind={item.kind} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <Link
                href={href}
                prefetch={false}
                tabIndex={-1}
                title={item.name}
                draggable={false}
                onClick={(e) => {
                  if (!e.metaKey && !e.ctrlKey && !e.shiftKey) rememberOpened(prefix, item.id);
                }}
                className={cn(
                  "block truncate text-text-1 outline-none hover:underline hover:decoration-line-3 hover:underline-offset-4",
                  item.isFolder && "font-medium",
                )}
              >
                <Highlight text={item.name} query={query} />
              </Link>
              <div className="mt-0.5 flex gap-3 truncate text-xs text-text-2 sm:hidden">
                {file ? (
                  <>
                    <span>{file.type}</span>
                    <span className="tabular-nums">{formatBytes(file.size)}</span>
                  </>
                ) : (
                  <span>Folder</span>
                )}
              </div>
            </div>
          </div>
          <div role="gridcell" className={CELL.type}>
            <Pill
              icon={<span className="block size-1.5 rounded-full" style={{ background: kindColor(item.kind) }} />}
              className="h-5 px-2 font-mono text-[11px] text-text-2"
            >
              {file ? file.type : "Folder"}
            </Pill>
          </div>
          <div role="gridcell" className={CELL.size}>
            {file ? formatBytes(file.size) : <span className="sr-only">No size</span>}
          </div>
          <div role="gridcell" className={CELL.modified}>
            {file?.modified ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-default">{formatDate(file.modified)}</span>
                </TooltipTrigger>
                <TooltipContent side="top">{formatDateTime(file.modified)}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <div role="gridcell" className={CELL.actions}>
            <div
              className={cn(
                "hidden items-center gap-0.5 sm:flex",
                "opacity-0 transition-opacity duration-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 group-data-[state=open]/row:opacity-100",
                "[@media(hover:none)]:opacity-100",
              )}
            >
              <InlineActions item={item} actions={actions} tabIndex={isActive ? 0 : -1} />
            </div>
            <MoreActions item={item} actions={actions} tabIndex={isActive ? 0 : -1} className="size-11 sm:hidden" />
          </div>
        </div>
      </ContextMenuTrigger>
      <EntryContextMenu item={item} actions={actions} />
    </ContextMenu>
  );
});
