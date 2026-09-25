"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CommandDialog } from "@/components/ui/command";
import { browseHref, viewHref } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { blocksCommandChord, isMacPlatform, isTypingTarget, OPEN_COMMAND_EVENT, OPEN_SHORTCUTS_EVENT } from "./events";
import { Palette, pathQuery, type PaletteExit } from "./palette";
import { recordRecent } from "./recents";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { useLensLocation } from "./use-location";
import { useViewportStyle } from "./use-viewport";

export { openCommandMenu, openShortcutsDialog } from "./events";

function otherDialogOpen(): boolean {
  return document.querySelector(
    '[role="dialog"][data-state="open"]:not([data-lens-shortcuts]), [role="alertdialog"][data-state="open"]',
  ) !== null;
}

export function CommandMenu({ bucket }: { bucket: string }) {
  // useSearchParams needs a Suspense boundary; nothing renders until the menu opens anyway.
  return (
    <Suspense fallback={null}>
      <CommandMenuRoot bucket={bucket} />
    </Suspense>
  );
}

function CommandMenuRoot({ bucket }: { bucket: string }) {
  const router = useRouter();
  const location = useLensLocation();
  const viewport = useViewportStyle();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Each launch remounts the palette so a prefilled query (breadcrumb, ⌘L) starts fresh.
  const [launch, setLaunch] = useState({ id: 0, query: "" });
  const exitRef = useRef<PaletteExit | null>(null);
  const openRef = useRef(open);
  const shortcutsOpenRef = useRef(shortcutsOpen);
  const prefixRef = useRef(location.prefix);
  // Radix only restores focus to a DialogTrigger, and these dialogs open from shortcuts and events.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    openRef.current = open;
    shortcutsOpenRef.current = shortcutsOpen;
    prefixRef.current = location.prefix;
  }, [open, shortcutsOpen, location.prefix]);

  // Remember where the user has been (the bucket root is always one action away, so it's skipped).
  useEffect(() => {
    if (location.page === "view" && location.key) recordRecent(bucket, { type: "file", path: location.key });
    else if (location.page === "browse" && location.prefix) recordRecent(bucket, { type: "folder", path: location.prefix });
  }, [bucket, location.page, location.key, location.prefix]);

  useEffect(() => {
    const mac = isMacPlatform();

    const rememberFocus = () => {
      if (openRef.current || shortcutsOpenRef.current) return;
      const el = document.activeElement;
      returnFocusRef.current = el instanceof HTMLElement && el !== document.body ? el : null;
    };

    const openWith = (query: string) => {
      rememberFocus();
      setShortcutsOpen(false);
      setLaunch((l) => ({ id: l.id + 1, query }));
      setOpen(true);
    };

    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      // A dialog opened now would render behind the fullscreen video, image or PDF and take its keys.
      if (document.fullscreenElement) return;
      const target = e.target;
      const key = e.key.toLowerCase();
      const mod = !e.altKey && !e.shiftKey && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

      if (mod && (key === "k" || key === "l")) {
        if (!openRef.current && (blocksCommandChord(target) || otherDialogOpen())) return;
        e.preventDefault();
        if (e.repeat) return;
        if (key === "k" && openRef.current) setOpen(false);
        else if (key === "k") openWith("");
        else openWith(pathQuery(prefixRef.current));
        return;
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.defaultPrevented || openRef.current || isTypingTarget(target)) return;
        // Leave other dialogs (share, confirm…) in charge of their own keys.
        if (otherDialogOpen()) return;
        e.preventDefault();
        rememberFocus();
        setShortcutsOpen((v) => !v);
      }
    }

    const onOpenCommand = (e: Event) => {
      const query = e instanceof CustomEvent ? (e.detail as { query?: unknown } | null)?.query : undefined;
      if (typeof query === "string") openWith(query);
      else if (!openRef.current) openWith("");
    };
    const onOpenShortcuts = () => {
      if (openRef.current) {
        exitRef.current = { type: "shortcuts" };
        setOpen(false);
      } else {
        rememberFocus();
        setShortcutsOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpenCommand);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpenShortcuts);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpenCommand);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpenShortcuts);
    };
  }, []);

  const exit = useCallback(
    (next: PaletteExit) => {
      // Act right away (navigation shouldn't wait for the close animation); focus is settled on close.
      switch (next.type) {
        case "navigate": {
          const href = next.target.type === "folder" ? browseHref(next.target.path) : viewHref(next.target.path);
          if (next.newTab) window.open(href, "_blank", "noopener");
          else router.push(href);
          break;
        }
        case "href":
          router.push(next.href);
          break;
        case "copy":
          void copyText(next.text).then(
            () => toast.success("S3 path copied", { description: next.text }),
            () => toast.error("Couldn't copy the S3 path", { description: "Your browser blocked clipboard access." }),
          );
          break;
        case "shortcuts":
          break;
      }
      exitRef.current = next;
      setOpen(false);
    },
    [router],
  );

  const restoreFocus = useCallback(() => {
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, []);

  const onCloseAutoFocus = useCallback(
    (e: Event) => {
      e.preventDefault();
      const next = exitRef.current;
      exitRef.current = null;
      if (next?.type === "shortcuts") {
        setShortcutsOpen(true);
      } else if ((next?.type === "navigate" && !next.newTab) || next?.type === "href") {
        // The next page manages its own focus; jumping back to the old element would scroll the page.
        returnFocusRef.current = null;
      } else if (!shortcutsOpenRef.current) {
        restoreFocus();
      }
    },
    [restoreFocus],
  );

  const onShortcutsCloseAutoFocus = useCallback(
    (e: Event) => {
      e.preventDefault();
      // Closed because the palette opened: the palette owns focus now.
      if (!openRef.current) restoreFocus();
    },
    [restoreFocus],
  );

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command menu"
        description="Search the current folder, type a path such as Factory/ to look in another folder, or pick an action."
        onCloseAutoFocus={onCloseAutoFocus}
        style={viewport}
        className={cn(
          "flex flex-col gap-0 overflow-hidden bg-surface-2 p-0",
          // Phones: a near-full-width sheet sized to the visible viewport (keyboard and safe areas excluded).
          "max-sm:top-[calc(env(safe-area-inset-top)+0.5rem)] max-sm:max-w-[calc(100%-1rem-env(safe-area-inset-left)-env(safe-area-inset-right))] max-sm:translate-y-0",
          "max-sm:h-[calc(var(--lens-vvh,100dvh)-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]",
          "sm:top-[12vh] sm:max-h-[calc(var(--lens-vvh,100dvh)-12vh-1.5rem)] sm:max-w-[40rem] sm:translate-y-0",
        )}
      >
        <Palette key={launch.id} bucket={bucket} location={location} initialQuery={launch.query} onExit={exit} />
      </CommandDialog>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} onCloseAutoFocus={onShortcutsCloseAutoFocus} />
    </>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the legacy path (insecure origins, older Safari).
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand("copy");
  el.remove();
  if (!ok) throw new Error("copy failed");
}
