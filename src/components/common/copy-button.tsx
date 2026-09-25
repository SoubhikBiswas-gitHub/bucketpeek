"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface CopyButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "value" | "onClick" | "children" | "asChild"> {
  value: string;
  // Accessible name and tooltip, e.g. "Copy link".
  label: string;
  // Toast after copying, e.g. "Link copied". Without it the icon confirms inline.
  toastMessage?: string;
  showLabel?: boolean;
}

// Falls back to execCommand when the async API is missing (plain http) or rejects (permission
// policy, embedded frames).
async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path.
    }
  }
  legacyCopy(text);
}

function legacyCopy(text: string): void {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.appendChild(area);
  const previous = document.activeElement as HTMLElement | null;
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy command was rejected");
  } finally {
    area.remove();
    previous?.focus({ preventScroll: true });
  }
}

export function CopyButton({
  value,
  label,
  toastMessage,
  showLabel = false,
  variant = "ghost",
  size,
  className,
  disabled,
  ...rest
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await writeClipboard(value);
    } catch {
      toast.error("Couldn’t copy", { description: "Your browser blocked clipboard access. Select the text and copy it manually." });
      return;
    }
    setCopied(true);
    if (toastMessage) toast.success(toastMessage);
    else setAnnouncement("Copied");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setAnnouncement("");
    }, 1500);
  }

  const Icon = copied ? Check : Copy;
  const icon = (
    <Icon
      aria-hidden
      data-icon={showLabel ? "inline-start" : undefined}
      className={cn("transition-colors", copied && "text-brand")}
    />
  );

  const button = (
    <Button
      type="button"
      variant={variant}
      size={size ?? (showLabel ? "sm" : "icon-sm")}
      className={className}
      disabled={disabled || !value}
      aria-label={showLabel ? undefined : label}
      onClick={copy}
      {...rest}
    >
      {icon}
      {showLabel && <span>{copied ? "Copied" : label}</span>}
    </Button>
  );

  return (
    <>
      {showLabel ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
        </Tooltip>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
