"use client";

import Link from "next/link";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { KindIcon } from "@/components/common/kind-icon";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { formatBytes } from "@/lib/format";
import { kindColor } from "@/lib/kinds";
import { cn } from "@/lib/utils";
import { EntryContextMenu, MoreActions, rememberOpened, type EntryActions } from "./entry-actions";
import { Highlight } from "./highlight";
import type { Item } from "./items";
import { TilePreview } from "./tile-preview";
import { PreviewRootContext } from "./use-near-viewport";
import { useRoving, type RovingHandlers } from "./use-roving";
import { useSavedScroll } from "./use-saved-scroll";
import type { Selection } from "./use-selection";

const CAPTION_HEIGHT = 58;
// Width the server assumes before the container is measured (page width minus gutters).
const INITIAL_WIDTH = 1432;

function layoutFor(width: number) {
  const gap = width < 640 ? 10 : 14;
  const min = width < 640 ? 150 : 176;
  const cols = Math.max(2, Math.floor((width + gap) / (min + gap)));
  const tile = (width - gap * (cols - 1)) / cols;
  return { cols, gap, tile, rowHeight: Math.round(tile * 0.75 + CAPTION_HEIGHT + gap) };
}

export interface FileGridProps {
  items: Item[];
  label: string;
  query: string;
  active: number;
  setActive: (i: number) => void;
  actions: EntryActions;
  handlers: RovingHandlers;
  prefix: string;
  selection: Selection;
}

// Room around tiles so focus outlines aren't clipped by the scroll region.
const INSET = 4;

export function FileGrid({ items, label, query, active, setActive, actions, handlers, prefix, selection }: FileGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(INITIAL_WIDTH);
  const initialOffset = useSavedScroll(scrollRef, `grid:${prefix}`);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const { cols, gap, tile, rowHeight } = layoutFor(width);
  const rowCount = Math.ceil(items.length / cols);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    initialOffset,
    estimateSize: () => rowHeight,
    overscan: 3,
    paddingStart: INSET,
    paddingEnd: INSET,
    scrollPaddingStart: INSET,
    scrollPaddingEnd: INSET,
    initialRect: { width: INITIAL_WIDTH, height: 640 },
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight, cols]);

  const { onKeyDown, tabIndexOf } = useRoving({
    container: scrollRef,
    items,
    active,
    setActive,
    cols,
    page: () => Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 600) / rowHeight)) * cols,
    scrollTo: (i) => virtualizer.scrollToIndex(Math.floor(i / cols), { align: "auto" }),
    handlers,
  });

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={label}
      aria-rowcount={rowCount}
      aria-colcount={cols}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
    >
      <PreviewRootContext value={scrollRef}>
        <div ref={bodyRef} className="relative" style={{ height: virtualizer.getTotalSize(), marginInline: INSET }}>
          {virtualizer.getVirtualItems().map((v) => {
            const start = v.index * cols;
            const rowItems = items.slice(start, start + cols);
            return (
              <div
                key={v.key}
                role="row"
                aria-rowindex={v.index + 1}
                className="absolute inset-x-0 top-0 grid"
                style={{
                  transform: `translateY(${v.start}px)`,
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  columnGap: gap,
                  height: rowHeight - gap,
                }}
              >
                {rowItems.map((item, j) => (
                  <Tile
                    key={item.id}
                    item={item}
                    index={start + j}
                    col={j}
                    tabIndex={tabIndexOf(start + j)}
                    isActive={start + j === active}
                    mediaHeight={Math.round(tile * 0.75)}
                    query={query}
                    actions={actions}
                    prefix={prefix}
                    onFocusTile={setActive}
                    selected={selection.has(item.id)}
                    selecting={selection.state !== "none"}
                    onToggle={selection.toggle}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </PreviewRootContext>
    </div>
  );
}

interface TileProps {
  item: Item;
  index: number;
  col: number;
  tabIndex: number;
  isActive: boolean;
  mediaHeight: number;
  query: string;
  actions: EntryActions;
  prefix: string;
  onFocusTile: (i: number) => void;
  selected: boolean;
  // Something is selected: every tile shows its checkbox, not only on hover.
  selecting: boolean;
  onToggle: (id: string, range: boolean) => void;
}

const Tile = memo(function Tile({
  item,
  index,
  col,
  tabIndex,
  isActive,
  mediaHeight,
  query,
  actions,
  prefix,
  onFocusTile,
  selected,
  selecting,
  onToggle,
}: TileProps) {
  const file = item.isFolder ? null : item.file;
  const tint = kindColor(item.kind);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="gridcell"
          aria-colindex={col + 1}
          aria-label={file ? `${item.name}, ${file.type}, ${formatBytes(file.size)}` : `${item.name}, folder`}
          data-nav-index={index}
          data-active={isActive || undefined}
          aria-selected={selected}
          data-selected={selected || undefined}
          tabIndex={tabIndex}
          onFocus={(e) => {
            if (e.target === e.currentTarget) onFocusTile(index);
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
            "group/tile relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border border-line-1 bg-surface-1 select-none",
            "transition-[border-color,background-color] duration-100 hover:border-line-3 hover:bg-surface-2",
            "focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
            "data-selected:border-brand data-selected:bg-brand-mist",
          )}
        >
          <div className="relative shrink-0 border-b border-line-1" style={{ height: mediaHeight }}>
            <div
              className="grid size-full place-items-center"
              style={{ background: `radial-gradient(ellipse at 50% 60%, color-mix(in oklab, ${tint} 9%, transparent), transparent 70%), var(--surface-2)` }}
            >
              <KindIcon kind={item.kind} size={Math.min(48, Math.max(30, mediaHeight / 3.2))} strokeWidth={1.25} />
            </div>
            {file && <TilePreview file={file} />}
            <div
              className={cn(
                "absolute top-2 left-2 grid size-6 place-items-center rounded-md bg-surface-0/85 backdrop-blur-sm transition-opacity duration-100",
                selected || selecting
                  ? "opacity-100"
                  : "opacity-0 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              <Checkbox
                checked={selected}
                tabIndex={-1}
                aria-label={`Select ${item.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(item.id, e.shiftKey);
                }}
              />
            </div>
            {file && (
              <span className="absolute bottom-2 left-2 rounded-[5px] bg-surface-0/85 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-text-1 backdrop-blur-sm">
                {file.type}
              </span>
            )}
            <div
              className={cn(
                "absolute top-1.5 right-1.5 rounded-md bg-surface-0/85 backdrop-blur-sm",
                "opacity-0 transition-opacity duration-100 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 group-data-[state=open]/tile:opacity-100",
                "[@media(hover:none)]:opacity-100",
              )}
            >
              <MoreActions item={item} actions={actions} tabIndex={isActive ? 0 : -1} className="size-8 [@media(hover:none)]:size-11" />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3">
            <Link
              href={actions.href(item)}
              prefetch={false}
              tabIndex={-1}
              title={item.name}
              draggable={false}
              onClick={(e) => {
                if (!e.metaKey && !e.ctrlKey && !e.shiftKey) rememberOpened(prefix, item.id);
              }}
              className={cn("block truncate text-[13px] text-text-1 outline-none", item.isFolder && "font-medium")}
            >
              <Highlight text={item.name} query={query} />
            </Link>
            <span className="truncate text-xs text-text-2 tabular-nums">
              {file ? formatBytes(file.size) : "Folder"}
            </span>
          </div>
        </div>
      </ContextMenuTrigger>
      <EntryContextMenu item={item} actions={actions} />
    </ContextMenu>
  );
});
