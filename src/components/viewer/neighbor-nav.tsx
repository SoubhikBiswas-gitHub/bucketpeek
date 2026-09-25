"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { KindIcon } from "@/components/common/kind-icon";
import { Pill } from "@/components/common/pill";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { browseHref, viewHref } from "@/lib/paths";
import type { Neighbor } from "@/lib/types";

export interface NeighborNavProps {
  folder: string;
  prev: Neighbor | null;
  next: Neighbor | null;
  // 1-based.
  position: { index: number; total: number } | null;
}

// Elements that own the arrow and Escape keys while focused.
const KEY_OWNERS = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "video",
  "audio",
  "iframe",
  "media-player",
  "[data-media-player]",
  "[data-media-provider]",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='grid']",
  "[role='treegrid']",
  "[role='tree']",
  "[role='listbox']",
  "[role='menu']",
  "[role='menubar']",
  "[role='tablist']",
  "[role='radiogroup']",
  "[role='toolbar']",
  "[role='application']",
  "[data-viewer-keys='off']",
].join(",");

// Any open dialog, sheet, popover, menu or palette; tooltips don't count.
const OPEN_LAYER =
  "[role='dialog'],[role='alertdialog'],[data-radix-popper-content-wrapper]:not(:has([role='tooltip']))";

// A sideways-scrollable element inside the stage keeps ←/→ for scrolling.
function scrollsHorizontally(target: Element): boolean {
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const { overflowX } = getComputedStyle(el);
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    if (el.matches("[data-slot='preview-stage']")) break;
  }
  return false;
}

function keyIsOwnedElsewhere(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.repeat) return true;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
  if (document.fullscreenElement) return true;
  if (document.querySelector(OPEN_LAYER)) return true;
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return false;
  if (target.closest(KEY_OWNERS)) return true;
  if (e.key !== "Escape" && target.closest("[data-slot='preview-stage']") && scrollsHorizontally(target)) return true;
  return false;
}

export function NeighborNav({ folder, prev, next, position }: NeighborNavProps) {
  const router = useRouter();
  const folderHref = browseHref(folder);
  const prevHref = prev ? viewHref(prev.key) : null;
  const nextHref = next ? viewHref(next.key) : null;

  // Keyboard navigation doesn't go through <Link>, so warm those routes explicitly.
  useEffect(() => {
    if (prevHref) router.prefetch(prevHref);
    if (nextHref) router.prefetch(nextHref);
  }, [router, prevHref, nextHref]);

  // Read the latest hrefs from a ref so the listener is attached once per mount.
  const targets = useRef({ prevHref, nextHref, folderHref });
  useEffect(() => {
    targets.current = { prevHref, nextHref, folderHref };
  }, [prevHref, nextHref, folderHref]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Escape") return;
      if (keyIsOwnedElsewhere(e)) return;
      const { prevHref: p, nextHref: n, folderHref: f } = targets.current;
      const href = e.key === "ArrowLeft" ? p : e.key === "ArrowRight" ? n : f;
      if (!href) return;
      e.preventDefault();
      router.push(href);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <nav aria-label="Files in this folder" className="flex shrink-0 items-center gap-1">
      <NeighborLink direction="prev" neighbor={prev} />
      {position && position.total > 0 && (
        <Pill className="mx-0.5 max-sm:hidden">
          <span className="sr-only">File </span>
          {position.index.toLocaleString("en-US")} of {position.total.toLocaleString("en-US")}
        </Pill>
      )}
      <NeighborLink direction="next" neighbor={next} />
    </nav>
  );
}

function NeighborLink({ direction, neighbor }: { direction: "prev" | "next"; neighbor: Neighbor | null }) {
  const isPrev = direction === "prev";
  const Chevron = isPrev ? ChevronLeft : ChevronRight;
  const word = isPrev ? "Previous" : "Next";
  const shortcut = isPrev ? "ArrowLeft" : "ArrowRight";
  const glyph = isPrev ? "←" : "→";
  const base = "size-8 text-text-2 hover:text-text-1 max-sm:size-11";

  if (!neighbor) {
    return (
      <Button variant="ghost" disabled className={base} aria-label={`No ${word.toLowerCase()} file`}>
        <Chevron aria-hidden />
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" className={base}>
          <Link
            href={viewHref(neighbor.key)}
            aria-label={`${word} file: ${neighbor.name}`}
            aria-keyshortcuts={shortcut}
            data-direction={direction}
          >
            <Chevron aria-hidden className="size-4" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[min(24rem,calc(100vw-2rem))]">
        <span className="shrink-0 text-text-2">{word}</span>
        <KindIcon kind={neighbor.kind} size={14} className="shrink-0" />
        <FileName name={neighbor.name} />
        <Kbd aria-hidden className="shrink-0">
          {glyph}
        </Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

// A long name truncates before its extension, so ".mp4" stays visible.
function FileName({ name }: { name: string }) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  return (
    <span dir="auto" className="flex min-w-0" title={name}>
      <span className="truncate">{ext ? name.slice(0, dot) : name}</span>
      {ext && <span className="shrink-0">{ext}</span>}
    </span>
  );
}
