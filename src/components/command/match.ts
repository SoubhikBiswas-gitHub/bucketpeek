import { defaultFilter } from "cmdk";
import { normalizePrefix } from "@/lib/paths";

export type ParsedQuery =
  | { mode: "default" }
  | { mode: "search"; term: string }
  | { mode: "path"; prefix: string; term: string }
  | { mode: "foreign"; bucket: string };

export function parseQuery(raw: string, { bucket, currentPrefix }: { bucket: string; currentPrefix: string }): ParsedQuery {
  let q = raw.trim();
  if (!q) return { mode: "default" };

  const uri = /^s3:\/\/([^/]*)\/?(.*)$/i.exec(q);
  if (uri) {
    const [, name = "", rest = ""] = uri;
    if (!name) return { mode: "search", term: q };
    if (name !== bucket) return { mode: "foreign", bucket: name };
    q = `/${rest}`;
  }

  if (!q.includes("/")) return { mode: "search", term: q };

  const relative = q.startsWith("./") || q.startsWith("../") || q === "." || q === "..";
  const cut = q.lastIndexOf("/");
  const dir = q.slice(0, cut + 1);
  const term = q.slice(cut + 1);

  const parts = relative ? currentPrefix.split("/").filter(Boolean) : [];
  for (const segment of dir.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return { mode: "path", prefix: normalizePrefix(parts.join("/")), term };
}

const MIN_SCORE = 0.05;
const STRONG_SCORE = 0.5;
const WEAK_SCORE = 0.2;

// cmdk's command-score, so results rank like the rest of the menu. 0 means no match.
export function scoreOf(text: string, term: string, keywords?: string[]): number {
  if (!term) return 1;
  const base = defaultFilter(text, term, keywords);
  // Scattered single letters ("epi" in "sensor_dump.bin") score below this; word-start
  // abbreviations ("e1pp" for episode_0001_pick_and_place) score above it.
  if (base < MIN_SCORE) return 0;
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  // Exact and prefix matches beat everything else, whatever command-score thinks of the rest.
  if (lower === t) return base + 2;
  if (lower.startsWith(t)) return base + 1;
  return base;
}

export type Range = readonly [start: number, end: number];

export function matchRanges(text: string, term: string): Range[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const lower = text.toLowerCase();
  const at = lower.indexOf(t);
  if (at >= 0) return [[at, at + t.length]];

  const ranges: [number, number][] = [];
  let from = 0;
  for (const ch of t) {
    if (ch === " ") continue;
    const i = lower.indexOf(ch, from);
    if (i < 0) return [];
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
    from = i + 1;
  }
  return ranges;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

export function rank<T>(
  items: readonly T[],
  term: string,
  name: (item: T) => string,
  keywords?: (item: T) => string[] | undefined,
): T[] {
  if (!term.trim()) return [...items];
  const scored = items.map((item, index) => ({ item, index, score: scoreOf(name(item), term, keywords?.(item)) }));
  // When some names contain the term outright, drop letters scattered across unrelated names
  // ("ep" in "frame_0001.png"); keep fuzzy-only results when nothing matches better.
  const floor = scored.some((r) => r.score >= STRONG_SCORE) ? WEAK_SCORE : 0;
  return scored
    .filter((r) => r.score > floor)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}
