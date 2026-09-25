"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { openCommandMenu, useIsMac } from "./use-platform";

const LABEL = "Search files and folders";

export function SearchTrigger() {
  const mac = useIsMac();
  const mod = mac ? "⌘" : "Ctrl";
  const shortcut = mac ? "Meta+K" : "Control+K";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={openCommandMenu}
        aria-label={LABEL}
        aria-keyshortcuts={shortcut}
        aria-haspopup="dialog"
        className={cn(
          // Reads as a search field: left-aligned muted text, quieter surface than an outline button.
          "hidden h-8 w-56 shrink justify-start gap-2 bg-surface-1 bg-clip-border pr-1.5 pl-2.5 text-left font-normal text-text-3 md:flex lg:w-72",
          "transition-[background-color,border-color,color] hover:bg-surface-2 hover:text-text-2",
          // Keep the tap area the size of the field; Button otherwise grows it to 44px on touch screens.
          "pointer-coarse:after:hidden",
        )}
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          Search<span className="hidden lg:inline"> files and folders</span>
        </span>
        <KbdGroup aria-hidden>
          <Kbd className={cn(!mac && "px-1.5")}>{mod}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            className="md:hidden"
            aria-label={LABEL}
            aria-keyshortcuts={shortcut}
            aria-haspopup="dialog"
            onClick={openCommandMenu}
          >
            <Search aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{LABEL}</TooltipContent>
      </Tooltip>
    </>
  );
}
