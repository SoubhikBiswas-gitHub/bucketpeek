import { Info } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export interface PlayerNoteProps {
  icon: "info" | "busy";
  text: string;
  action?: { label: string; onClick: () => void };
}

// Pinned over the top of the picture, so it never changes the layout.
export function PlayerNote({ icon, text, action }: PlayerNoteProps) {
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex sm:inset-x-3 sm:top-3">
      <Alert
        role="status"
        className="pointer-events-auto flex w-auto max-w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-white/10 bg-black/75 py-1.5 pr-1.5 pl-2.5 text-xs backdrop-blur-sm"
      >
        <span className="flex min-w-0 items-center gap-2 py-0.5 pr-1">
          {icon === "busy" ? (
            // 14px with -1px margins fills a 12px slot; the stroke width draws a 1.5px arc.
            <Spinner aria-hidden strokeWidth={2.57} className="-m-px size-3.5 shrink-0 text-brand motion-reduce:animate-none" />
          ) : (
            <Info aria-hidden className="size-3.5 shrink-0 text-text-2" />
          )}
          <span className="min-w-0">{text}</span>
        </span>
        {action && (
          <Button type="button" size="xs" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </Alert>
    </div>
  );
}
