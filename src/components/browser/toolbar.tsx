"use client";

import { ArrowDownWideNarrow, ArrowUpNarrowWide, Layers, LayoutGrid, List, Search, X } from "lucide-react";
import { KindIcon } from "@/components/common/kind-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KIND_GROUPS, type KindGroupId } from "@/lib/kinds";
import type { FileKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  DIR_LABELS,
  SORT_LABELS,
  defaultDir,
  type GroupCounts,
  type KindFilter,
  type SortDir,
  type SortKey,
  type ViewMode,
} from "./items";
import { useMediaQuery } from "./use-media-query";

// Below `lg` the search field is too narrow for the full placeholder.
const COMPACT_QUERY = "(max-width: 1023.98px)";

const SORT_ORDER: SortKey[] = ["name", "modified", "size", "type"];

// Representative kind per filter group, for its icon and tint.
const GROUP_KIND: Record<KindGroupId, FileKind> = {
  video: "video",
  image: "image",
  audio: "audio",
  document: "markdown",
  data: "json",
  other: "other",
};

export interface ToolbarProps {
  query: string;
  onQuery: (q: string) => void;
  // After search and type filter.
  shown: number;
  // Matching the search, before the type filter.
  matched: number;
  total: number;
  filtering: boolean;
  type: KindFilter;
  onType: (t: KindFilter) => void;
  // Per-group counts for the current search.
  counts: GroupCounts;
  // Per-group counts for the whole folder, which decide the segments shown.
  present: GroupCounts;
  fileCount: number;
  sort: SortKey;
  dir: SortDir;
  onSort: (s: SortKey, d: SortDir) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  searchRef: React.Ref<HTMLInputElement>;
}

// One row from `sm` up (segment labels join at `xl`). On phones the type filter drops to its own
// full-width row under search, sort and layout.
export function Toolbar({
  query,
  onQuery,
  shown,
  matched,
  total,
  filtering,
  type,
  onType,
  counts,
  present,
  fileCount,
  sort,
  dir,
  onSort,
  view,
  onView,
  searchRef,
}: ToolbarProps) {
  const compact = useMediaQuery(COMPACT_QUERY);
  // Segments follow what's in the folder, not the search, so the control doesn't jump while typing.
  const groups = KIND_GROUPS.filter((g) => present[g.id] > 0 || g.id === type);
  const DirIcon = dir === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow;

  return (
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
      <InputGroup className="h-11 min-w-28 flex-1 bg-surface-1 sm:h-9 xl:max-w-72 dark:bg-surface-1">
        <InputGroupAddon>
          <Search aria-hidden className="text-text-3" />
        </InputGroupAddon>
        <InputGroupInput
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            if (query) {
              e.preventDefault();
              e.stopPropagation();
              onQuery("");
            } else {
              e.currentTarget.blur();
            }
          }}
          placeholder={compact ? "Search" : "Search this folder"}
          aria-label="Search this folder"
          aria-keyshortcuts="/"
          autoComplete="off"
          spellCheck={false}
          className="[&::-webkit-search-cancel-button]:appearance-none"
        />
        <InputGroupAddon align="inline-end">
          {query ? (
            <>
              <span className="hidden text-xs whitespace-nowrap text-text-3 tabular-nums md:inline" aria-hidden>
                {shown.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
              </span>
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => onQuery("")}
                className="text-text-2 hover:text-text-1 max-sm:size-9"
              >
                <X aria-hidden />
              </InputGroupButton>
            </>
          ) : (
            <Kbd className="hidden border border-line-2 bg-surface-2 font-mono text-text-2 sm:inline-flex">/</Kbd>
          )}
        </InputGroupAddon>
      </InputGroup>

      {fileCount > 0 && (
        <ToggleGroup
          type="single"
          value={type}
          onValueChange={(v) => onType((v || "all") as KindFilter)}
          aria-label="Filter by type"
          spacing={0}
          className="order-last flex w-full shrink-0 gap-0.5 rounded-lg border border-line-1 bg-surface-1 p-0.5 sm:order-none sm:w-auto"
        >
          <FilterItem value="all" label="All" count={matched} icon={<Layers aria-hidden className="size-3.5 text-text-2" />} />
          {groups.map((g) => (
            <FilterItem
              key={g.id}
              value={g.id}
              label={g.label}
              count={counts[g.id]}
              icon={<KindIcon kind={GROUP_KIND[g.id]} size={14} />}
            />
          ))}
        </ToggleGroup>
      )}

      <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-11 gap-2 bg-surface-1 px-3 text-text-1 max-lg:w-11 max-lg:px-0 sm:h-9 max-lg:sm:w-9 dark:bg-surface-1"
                  aria-label={`Sort by ${SORT_LABELS[sort].toLowerCase()}, ${DIR_LABELS[sort][dir].toLowerCase()}`}
                >
                  <DirIcon aria-hidden className="text-text-2" />
                  <span className="hidden lg:inline">{SORT_LABELS[sort]}</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent className="lg:hidden">
              Sort by {SORT_LABELS[sort].toLowerCase()}, {DIR_LABELS[sort][dir].toLowerCase()}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-xs font-normal text-text-3">Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onSort(v as SortKey, defaultDir(v as SortKey))}>
              {SORT_ORDER.map((k) => (
                <DropdownMenuRadioItem key={k} value={k} onSelect={(e) => e.preventDefault()}>
                  {SORT_LABELS[k]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-text-3">Order</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={dir} onValueChange={(v) => onSort(sort, v as SortDir)}>
              {(["asc", "desc"] as const).map((d) => (
                <DropdownMenuRadioItem key={d} value={d} onSelect={(e) => e.preventDefault()}>
                  {d === "asc" ? <ArrowUpNarrowWide aria-hidden /> : <ArrowDownWideNarrow aria-hidden />}
                  {DIR_LABELS[sort][d]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <p className="px-2 pt-2 pb-1 text-xs leading-snug text-text-3">Folders always stay on top.</p>
          </DropdownMenuContent>
        </DropdownMenu>

        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && onView(v as ViewMode)}
          aria-label="Layout"
          spacing={0}
          className="gap-0.5 rounded-lg border border-line-1 bg-surface-1 p-0.5"
        >
          <ViewItem value="list" label="List view">
            <List aria-hidden />
          </ViewItem>
          <ViewItem value="grid" label="Grid view">
            <LayoutGrid aria-hidden />
          </ViewItem>
        </ToggleGroup>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {filtering ? `${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} items shown` : ""}
      </span>
    </div>
  );
}

// Selection is a filled surface; the brand color is reserved for keyboard focus.
const segment =
  "h-10 rounded-md border-0 text-[13px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 sm:h-7 " +
  // Tooltip triggers overwrite data-state, so selection is styled from the radio's aria-checked.
  "aria-checked:bg-surface-3 aria-checked:text-text-1 aria-checked:hover:bg-surface-3 " +
  "focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand";

function FilterItem({ value, label, count, icon }: { value: string; label: string; count: number; icon: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem
          value={value}
          aria-label={`${label}, ${count.toLocaleString("en-US")}`}
          className={cn(segment, "group/seg min-w-0 flex-1 gap-1 px-1 sm:flex-none sm:gap-1.5 sm:px-2 xl:px-2.5")}
        >
          {icon}
          <span className="hidden xl:inline">{label}</span>
          <span className="text-text-3 tabular-nums group-aria-checked/seg:text-text-2">{count.toLocaleString("en-US")}</span>
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent className="xl:hidden">{label}</TooltipContent>
    </Tooltip>
  );
}

function ViewItem({ value, label, children }: { value: string; label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem value={value} aria-label={label} className={cn(segment, "w-10 px-0 sm:w-8")}>
          {children}
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
