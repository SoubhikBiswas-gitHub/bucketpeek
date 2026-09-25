"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RetryButtonProps {
  label?: string;
  // Defaults to re-fetching the current route.
  onRetry?: () => void;
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
}

export function RetryButton({ label = "Try again", onRetry, variant = "default", className }: RetryButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      aria-disabled={pending || undefined}
      onClick={() => {
        if (pending) return;
        startTransition(() => {
          if (onRetry) onRetry();
          else router.refresh();
        });
      }}
    >
      <RotateCw aria-hidden data-icon="inline-start" className={cn(pending && "animate-spin motion-reduce:animate-none")} />
      {pending ? "Retrying…" : label}
    </Button>
  );
}
