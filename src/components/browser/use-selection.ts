"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { rangeIds, type Item } from "./items";

export interface Selection {
  // Selected items among those shown, in display order.
  items: Item[];
  has: (id: string) => boolean;
  // With `range`, selects everything from the last flipped item to this one.
  toggle: (id: string, range?: boolean) => void;
  selectAll: () => void;
  // Returns whether anything was selected, so Escape can fall through when nothing was.
  clear: () => boolean;
  // For a "select all" checkbox over the shown items.
  state: "none" | "some" | "all";
}

// Ids stay selected while a search hides them, but only shown items count and are acted on, so
// nothing hidden is copied or downloaded by surprise.
export function useSelection(shown: Item[]): Selection {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  const items = useMemo(() => (ids.size ? shown.filter((it) => ids.has(it.id)) : []), [shown, ids]);

  const toggle = useCallback(
    (id: string, range = false) => {
      if (range && anchor.current !== null) {
        const add = rangeIds(shown, anchor.current, id);
        setIds((prev) => new Set([...prev, ...add]));
      } else {
        setIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }
      anchor.current = id;
    },
    [shown],
  );

  const selectAll = useCallback(() => {
    setIds((prev) => new Set([...prev, ...shown.map((it) => it.id)]));
  }, [shown]);

  const clear = useCallback(() => {
    anchor.current = null;
    if (ids.size === 0) return false;
    setIds(new Set());
    return true;
  }, [ids]);

  const has = useCallback((id: string) => ids.has(id), [ids]);
  const state = items.length === 0 ? "none" : items.length === shown.length ? "all" : "some";

  return { items, has, toggle, selectAll, clear, state };
}
