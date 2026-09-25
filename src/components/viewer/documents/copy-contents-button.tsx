"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copyText } from "@/components/viewer/copy-text";
import { cn } from "@/lib/utils";

export interface CopyContentsButtonProps {
  // A function is called on click, so large strings are only built when needed.
  text: string | (() => string);
  label?: string;
  // Shows the label next to the icon from the sm breakpoint up.
  showLabel?: boolean;
  size?: "sm" | "icon-sm" | "icon-xs";
  className?: string;
}

export function CopyContentsButton({
  text,
  label = "Copy contents",
  showLabel = false,
  size = "sm",
  className,
}: CopyContentsButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function onCopy() {
    const ok = await copyText(typeof text === "function" ? text() : text);
    if (!ok) {
      toast.error("Couldn't copy", { description: "Your browser blocked clipboard access. Select the text and copy it instead." });
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  const Icon = copied ? Check : Copy;
  const iconOnly = !showLabel || size !== "sm";

  const button = (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? (size === "sm" ? "icon-sm" : size) : "sm"}
      onClick={onCopy}
      aria-label={iconOnly ? label : undefined}
      className={cn(showLabel && size === "sm" && "max-sm:size-7 max-sm:px-0", className)}
    >
      <Icon aria-hidden data-icon="inline-start" strokeWidth={1.75} className={cn("size-4", copied && "text-brand")} />
      {!iconOnly && <span className="max-sm:sr-only">{copied ? "Copied" : label}</span>}
    </Button>
  );

  // Outside the button: while a modal hides the page, live regions stay exposed, and one inside
  // would become the button's only visible content and leave it without a name.
  const status = (
    <span aria-live="polite" className="sr-only">
      {copied ? "Copied to clipboard" : ""}
    </span>
  );

  if (!iconOnly)
    return (
      <>
        {button}
        {status}
      </>
    );
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
      </Tooltip>
      {status}
    </>
  );
}
