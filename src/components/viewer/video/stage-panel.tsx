import "./video-player.css";
import { cn } from "@/lib/utils";

// Fills the same box the player does, so switching between converting, playing and fallback never shifts the page.
export function StagePanel({
  className,
  tone = "stage",
  children,
  ...rest
}: React.ComponentProps<"div"> & { tone?: "stage" | "card" }) {
  return (
    <div
      className={cn(
        "relative grid h-full min-h-0 w-full [place-items:safe_center] overflow-y-auto overscroll-contain px-4 py-6 sm:px-10",
        tone === "stage" ? "bg-surface-0" : "bg-transparent",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
