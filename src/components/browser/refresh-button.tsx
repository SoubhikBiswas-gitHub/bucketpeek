"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={pending ? "Refreshing" : "Refresh"}
          aria-disabled={pending || undefined}
          onClick={() => {
            if (!pending) startTransition(() => router.refresh());
          }}
          className="size-9 text-text-2 hover:text-text-1 max-sm:size-11"
        >
          <RotateCw aria-hidden className={cn(pending && "animate-spin motion-reduce:animate-none")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{pending ? "Refreshing" : "Refresh"}</TooltipContent>
    </Tooltip>
  );
}
