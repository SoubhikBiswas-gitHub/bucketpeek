"use client";

import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Keys, useIsMac } from "./keys";
import { useViewportStyle } from "./use-viewport";

interface Shortcut {
  label: string;
  // Alternative combinations, each a list of keys pressed together.
  combos: readonly (readonly string[])[];
}

interface Section {
  title: string;
  shortcuts: readonly Shortcut[];
}

function sections(mod: string): Section[] {
  return [
    {
      title: "General",
      shortcuts: [
        { label: "Open the command menu", combos: [[mod, "K"]] },
        { label: "Go to a path", combos: [[mod, "L"]] },
        { label: "Show keyboard shortcuts", combos: [["?"]] },
        { label: "Search this folder", combos: [["/"]] },
        { label: "Close a dialog or menu", combos: [["Esc"]] },
      ],
    },
    {
      title: "Lists and command menu",
      shortcuts: [
        { label: "Move the selection", combos: [["↑", "↓"]] },
        { label: "Open the selected item", combos: [["↵"]] },
        { label: "Open in a new tab", combos: [[mod, "↵"]] },
        { label: "Complete a folder path", combos: [["Tab"]] },
      ],
    },
    {
      title: "File viewer",
      shortcuts: [
        { label: "Previous file", combos: [["←"]] },
        { label: "Next file", combos: [["→"]] },
        { label: "Back to the folder", combos: [["Esc"]] },
      ],
    },
    {
      title: "Video player",
      shortcuts: [
        { label: "Play or pause", combos: [["Space"]] },
        { label: "Skip back", combos: [["J"]] },
        { label: "Skip forward", combos: [["L"]] },
        { label: "Full screen", combos: [["F"]] },
        { label: "Mute or unmute", combos: [["M"]] },
      ],
    },
  ];
}

export interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function ShortcutsDialog({ open, onOpenChange, onCloseAutoFocus }: ShortcutsDialogProps) {
  const isMac = useIsMac();
  const viewport = useViewportStyle();
  const list = sections(isMac ? "⌘" : "Ctrl");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-lens-shortcuts=""
        showCloseButton={false}
        aria-describedby="lens-shortcuts-description"
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={(e) => {
          // Focus the dialog itself rather than lighting up the close button on open.
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        style={viewport}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          "max-h-[calc(var(--lens-vvh,100dvh)-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]",
          "max-sm:top-[calc(env(safe-area-inset-top)+0.5rem)] max-sm:max-w-[calc(100%-1rem-env(safe-area-inset-left)-env(safe-area-inset-right))] max-sm:translate-y-0",
          "sm:max-h-[min(40rem,calc(var(--lens-vvh,100dvh)-4rem))] sm:max-w-[44rem]",
        )}
      >
        <header className="flex items-start gap-4 border-b border-line-1 px-5 pt-4 pb-3.5 sm:px-6">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[15px]">Keyboard shortcuts</DialogTitle>
            <DialogDescription id="lens-shortcuts-description" className="mt-0.5 text-[13px] text-text-3">
              Single-key shortcuts are paused while you type in a field.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="-mr-2 size-11 text-text-2 sm:-mt-0.5 sm:size-8">
              <XIcon aria-hidden className="size-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </header>

        <div
          tabIndex={0}
          role="region"
          aria-label="Shortcut list"
          className="grid min-h-0 flex-1 focus-visible:outline-offset-[-2px] gap-x-8 gap-y-6 overflow-y-auto overscroll-contain px-5 pt-4 pb-6 sm:grid-cols-2 sm:px-6">
          {list.map((section) => (
            <section key={section.title} aria-labelledby={`shortcuts-${section.title}`}>
              <h3 id={`shortcuts-${section.title}`} className="mb-1.5 text-[13px] font-medium text-text-3">
                {section.title}
              </h3>
              <dl className="divide-y divide-line-1">
                {section.shortcuts.map((s) => (
                  <div key={s.label} className="flex min-h-10 items-center justify-between gap-4 py-1.5">
                    <dt className="min-w-0 text-text-1">{s.label}</dt>
                    <dd className="flex shrink-0 items-center gap-1.5">
                      {s.combos.map((combo, i) => (
                        <span key={combo.join("+")} className="inline-flex items-center gap-1.5">
                          {i > 0 && (
                            <span className="text-xs text-text-3">or</span>
                          )}
                          <Keys keys={combo} />
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
