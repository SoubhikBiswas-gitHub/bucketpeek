"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Folder, RotateCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { browseHref } from "@/lib/paths";
import type { FolderEntry, Listing } from "@/lib/types";
import { cn } from "@/lib/utils";

const LIMIT = 200;
const FRESH_MS = 60_000;

interface Cached {
  folders: FolderEntry[];
  truncated: boolean;
  at: number;
}

// Folder lists per parent prefix, shared by every breadcrumb on the page.
const cache = new Map<string, Cached>();

type State =
  | { status: "idle" | "loading" }
  | { status: "ok"; folders: FolderEntry[]; truncated: boolean }
  | { status: "error"; message: string; signedOut: boolean };

class ListError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchFolders(prefix: string, signal: AbortSignal): Promise<Cached> {
  const res = await fetch(`/api/list?prefix=${encodeURIComponent(prefix)}&limit=${LIMIT}`, { signal, cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new ListError(message || "The folder list didn’t load.", res.status);
  }
  const listing = body as Listing;
  return { folders: listing.folders ?? [], truncated: Boolean(listing.truncated), at: Date.now() };
}

export interface FolderSiblingsProps {
  // Prefix whose child folders are listed, e.g. "Factory/" for siblings of "Factory/annotated/".
  parent: string;
  currentPrefix: string;
  name: string;
  // "separator" replaces the "/" after an ancestor, showing the slash until the crumb is hovered or
  // focused (always a chevron on touch screens), so it takes no extra room.
  variant?: "chevron" | "separator";
}

export function FolderSiblings({ parent, currentPrefix, name, variant = "chevron" }: FolderSiblingsProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  function load(force = false) {
    const hit = cache.get(parent);
    if (hit && !force && Date.now() - hit.at < FRESH_MS) {
      setState({ status: "ok", folders: hit.folders, truncated: hit.truncated });
      return;
    }
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    // Show a stale list instantly while refreshing it.
    setState(hit ? { status: "ok", folders: hit.folders, truncated: hit.truncated } : { status: "loading" });
    fetchFolders(parent, ctrl.signal)
      .then((value) => {
        cache.set(parent, value);
        if (!ctrl.signal.aborted) setState({ status: "ok", folders: value.folders, truncated: value.truncated });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        const status = e instanceof ListError ? e.status : 0;
        const message =
          e instanceof ListError ? e.message : "Couldn’t reach the server. Check your internet connection and try again.";
        setState({ status: "error", message, signedOut: status === 401 });
      });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) load();
    else controller.current?.abort();
  }

  const others = state.status === "ok" ? state.folders.filter((f) => f.prefix !== currentPrefix) : [];

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Folders next to ${name}`}
          className={cn(
            "group/sib h-5 rounded-sm text-text-3 hover:text-text-1 aria-expanded:bg-surface-3 aria-expanded:text-text-1 pointer-coarse:h-7",
            variant === "separator" ? "w-4 pointer-coarse:w-6" : "w-5 pointer-coarse:w-7",
          )}
        >
          {variant === "separator" && (
            <span
              aria-hidden
              className="text-[15px] leading-none font-light group-hover/crumb:hidden group-focus-visible/sib:hidden group-aria-expanded/sib:hidden pointer-coarse:hidden"
            >
              /
            </span>
          )}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5!",
              variant === "separator" &&
                "hidden group-hover/crumb:block group-focus-visible/sib:block group-aria-expanded/sib:block pointer-coarse:block",
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-auto max-w-[min(22rem,calc(100vw-2rem))] min-w-56">
        <DropdownMenuLabel>Folders here</DropdownMenuLabel>

        {(state.status === "idle" || state.status === "loading") && (
          <div role="status" className="flex items-center gap-2 px-2 py-2.5 text-sm text-text-2">
            <Spinner aria-hidden className="text-text-3" />
            Loading folders…
          </div>
        )}

        {state.status === "error" && (
          // Plain text inside the menu: the destructive Alert without its box.
          <>
            <Alert
              variant="destructive"
              className="block max-w-72 rounded-none border-0 bg-transparent px-2 pt-1 pb-2 leading-snug"
            >
              {state.message}
            </Alert>
            <DropdownMenuSeparator />
            {state.signedOut ? (
              <DropdownMenuItem asChild>
                <Link href="/setup">Connect again</Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  load(true);
                }}
              >
                <RotateCw aria-hidden />
                Try again
              </DropdownMenuItem>
            )}
          </>
        )}

        {state.status === "ok" && others.length === 0 && (
          <p className="px-2 py-2.5 text-sm text-text-2">No other folders</p>
        )}

        {state.status === "ok" && others.length > 0 && (
          <div className="-mx-1 max-h-[min(18rem,50vh)] overflow-y-auto px-1">
            {state.folders.map((f) => {
              const isCurrent = f.prefix === currentPrefix;
              return (
                <DropdownMenuItem key={f.prefix} asChild className={cn(isCurrent && "text-text-1")}>
                  <Link href={browseHref(f.prefix)} title={f.name} aria-current={isCurrent ? "page" : undefined}>
                    <Folder aria-hidden className="text-kind-folder!" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {isCurrent && <Check aria-hidden className="text-brand!" />}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </div>
        )}

        {state.status === "ok" && state.truncated && (
          <p className="border-t border-line-2 px-2 pt-2 pb-1 text-xs text-text-3">
            Showing the first {LIMIT} items. Search to find others.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
