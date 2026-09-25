"use client";

import { Fragment, useEffect } from "react";
import Link from "next/link";
import { Database, Folder, FolderOpen } from "lucide-react";
import { KindIcon } from "@/components/common/kind-icon";
import { FolderSiblings } from "@/components/common/folder-siblings";
import { useIsMac } from "@/components/shell/use-platform";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { browseHref, crumbsOf, normalizePrefix, parentOf } from "@/lib/paths";
import type { FileKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface PathBreadcrumbsProps {
  bucket: string;
  // "" for the bucket root.
  prefix: string;
  // Final non-link item, e.g. a file name. When absent, the last folder is the current page.
  current?: string;
  currentKind?: FileKind;
  asHeading?: boolean;
  trailing?: React.ReactNode;
  className?: string;
}

type ItemKind = "root" | "folder" | "file";

interface Item {
  name: string;
  // "" for root and for a file.
  prefix: string;
  kind: ItemKind;
}

// Desktop shows the root plus the last two levels once there are more than four; phones show root and last.
const DESKTOP_MAX = 4;

function range(from: number, to: number): number[] {
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export function openPathInput(prefix: string): void {
  window.dispatchEvent(new CustomEvent("lens:open-command", { detail: { query: prefix } }));
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

function Separator({ className }: { className?: string }) {
  return (
    <BreadcrumbSeparator className={cn("w-4 shrink-0 text-center text-[15px] font-light select-none", className)}>
      /
    </BreadcrumbSeparator>
  );
}

export function PathBreadcrumbs({ bucket, prefix, current, currentKind, asHeading = false, trailing, className }: PathBreadcrumbsProps) {
  const mac = useIsMac();
  const folderPrefix = normalizePrefix(prefix);

  // ⌘L / Ctrl+L: type a path. Native behaviour is kept inside text fields.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "l" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      openPathInput(folderPrefix);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [folderPrefix]);

  const items: Item[] = [
    { name: bucket, prefix: "", kind: "root" },
    ...crumbsOf(folderPrefix).map((c) => ({ name: c.name, prefix: c.prefix, kind: "folder" as const })),
  ];
  if (current) items.push({ name: current, prefix: "", kind: "file" });

  const n = items.length;
  const last = n - 1;
  const desktopHidden = new Set(n > DESKTOP_MAX ? range(1, n - 3) : []);
  const mobileHidden = range(1, n - 2);
  const mobileHiddenSet = new Set(mobileHidden);

  const icon = (item: Item, isPage: boolean) => {
    if (item.kind === "root") return <Database aria-hidden className={cn("shrink-0 text-text-3", isPage && asHeading ? "size-[18px]" : "size-3.5")} />;
    if (item.kind === "file") {
      return currentKind ? <KindIcon kind={currentKind} size={asHeading ? 18 : 14} /> : null;
    }
    if (isPage) {
      return <FolderOpen aria-hidden strokeWidth={1.75} className={cn("shrink-0 text-kind-folder", asHeading ? "size-[18px]" : "size-3.5")} />;
    }
    // Ancestor icons are dropped on phones to save room.
    return <Folder aria-hidden strokeWidth={1.75} className="hidden size-3.5 shrink-0 text-kind-folder sm:block" />;
  };

  const label = (item: Item, isPage: boolean) => (
    <span
      className={cn(
        "min-w-0 truncate",
        // On phones the bucket shrinks to its icon unless it is the page. not-sr-only resets
        // white-space and overflow, so truncation is re-applied after it.
        item.kind === "root" && !isPage && "sr-only sm:not-sr-only sm:truncate",
      )}
    >
      {item.name}
    </span>
  );

  const renderCrumb = (item: Item, i: number) => {
    const isPage = i === last;
    if (isPage) {
      const content = (
        <>
          {icon(item, true)}
          {label(item, true)}
        </>
      );
      // As the page heading the segment stays a real h1 (BreadcrumbPage is a span).
      if (asHeading) {
        return (
          <h1
            aria-current="page"
            title={item.name}
            className="flex min-h-9 min-w-0 items-center gap-2 text-lg leading-7 font-semibold tracking-tight text-text-1 sm:text-xl"
          >
            {content}
          </h1>
        );
      }
      // role and aria-disabled are cleared so the segment isn't announced as a disabled link.
      return (
        <BreadcrumbPage
          role={undefined}
          aria-disabled={undefined}
          title={item.name}
          className="flex min-h-8 min-w-0 items-center gap-2 pointer-coarse:min-h-11"
        >
          {content}
        </BreadcrumbPage>
      );
    }
    return (
      <BreadcrumbLink asChild>
        <Link
          href={browseHref(item.prefix)}
          title={item.name}
          className="flex min-h-8 min-w-0 items-center gap-1.5 px-0.5 text-text-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          {icon(item, false)}
          {label(item, false)}
        </Link>
      </BreadcrumbLink>
    );
  };

  const siblings = (item: Item, i: number) =>
    item.kind === "folder" ? (
      <FolderSiblings
        parent={parentOf(item.prefix)}
        currentPrefix={item.prefix}
        name={item.name}
        variant={i === last ? "chevron" : "separator"}
      />
    ) : null;

  // A folder ancestor's own trigger doubles as the "/" after it, so the next crumb skips its separator
  // on wide screens. On phones only the root, "…" and the last crumb show, so plain separators are used.
  const separatorClass = (i: number): string | null => {
    const prev = items[i - 1];
    const wide = !(i - 1 >= 1 && !desktopHidden.has(i - 1) && prev.kind === "folder");
    const phone = !mobileHiddenSet.has(i);
    if (wide && phone) return "";
    if (phone) return "sm:hidden";
    if (wide) return "hidden sm:list-item";
    return null;
  };

  // Ancestors keep their natural width up to a share of the bar (cqw: percent of the nav), so a very
  // long current name can't squeeze them to a letter; past that share they end in an ellipsis.
  const itemClass = (i: number) =>
    i === last
      ? cn("shrink", asHeading ? "min-w-24" : "min-w-16")
      : i === 0
        ? "shrink-0 max-w-[max(6rem,16cqw)]"
        : "shrink-0 max-w-[max(5rem,12cqw)]";

  return (
    <Breadcrumb
      aria-label="Folder path"
      className={cn("flex min-w-0 items-center gap-2 [container-type:inline-size]", asHeading ? "min-h-10" : "min-h-8", className)}
    >
      {/* min-w-24 keeps part of the path visible when trailing content competes; min-w-min would block truncation. */}
      <BreadcrumbList className="-m-1 min-w-24 shrink flex-nowrap gap-0.5 overflow-hidden p-1 whitespace-nowrap">
        <BreadcrumbItem className={cn("group/crumb flex gap-0.5", itemClass(0))}>{renderCrumb(items[0], 0)}</BreadcrumbItem>

        {mobileHidden.length > 0 && (
          <>
            <Separator className={cn(desktopHidden.size === 0 && "sm:hidden")} />
            <BreadcrumbItem className={cn("flex shrink-0", desktopHidden.size === 0 && "sm:hidden")}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-text-2"
                    aria-label={mobileHidden.length === 1 ? "Show 1 more folder" : `Show ${mobileHidden.length} more folders`}
                  >
                    <BreadcrumbEllipsis className="size-auto [&>svg]:size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={6} className="w-auto max-w-[min(22rem,calc(100vw-2rem))] min-w-48">
                  <DropdownMenuLabel>Parent folders</DropdownMenuLabel>
                  {mobileHidden.map((i) => (
                    <DropdownMenuItem key={items[i].prefix} asChild className={cn(!desktopHidden.has(i) && "sm:hidden")}>
                      <Link href={browseHref(items[i].prefix)} title={items[i].name}>
                        <Folder aria-hidden className="text-kind-folder!" />
                        <span className="min-w-0 truncate">{items[i].name}</span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
          </>
        )}

        {items.slice(1).map((item, j) => {
          const i = j + 1;
          if (desktopHidden.has(i)) return null;
          const phoneHidden = mobileHiddenSet.has(i) && "hidden sm:flex";
          return (
            <Fragment key={item.kind === "file" ? `file:${item.name}` : item.prefix}>
              {separatorClass(i) !== null && <Separator className={separatorClass(i) || undefined} />}
              <BreadcrumbItem className={cn("group/crumb flex gap-0.5", itemClass(i), phoneHidden)}>
                {renderCrumb(item, i)}
                {siblings(item, i)}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>

      {/* Empty space after the path: click to type a path. Keyboard users have ⌘L. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Type a path"
        aria-keyshortcuts={mac ? "Meta+L" : "Control+L"}
        onClick={() => openPathInput(folderPrefix)}
        className="group/type flex h-8 min-w-6 flex-1 cursor-text items-center justify-end overflow-hidden rounded-md px-2"
      >
        <span className="hidden items-center gap-2 text-xs whitespace-nowrap text-text-3 opacity-0 transition-opacity group-hover/type:opacity-100 md:flex">
          Type a path
          <KbdGroup>
            <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>L</Kbd>
          </KbdGroup>
        </span>
      </button>

      {trailing && <div className="flex shrink-0 items-center justify-end gap-1">{trailing}</div>}
    </Breadcrumb>
  );
}
