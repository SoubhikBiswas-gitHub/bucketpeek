"use client";

import { useSyncExternalStore } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { isMacPlatform } from "./events";

const noop = () => () => {};

const subscribeNarrow = (onChange: () => void) => {
  const mq = window.matchMedia("(max-width: 639.98px)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia("(max-width: 639.98px)").matches, () => false);
}

export function useIsMac(): boolean {
  return useSyncExternalStore(noop, isMacPlatform, () => false);
}

const SPOKEN: Record<string, string> = {
  "⌘": "Command",
  "⌥": "Option",
  "⇧": "Shift",
  "↵": "Enter",
  "↑": "Up arrow",
  "↓": "Down arrow",
  "←": "Left arrow",
  "→": "Right arrow",
  Esc: "Escape",
};

export interface KeysProps {
  keys: readonly string[];
  className?: string;
  size?: "sm" | "md";
}

export function Keys({ keys, className, size = "md" }: KeysProps) {
  const spoken = keys.map((k) => SPOKEN[k] ?? k).join(" ");
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      <span className="sr-only">{spoken}</span>
      {keys.map((k, i) => (
        <Kbd
          key={`${k}-${i}`}
          aria-hidden
          className={cn(
            "font-sans text-text-2",
            size === "sm" ? "h-[18px] min-w-[18px] px-1 text-[11px]" : "h-6 min-w-6 px-1.5 text-xs",
            /^[⌘⌥⇧↵↑↓←→]$/.test(k) && (size === "sm" ? "text-xs" : "text-[13px]"),
          )}
        >
          {k}
        </Kbd>
      ))}
    </span>
  );
}
