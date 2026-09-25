import { KIND_GROUPS, groupOf, type KindGroupId } from "@/lib/kinds";
import { browseHref, viewHref } from "@/lib/paths";
import type { FileEntry, FileKind, Listing } from "@/lib/types";

// Pure logic, no React: rows, filtering, natural sorting and URL state.

export type SortKey = "name" | "type" | "size" | "modified";
export type SortDir = "asc" | "desc";
export type ViewMode = "list" | "grid";
export type KindFilter = KindGroupId | "all";

export interface BrowserParams {
  q: string;
  type: KindFilter;
  sort: SortKey;
  dir: SortDir;
  view: ViewMode;
}

interface ItemBase {
  // Folder prefix or file key; unique within a listing.
  id: string;
  name: string;
  // Normalized name, for matching.
  search: string;
}

export interface FolderItem extends ItemBase {
  isFolder: true;
  kind: "folder";
  prefix: string;
}

export interface FileItem extends ItemBase {
  isFolder: false;
  kind: FileKind;
  file: FileEntry;
}

export type Item = FolderItem | FileItem;

const SORT_KEYS: readonly SortKey[] = ["name", "type", "size", "modified"];
const GROUP_IDS = new Set<string>(KIND_GROUPS.map((g) => g.id));

export function defaultDir(sort: SortKey): SortDir {
  return sort === "size" || sort === "modified" ? "desc" : "asc";
}

export const DEFAULT_PARAMS: BrowserParams = { q: "", type: "all", sort: "name", dir: "asc", view: "list" };

interface ParamSource {
  get(name: string): string | null;
}

export function parseParams(sp: ParamSource): BrowserParams {
  const rawSort = sp.get("sort");
  const sort: SortKey = SORT_KEYS.includes(rawSort as SortKey) ? (rawSort as SortKey) : "name";
  const rawDir = sp.get("order");
  const dir: SortDir = rawDir === "asc" || rawDir === "desc" ? rawDir : defaultDir(sort);
  const rawType = sp.get("type");
  const type: KindFilter = rawType && GROUP_IDS.has(rawType) ? (rawType as KindGroupId) : "all";
  return {
    q: (sp.get("q") ?? "").slice(0, 200),
    type,
    sort,
    dir,
    view: sp.get("view") === "grid" ? "grid" : "list",
  };
}

// Omits defaults so links stay short.
export function searchFor(prefix: string, p: Partial<BrowserParams>): string {
  const out = new URLSearchParams();
  if (prefix) out.set("prefix", prefix);
  const q = p.q?.trim();
  if (q) out.set("q", q);
  if (p.type && p.type !== "all") out.set("type", p.type);
  const sort = p.sort ?? "name";
  if (sort !== "name") out.set("sort", sort);
  if (p.dir && p.dir !== defaultDir(sort)) out.set("order", p.dir);
  if (p.view === "grid") out.set("view", "grid");
  const s = out.toString();
  return s ? `?${s}` : "";
}

// Keeps only sort and view: search and type filter are per folder.
export function folderHref(prefix: string, keep: Pick<BrowserParams, "sort" | "dir" | "view">): string {
  const s = searchFor(prefix, keep);
  return s ? `/browse${s}` : browseHref(prefix);
}

export function itemHref(item: Item, keep: Pick<BrowserParams, "sort" | "dir" | "view">): string {
  return item.isFolder ? folderHref(item.prefix, keep) : viewHref(item.file.key);
}

export function s3Uri(bucket: string, item: Item): string {
  return `s3://${bucket}/${item.id}`;
}

// Shift-click range in display order; just `toId` when the anchor isn't shown any more
// (filtered out, or nothing clicked yet).
export function rangeIds(items: readonly Item[], fromId: string | null, toId: string): string[] {
  const to = items.findIndex((it) => it.id === toId);
  if (to < 0) return [];
  const from = fromId === null ? -1 : items.findIndex((it) => it.id === fromId);
  if (from < 0) return [toId];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return items.slice(lo, hi + 1).map((it) => it.id);
}

export function normalize(s: string): string {
  return s.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function toItems(listing: Listing): Item[] {
  const folders: Item[] = listing.folders.map((f) => ({
    id: f.prefix,
    name: f.name,
    search: normalize(f.name),
    isFolder: true,
    kind: "folder",
    prefix: f.prefix,
  }));
  const files: Item[] = listing.files.map((f) => ({
    id: f.key,
    name: f.name,
    search: normalize(f.name),
    isFolder: false,
    kind: f.kind,
    file: f,
  }));
  return folders.concat(files);
}

export function filterItems(items: Item[], q: string, type: KindFilter): Item[] {
  const needle = normalize(q.trim());
  if (!needle && type === "all") return items;
  return items.filter((it) => {
    if (type !== "all" && (it.isFolder || groupOf(it.kind) !== type)) return false;
    return !needle || it.search.includes(needle);
  });
}

// Fixed locale so server and client order rows identically. `numeric` puts episode_2 before episode_10.
const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

function byName(a: Item, b: Item): number {
  return collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const GROUP_ORDER = new Map<string, number>(KIND_GROUPS.map((g, i) => [g.id, i]));

function time(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

// Folders always come first. Files without a date sort last in either direction.
export function sortItems(items: Item[], sort: SortKey, dir: SortDir): Item[] {
  const sign = dir === "asc" ? 1 : -1;
  const folders: Item[] = [];
  const files: FileItem[] = [];
  for (const it of items) {
    if (it.isFolder) folders.push(it);
    else files.push(it);
  }
  // Folders have no size or date, so they follow the name order (reversed only for name descending).
  folders.sort((a, b) => (sort === "name" ? sign : 1) * byName(a, b));

  files.sort((a, b) => {
    switch (sort) {
      case "size":
        return sign * (a.file.size - b.file.size) || byName(a, b);
      case "modified": {
        const ta = time(a.file.modified);
        const tb = time(b.file.modified);
        if (ta === null || tb === null) return ta === tb ? byName(a, b) : ta === null ? 1 : -1;
        return sign * (ta - tb) || byName(a, b);
      }
      case "type":
        return (
          sign *
            ((GROUP_ORDER.get(groupOf(a.kind)) ?? 0) - (GROUP_ORDER.get(groupOf(b.kind)) ?? 0) ||
              collator.compare(a.file.type, b.file.type)) || byName(a, b)
        );
      default:
        return sign * byName(a, b);
    }
  });
  return folders.concat(files);
}

export type GroupCounts = Record<KindGroupId, number>;

export function groupCounts(items: Item[]): GroupCounts {
  const counts = Object.fromEntries(KIND_GROUPS.map((g) => [g.id, 0])) as GroupCounts;
  for (const it of items) if (!it.isFolder) counts[groupOf(it.kind)]++;
  return counts;
}

export function totalBytes(files: FileEntry[]): number {
  let n = 0;
  for (const f of files) n += f.size;
  return n;
}

export function matchParts(name: string, q: string): [string, string, string] | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  const i = name.toLowerCase().indexOf(needle);
  if (i < 0 || name.toLowerCase().length !== name.length) return null;
  return [name.slice(0, i), name.slice(i, i + needle.length), name.slice(i + needle.length)];
}

export const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  type: "Type",
  size: "Size",
  modified: "Modified",
};

export const DIR_LABELS: Record<SortKey, Record<SortDir, string>> = {
  name: { asc: "A to Z", desc: "Z to A" },
  type: { asc: "Grouped by type", desc: "Grouped by type, reversed" },
  size: { asc: "Smallest first", desc: "Largest first" },
  modified: { asc: "Oldest first", desc: "Newest first" },
};
