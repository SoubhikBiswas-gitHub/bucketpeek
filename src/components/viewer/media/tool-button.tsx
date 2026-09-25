"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ToolButtonProps extends Omit<ComponentProps<typeof Button>, "size" | "variant"> {
  label: string;
  shortcut?: string;
  children: ReactNode;
  // Compact text button instead of a square icon button.
  text?: boolean;
}

export function ToolButton({ label, shortcut, text, className, children, ...rest }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={text ? "sm" : "icon"}
          aria-label={label}
          className={cn(
            "text-text-2 aria-pressed:bg-surface-3 aria-pressed:text-text-1 [&_svg]:[stroke-width:1.75]",
            text && "h-8 px-2.5 tabular-nums",
            className,
          )}
          {...rest}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function ToolDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn("mx-1 h-5 w-px shrink-0 bg-line-1", className)} />;
}
