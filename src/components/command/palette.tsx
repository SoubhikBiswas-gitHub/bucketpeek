"use client";

import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  Copy,
  CornerLeftUp,
  Database,
  FolderOpen,
  History,
  House,
  Keyboard,
  RotateCw,
  Search,
  SearchX,
  Settings2,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { KindIcon } from "@/components/common/kind-icon";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DialogClose } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes, plural } from "@/lib/format";
import { baseName, kindOf } from "@/lib/kinds";
import { folderOf, parentOf } from "@/lib/paths";
import type { FileEntry, FileKind, FolderEntry, Listing } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Keys, useIsMac, useIsNarrow } from "./keys";
import { compareNames, matchRanges, parseQuery, rank, scoreOf, type ParsedQuery } from "./match";
import { clearRecents, useRecents, type Recent } from "./recents";
import { useListing, type ListingError, type ListingState } from "./use-listing";
import { s3Uri, type LensLocation } from "./use-location";

export interface PaletteTarget {
  type: "folder" | "file";
  path: string;
}

export type PaletteExit =
  | { type: "navigate"; target: PaletteTarget; newTab: boolean }
  | { type: "href"; href: string }
  | { type: "copy"; text: string }
  | { type: "shortcuts" };

// Folder entries shown before "Show all" when nothing is typed.
const PREVIEW_COUNT = 8;
// Most results rendered at once; typing narrows the rest.
const RENDER_LIMIT = 100;

interface Entry {
  // cmdk value; unique across the menu.
  id: string;
  icon: FileKind | "folder" | LucideIcon;
  name: string;
  hint?: string;
  hintMono?: boolean;
  hintTone?: "brand";
  keys?: string[];
  keywords?: string[];
  // Query that Tab completes to.
  complete?: string;
  // Characters to highlight in the name.
  term?: string;
  run: (newTab: boolean) => void;
}

interface Section {
  id: string;
  heading?: ReactNode;
  // Non-selectable rows above the entries: loading, errors, notes.
  before?: ReactNode;
  entries: Entry[];
  after?: ReactNode;
  best: number;
}

export interface PaletteProps {
  bucket: string;
  location: LensLocation;
  initialQuery?: string;
  onExit: (exit: PaletteExit) => void;
}

export function Palette({ bucket, location, initialQuery = "", onExit }: PaletteProps) {
  const isMac = useIsMac();
  const isNarrow = useIsNarrow();
  const [query, setQuery] = useState(initialQuery);
  const [value, setValue] = useState("");
  const newTab = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A prefilled query should read like you typed it: caret at the end, ready for more.
  useEffect(() => {
    if (!initialQuery) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.scrollLeft = input.scrollWidth;
    });
    return () => cancelAnimationFrame(frame);
  }, [initialQuery]);
  const recents = useRecents(bucket);

  const deferredQuery = useDeferredValue(query);
  const parsed = useMemo(
    () => parseQuery(deferredQuery, { bucket, currentPrefix: location.prefix }),
    [deferredQuery, bucket, location.prefix],
  );

  const inFolderMode = parsed.mode === "default" || parsed.mode === "search";
  const folderListing = useListing(bucket, inFolderMode ? location.prefix : null);
  const pathListing = useListing(bucket, parsed.mode === "path" ? parsed.prefix : null, {
    // Typed paths are debounced; a prefilled one loads straight away.
    debounceMs: initialQuery && deferredQuery === initialQuery ? 0 : 150,
  });

  const sections = buildSections({
    bucket,
    location,
    parsed,
    recents,
    folderListing,
    pathListing,
    onExit,
    setQuery: (q) => {
      setQuery(q);
      setValue("");
    },
  });

  const entries = sections.flatMap((s) => s.entries);
  const active = entries.some((e) => e.id === value) ? value : (entries[0]?.id ?? "");
  const activeEntry = entries.find((e) => e.id === active);

  // cmdk 1.1.1 updates aria-activedescendant only when it moves the selection itself, so after the
  // controlled value changes it can name an item that was filtered out. Items set data-value first.
  useLayoutEffect(() => {
    const input = inputRef.current;
    const root = input?.closest("[cmdk-root]");
    if (!input || !root) return;
    const id = active ? root.querySelector(`[cmdk-item][data-value="${CSS.escape(active)}"]`)?.id : undefined;
    for (const el of [input, root.querySelector("[cmdk-list]")]) {
      if (id) el?.setAttribute("aria-activedescendant", id);
      else el?.removeAttribute("aria-activedescendant");
    }
  });

  const loading =
    (parsed.mode === "path" && pathListing.status === "loading") ||
    (inFolderMode && folderListing.status === "loading" && parsed.mode === "search");
  const busy =
    (parsed.mode === "path" && pathListing.status === "loading") || (inFolderMode && folderListing.status === "loading");
  const empty = entries.length === 0 && !sections.some((s) => s.before || s.after) && parsed.mode === "search";
  const status = liveStatus(parsed, entries.length, loading, parsed.mode === "path" ? pathListing : folderListing);

  function complete(): boolean {
    if (!activeEntry?.complete) return false;
    setQuery(activeEntry.complete);
    setValue("");
    return true;
  }

  return (
    <Command
      label="Command menu"
      shouldFilter={false}
      loop
      vimBindings={false}
      value={active}
      onValueChange={setValue}
      // The dialog already draws the surface and rounded corners.
      className="flex min-h-0 flex-1 flex-col rounded-none! bg-transparent"
      onKeyDownCapture={(e) => {
        if (e.key === "Enter") newTab.current = isMac ? e.metaKey : e.ctrlKey;
        // In the search field Tab completes the selected path (like a shell) and never leaves the
        // field; Shift+Tab still reaches the clear and close buttons.
        if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
          const inInput = e.target instanceof HTMLInputElement;
          if (complete() || inInput) e.preventDefault();
        }
      }}
      onClickCapture={(e) => {
        newTab.current = isMac ? e.metaKey : e.ctrlKey;
      }}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={(q) => {
          setQuery(q);
          setValue("");
        }}
        placeholder={isNarrow ? "Search or type a path" : "Search, or type a path like Factory/"}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        maxLength={1024}
        className="outline-none focus-visible:outline-none sm:text-[15px]"
        wrapperClassName="h-14 gap-3 border-line-1 pr-2 pl-4 sm:pr-4"
        icon={
          <span className="grid size-5 shrink-0 place-items-center text-text-3" aria-hidden>
            {loading ? <Spinner className="size-4 text-brand" aria-hidden role={undefined} /> : <Search className="size-4" strokeWidth={1.75} />}
          </span>
        }
      >
        {query && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setQuery("");
              setValue("");
              inputRef.current?.focus();
            }}
            className="size-11 shrink-0 text-text-3 hover:text-text-1 sm:size-7"
          >
            <XIcon aria-hidden className="size-4" />
            <span className="sr-only">Clear search</span>
          </Button>
        )}
        <Keys keys={["Esc"]} size="sm" className="hidden sm:inline-flex" />
        <DialogClose asChild>
          <Button variant="ghost" className="h-11 shrink-0 px-3 text-text-2 sm:hidden">
            Close
          </Button>
        </DialogClose>
      </CommandInput>

      {/* The only scroll region: fills the sheet on phones, a steady but shrinkable height from sm up. */}
      <CommandList
        // An empty listbox, or one holding only loading rows, isn't valid ARIA: it's hidden or busy then.
        hidden={empty}
        aria-busy={busy || undefined}
        className="max-h-none min-h-0 flex-1 px-2 pt-0 pb-2 sm:h-[26rem] sm:flex-[0_1_auto]"
      >
        {sections.map((section) =>
          section.entries.length || section.before || section.after ? (
            <CommandGroup
              key={section.id}
              heading={section.heading}
              className="overflow-visible not-first:mt-0 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pt-3"
            >
              {section.before}
              {section.entries.map((entry) => (
                <PaletteItem key={entry.id} entry={entry} onSelect={() => entry.run(newTab.current)} />
              ))}
              {section.after}
            </CommandGroup>
          ) : null,
        )}
      </CommandList>
      {empty && (
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-10 text-center text-sm text-text-1 sm:h-[26rem] sm:flex-[0_1_auto]">
          <EmptyResults term={parsed.term} prefix={location.prefix} />
        </div>
      )}

      <div className="sr-only" aria-live="polite" aria-atomic>
        {status}
      </div>

      <footer className="hidden h-11 shrink-0 items-center gap-4 border-t border-line-1 bg-surface-1 px-4 text-xs text-text-3 sm:flex">
        <FooterHint keys={["↑", "↓"]} label="Move" />
        <FooterHint keys={["↵"]} label="Open" />
        {activeEntry?.complete && <FooterHint keys={["Tab"]} label="Complete" />}
        <FooterHint keys={[isMac ? "⌘" : "Ctrl", "↵"]} label="New tab" />
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          <Database aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate font-mono text-[11px]" title={bucket}>
            {bucket}
          </span>
        </span>
      </footer>
    </Command>
  );
}

function FooterHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Keys keys={keys} size="sm" />
      <span aria-hidden>{label}</span>
    </span>
  );
}

function PaletteItem({ entry, onSelect }: { entry: Entry; onSelect: () => void }) {
  const Icon = typeof entry.icon === "string" ? null : entry.icon;
  return (
    <CommandItem
      value={entry.id}
      onSelect={onSelect}
      indicator={false}
      className={cn(
        // 44px rows on phones, 40px from sm up (touch tablets included).
        "min-h-11 gap-3 px-3 py-1.5 text-text-1 outline-none sm:min-h-10 sm:pointer-coarse:min-h-10",
        "before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand before:opacity-0",
        "data-[selected=true]:before:opacity-100",
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        {Icon ? (
          <Icon aria-hidden className="size-4 text-text-2 group-data-[selected=true]/command-item:text-text-1" strokeWidth={1.75} />
        ) : (
          <KindIcon kind={entry.icon as FileKind | "folder"} size={16} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate" title={entry.name}>
        <Highlight text={entry.name} term={entry.term} />
      </span>
      {entry.hint && (
        <span
          className={cn(
            "max-w-[42%] shrink-0 truncate text-right text-[13px] text-text-3 sm:max-w-[46%]",
            entry.hintMono && "font-mono text-xs",
            entry.hintTone === "brand" && "text-brand",
          )}
          title={entry.hint}
        >
          {entry.hint}
        </span>
      )}
      {entry.keys && <Keys keys={entry.keys} size="sm" />}
    </CommandItem>
  );
}

function Highlight({ text, term }: { text: string; term?: string }) {
  const ranges = term ? matchRanges(text, term) : [];
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={i} className="bg-transparent font-medium text-brand">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

interface BuildArgs {
  bucket: string;
  location: LensLocation;
  parsed: ParsedQuery;
  recents: readonly Recent[];
  folderListing: ListingState & { retry: () => void };
  pathListing: ListingState & { retry: () => void };
  onExit: (exit: PaletteExit) => void;
  setQuery: (q: string) => void;
}

export const pathQuery = (prefix: string) => prefix || "/";

function folderLabel(prefix: string, bucket: string): string {
  return prefix ? baseName(prefix.slice(0, -1)) : bucket;
}

function locationLabel(prefix: string, bucket: string): string {
  return prefix || `${bucket}/`;
}

function sortListing(listing: Listing): { folders: FolderEntry[]; files: FileEntry[] } {
  return {
    folders: [...listing.folders].sort((a, b) => compareNames(a.name, b.name)),
    files: [...listing.files].sort((a, b) => compareNames(a.name, b.name)),
  };
}

function buildSections(args: BuildArgs): Section[] {
  const { parsed } = args;
  switch (parsed.mode) {
    case "default":
      return [recentSection(args, ""), folderSection(args, ""), actionSection(args, "")];
    case "search": {
      const sections = [folderSection(args, parsed.term), recentSection(args, parsed.term), actionSection(args, parsed.term)];
      // Put the group holding the best match first, so Enter picks it.
      return sections.map((s, i) => ({ s, i })).sort((a, b) => b.s.best - a.s.best || a.i - b.i).map(({ s }) => s);
    }
    case "path":
      return [pathSection(args, parsed.prefix, parsed.term)];
    case "foreign":
      return [foreignSection(args, parsed.bucket)];
  }
}

function folderEntry(scope: string, folder: FolderEntry, term: string, args: BuildArgs, hint = "Folder"): Entry {
  return {
    id: `${scope}:d:${encodeURIComponent(folder.prefix)}`,
    icon: "folder",
    name: folder.name,
    hint,
    term,
    complete: folder.prefix,
    run: (newTab) => args.onExit({ type: "navigate", target: { type: "folder", path: folder.prefix }, newTab }),
  };
}

function fileEntry(scope: string, file: FileEntry, term: string, args: BuildArgs): Entry {
  const viewing = args.location.key === file.key;
  return {
    id: `${scope}:f:${encodeURIComponent(file.key)}`,
    icon: file.kind,
    name: file.name,
    hint: viewing ? "Viewing now" : formatBytes(file.size),
    hintTone: viewing ? "brand" : undefined,
    term,
    complete: file.key,
    run: (newTab) => args.onExit({ type: "navigate", target: { type: "file", path: file.key }, newTab }),
  };
}

function recentSection(args: BuildArgs, term: string): Section {
  const { recents, location, bucket } = args;
  const visible = recents.filter((r) =>
    r.type === "file" ? r.path !== location.key : !(location.page === "browse" && r.path === location.prefix),
  );
  const all: Entry[] = visible.map((r) => {
    const isFolder = r.type === "folder";
    const name = isFolder ? folderLabel(r.path, bucket) : baseName(r.path);
    const where = isFolder ? parentOf(r.path) : folderOf(r.path);
    return {
      id: `recent:${r.type}:${encodeURIComponent(r.path)}`,
      icon: isFolder ? "folder" : kindOf(r.path),
      name,
      hint: locationLabel(where, bucket),
      hintMono: true,
      keywords: [r.path],
      term,
      complete: r.path,
      run: (newTab) => args.onExit({ type: "navigate", target: { type: r.type, path: r.path }, newTab }),
    };
  });
  const entries = rank(all, term, (e) => e.name, (e) => e.keywords);
  return {
    id: "recent",
    heading: "Recent",
    entries,
    best: entries[0] ? scoreOf(entries[0].name, term, entries[0].keywords) : 0,
  };
}

function folderSection(args: BuildArgs, term: string): Section {
  const { location, bucket, folderListing: state } = args;
  const headingWith = (meta?: string) => <SectionHeading title={`In ${folderLabel(location.prefix, bucket)}`} meta={meta} />;
  const heading = headingWith();

  if (state.status === "loading" || state.status === "idle") {
    return { id: "folder", heading, before: <LoadingRows />, entries: [], best: 0 };
  }
  if (state.status === "error") {
    return errorSection("folder", heading, state.error, state.retry, args);
  }

  const { folders, files } = sortListing(state.listing);
  const all: Entry[] = [
    ...folders.map((f) => folderEntry("here", f, term, args)),
    ...files.map((f) => fileEntry("here", f, term, args)),
  ];

  if (!term) {
    const total = all.length;
    const entries = all.slice(0, PREVIEW_COUNT);
    if (total > PREVIEW_COUNT) {
      entries.push({
        id: "here:more",
        icon: FolderOpen,
        name: `Show all ${plural(total, "item")}`,
        hint: locationLabel(location.prefix, bucket),
        hintMono: true,
        run: () => args.setQuery(pathQuery(location.prefix)),
      });
    }
    return {
      id: "folder",
      heading: headingWith(plural(total, "item")),
      entries,
      before: total === 0 ? <Note>This folder is empty.</Note> : undefined,
      best: 0,
    };
  }

  const matches = rank(all, term, (e) => e.name);
  return {
    id: "folder",
    heading: headingWith(plural(matches.length, "match", "matches")),
    entries: matches.slice(0, RENDER_LIMIT),
    after: listingNotes(Math.min(matches.length, RENDER_LIMIT), matches.length, state.listing),
    best: matches[0] ? scoreOf(matches[0].name, term) : 0,
  };
}

function pathSection(args: BuildArgs, prefix: string, term: string): Section {
  const { bucket, pathListing: state } = args;
  const headingWith = (meta?: string) => <SectionHeading title={`In ${locationLabel(prefix, bucket)}`} mono meta={meta} />;
  const heading = headingWith();

  const openFolder: Entry = {
    id: `path:open:${encodeURIComponent(prefix)}`,
    icon: prefix ? FolderOpen : House,
    name: prefix ? `Open ${folderLabel(prefix, bucket)}` : "Go to bucket root",
    hint: locationLabel(prefix, bucket),
    hintMono: true,
    run: (newTab) => args.onExit({ type: "navigate", target: { type: "folder", path: prefix }, newTab }),
  };

  if (state.status === "loading" || state.status === "idle") {
    // "Open folder" is usable straight away, so Enter on a typed path never waits for the listing.
    return {
      id: "path",
      heading,
      entries: term ? [] : [openFolder],
      after: <LoadingRows />,
      best: 1,
    };
  }
  if (state.status === "error") return errorSection("path", heading, state.error, state.retry, args);

  const { folders, files } = sortListing(state.listing);
  const all: Entry[] = [
    ...folders.map((f) => folderEntry("path", f, term, args)),
    ...files.map((f) => fileEntry("path", f, term, args)),
  ];
  const total = all.length;
  const matches = rank(all, term, (e) => e.name);
  const shown = matches.slice(0, RENDER_LIMIT);

  let before: ReactNode;
  let after = listingNotes(shown.length, matches.length, state.listing);
  // Under "Open …", so the one useful action stays first.
  if (total === 0) after = <Note>No folders or files at {locationLabel(prefix, bucket)}</Note>;
  else if (matches.length === 0)
    before = (
      <Note>
        No matches for <q className="text-text-2">{term}</q> in {locationLabel(prefix, bucket)}
      </Note>
    );

  return {
    id: "path",
    heading: headingWith(term ? plural(matches.length, "match", "matches") : plural(total, "item")),
    before,
    entries: term ? shown : [openFolder, ...shown],
    after,
    best: 1,
  };
}

function foreignSection(args: BuildArgs, other: string): Section {
  return {
    id: "foreign",
    before: (
      <Note>
        That path is in <span className="font-mono text-text-2">{other}</span>. You&rsquo;re connected to{" "}
        <span className="font-mono text-text-2">{args.bucket}</span>.
      </Note>
    ),
    entries: [
      {
        id: "foreign:settings",
        icon: Settings2,
        name: "Connect a different bucket",
        hint: "Connection settings",
        run: () => args.onExit({ type: "href", href: "/setup" }),
      },
    ],
    best: 1,
  };
}

function errorSection(id: string, heading: ReactNode, error: ListingError, retry: () => void, args: BuildArgs): Section {
  const entry: Entry =
    error.kind === "auth"
      ? { id: `${id}:reconnect`, icon: Settings2, name: "Open connection settings", run: () => args.onExit({ type: "href", href: "/setup" }) }
      : { id: `${id}:retry`, icon: RotateCw, name: "Try again", run: () => retry() };
  return {
    id,
    heading,
    before: (
      <div role="alert" className="mx-1 mt-0.5 mb-1.5 flex gap-3 rounded-md border border-danger-line bg-danger-mist px-3 py-2.5">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0">
          <p className="font-medium text-text-1">{error.title}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-text-2">{error.message}</p>
        </div>
      </div>
    ),
    entries: [entry],
    best: 0,
  };
}

function actionSection(args: BuildArgs, term: string): Section {
  const { bucket, location, recents } = args;
  const go = (href: string) => () => args.onExit({ type: "href", href });
  const nav = (path: string) => (newTab: boolean) =>
    args.onExit({ type: "navigate", target: { type: "folder", path }, newTab });

  const all: Entry[] = [];
  // Where "up" leads: the file's folder in the viewer, the parent folder when browsing.
  const up =
    location.page === "view" && location.key
      ? { id: "action:folder", name: "Back to folder", path: location.prefix, keywords: ["up", "parent", "folder", "escape"] }
      : location.page === "browse" && location.prefix
        ? { id: "action:up", name: "Go up one folder", path: parentOf(location.prefix), keywords: ["parent", "back", ".."] }
        : null;
  if (up) {
    all.push({
      id: up.id,
      icon: CornerLeftUp,
      name: up.name,
      hint: locationLabel(up.path, bucket),
      hintMono: true,
      keywords: up.keywords,
      run: nav(up.path),
    });
  }
  const atRoot = location.page === "browse" && location.prefix === "";
  // Skip "root" when it's where you already are, or where "up" goes.
  if (!atRoot && up?.path !== "") {
    all.push({
      id: "action:root",
      icon: House,
      name: "Go to bucket root",
      hint: `${bucket}/`,
      hintMono: true,
      keywords: ["home", "top", "root", bucket],
      run: nav(""),
    });
  }

  const uri = s3Uri(bucket, location.key ?? location.prefix);
  all.push(
    {
      id: "action:copy",
      icon: Copy,
      name: location.key ? "Copy S3 path of this file" : "Copy S3 path of this folder",
      hint: uri,
      hintMono: true,
      keywords: ["s3", "uri", "path", "link", "clipboard", "copy"],
      run: () => args.onExit({ type: "copy", text: uri }),
    },
    {
      id: "action:settings",
      icon: Settings2,
      name: "Connection settings",
      keywords: ["connection", "credentials", "bucket", "region", "disconnect", "setup", "aws"],
      run: go("/setup"),
    },
    {
      id: "action:shortcuts",
      icon: Keyboard,
      name: "Keyboard shortcuts",
      keys: ["?"],
      keywords: ["keyboard", "help", "keys", "hotkeys"],
      run: () => args.onExit({ type: "shortcuts" }),
    },
  );
  if (recents.length) {
    all.push({
      id: "action:clear-recents",
      icon: History,
      name: "Clear recent locations",
      keywords: ["history", "recent", "clear", "forget"],
      run: () => clearRecents(bucket),
    });
  }

  const entries = rank(all, term, (e) => e.name, (e) => e.keywords).map((e) => ({ ...e, term }));
  return {
    id: "actions",
    heading: "Actions",
    entries,
    best: entries[0] ? scoreOf(entries[0].name, term, entries[0].keywords) : 0,
  };
}

function SectionHeading({ title, meta, mono }: { title: string; meta?: string; mono?: boolean }) {
  return (
    <span className="flex min-w-0 items-baseline justify-between gap-3">
      <span className={cn("truncate", mono && "font-mono")} title={title}>
        {title}
      </span>
      {meta && <span className="shrink-0 font-normal tabular-nums">{meta}</span>}
    </span>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2.5 text-[13px] break-words text-text-3">{children}</p>;
}

function listingNotes(shown: number, total: number, listing: Listing): ReactNode {
  const capped = shown < total;
  if (total === 0 || (!capped && !listing.truncated)) return undefined;
  const loaded = listing.folders.length + listing.files.length;
  return (
    <p className="px-3 pt-2 pb-1 text-xs text-text-3">
      {capped && `Showing ${shown.toLocaleString("en-US")} of ${plural(total, "match", "matches")}. Keep typing to narrow the list. `}
      {listing.truncated && `This folder is large, so only its first ${plural(loaded, "item")} are searched.`}
    </p>
  );
}

// Not cmdk's Loading: its progressbar isn't allowed inside a listbox. The list is aria-busy instead.
function LoadingRows() {
  return (
    <div aria-hidden className="space-y-0.5">
      {[62, 44, 54].map((w) => (
        <div key={w} className="flex min-h-11 items-center gap-3 px-3 sm:min-h-10">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-3 rounded" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

function EmptyResults({ term, prefix }: { term: string; prefix: string }) {
  return (
    <>
      <SearchX aria-hidden className="size-6 text-text-3" strokeWidth={1.75} />
      <p className="mt-3 font-medium break-all text-text-1">No matches for &ldquo;{term}&rdquo;</p>
      <p className="mt-1 max-w-sm text-[13px] text-text-3">
        Search covers {prefix ? <span className="font-mono text-text-2">{prefix}</span> : "the bucket root"} and recent
        locations. To look somewhere else, type a path, such as <span className="font-mono text-text-2">/</span> for the
        bucket root.
      </p>
    </>
  );
}

function liveStatus(parsed: ParsedQuery, count: number, loading: boolean, state: ListingState): string {
  if (parsed.mode === "default") return "";
  if (loading) return "Loading";
  if (state.status === "error") return state.error.title;
  if (count === 0) return "No matches";
  return plural(count, "result");
}
