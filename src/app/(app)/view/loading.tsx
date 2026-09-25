import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

// Mirrors the viewer box for box (path heading, meta and actions, stage) so nothing jumps when the file arrives.
export default function ViewLoading() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3" role="status" aria-busy="true">
      <span className="sr-only">Loading file preview</span>

      <div className="flex shrink-0 flex-col gap-1" aria-hidden>
        <div className="flex min-h-10 items-center gap-2">
          <Skeleton className="h-3.5 w-32 max-sm:w-5" />
          <Skeleton className="h-3.5 w-16 max-sm:hidden" />
          <Skeleton className="h-5 w-[min(18rem,45%)]" />
          <div className="ml-auto flex items-center gap-1">
            <Skeleton className="size-8 rounded-lg max-sm:size-11" />
            <Skeleton className="hidden h-3.5 w-14 sm:block" />
            <Skeleton className="size-8 rounded-lg max-sm:size-11" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-48" />
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Skeleton className="h-8 w-40 rounded-lg max-sm:h-11 max-sm:w-20" />
            <Skeleton className="hidden h-8 w-66 rounded-lg sm:block max-lg:w-38" />
            <Skeleton className="size-11 rounded-lg sm:hidden" />
          </div>
        </div>
      </div>

      <div aria-hidden className="grid min-h-0 w-full flex-1 place-items-center rounded-xl border border-line-1 bg-surface-1">
        <Spinner className="size-5 text-text-3" />
      </div>
    </div>
  );
}
