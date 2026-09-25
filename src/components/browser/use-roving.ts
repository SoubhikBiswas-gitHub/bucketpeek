"use client";

import { useLayoutEffect, useRef } from "react";
import type { Item } from "./items";

export interface NavContext {
  index: number;
  count: number;
  // Items per visual row (1 for the list).
  cols: number;
  // Items that fit on one screen, for PageUp/PageDown.
  page: number;
}

export function nextIndex(key: string, { index, count, cols, page }: NavContext): number | null {
  if (count === 0) return null;
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  switch (key) {
    case "ArrowDown":
      return clamp(index + cols);
    case "ArrowUp":
      return clamp(index - cols);
    case "ArrowRight":
      return cols > 1 ? clamp(index + 1) : null;
    case "ArrowLeft":
      return cols > 1 ? clamp(index - 1) : null;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return clamp(index + Math.max(cols, Math.floor(page / cols) * cols));
    case "PageUp":
      return clamp(index - Math.max(cols, Math.floor(page / cols) * cols));
    default:
      return null;
  }
}

export interface RovingHandlers {
  onOpen: (item: Item, newTab: boolean) => void;
  onParent?: () => void;
  // Space; Shift+Space selects a range.
  onToggle?: (item: Item, range: boolean) => void;
  // Ctrl/Cmd+A.
  onSelectAll?: () => void;
  // Escape. Returns whether anything was selected; otherwise the key is left alone.
  onClearSelection?: () => boolean;
}

// One roving tab stop shared by list and grid. `scrollTo` must bring the index into view so the
// element can be focused after render.
export function useRoving({
  container,
  items,
  active,
  setActive,
  cols,
  page,
  scrollTo,
  handlers,
}: {
  container: React.RefObject<HTMLElement | null>;
  items: Item[];
  active: number;
  setActive: (i: number) => void;
  cols: number;
  // Read lazily from the scroll region.
  page: () => number;
  scrollTo: (i: number) => void;
  handlers: RovingHandlers;
}) {
  const pendingFocus = useRef<number | null>(null);

  // After each render, focus the requested element once the virtualizer has mounted it.
  useLayoutEffect(() => {
    const i = pendingFocus.current;
    if (i === null) return;
    const el = container.current?.querySelector<HTMLElement>(`[data-nav-index="${i}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });

  const focusIndex = (i: number) => {
    setActive(i);
    pendingFocus.current = i;
    scrollTo(i);
    const el = container.current?.querySelector<HTMLElement>(`[data-nav-index="${i}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    // Only handle keys on the item itself, not on buttons or menus inside it.
    if (!target.hasAttribute("data-nav-index")) return;
    const index = Number(target.getAttribute("data-nav-index"));
    const item = items[index];
    if (!item) return;

    if (e.key === "Enter" && !e.altKey) {
      e.preventDefault();
      handlers.onOpen(item, e.metaKey || e.ctrlKey);
      return;
    }
    if (e.key === "Backspace" && handlers.onParent && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      handlers.onParent();
      return;
    }
    if (e.key === " " && handlers.onToggle && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      handlers.onToggle(item, e.shiftKey);
      return;
    }
    if (e.key.toLowerCase() === "a" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && handlers.onSelectAll) {
      e.preventDefault();
      handlers.onSelectAll();
      return;
    }
    if (e.key === "Escape" && handlers.onClearSelection?.()) {
      e.preventDefault();
      return;
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const next = nextIndex(e.key, { index, count: items.length, cols, page: page() });
    if (next === null) return;
    e.preventDefault();
    if (next !== index) focusIndex(next);
  };

  return { onKeyDown, focusIndex, tabIndexOf: (i: number) => (i === active ? 0 : -1) };
}
