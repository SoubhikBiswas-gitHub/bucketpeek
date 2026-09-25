import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const NAME_WIDTHS = ["w-40", "w-28", "w-56", "w-64", "w-48", "w-72", "w-52", "w-60", "w-44", "w-36", "w-56", "w-48", "w-40", "w-64"];

/** Mirrors the browse page: header row, toolbar row, then the list filling the rest of the screen. */
export default function BrowseLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <span className="sr-only" role="status">
        Loading folder
      </span>
      <div className="flex min-h-11 shrink-0 items-center gap-3 pb-3">
        <Skeleton className="h-4 w-40 bg-surface-2" />
        <Skeleton className="h-6 w-28 bg-surface-2" />
        <Skeleton className="hidden h-3.5 w-52 bg-surface-2 sm:block" />
        <div className="ml-auto flex gap-1">
          <Skeleton className="size-9 bg-surface-2 max-sm:size-11" />
          <Skeleton className="size-9 bg-surface-2 max-sm:size-11" />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-3 sm:flex-nowrap">
        <Skeleton className="h-11 min-w-28 flex-1 bg-surface-2 sm:h-9 xl:max-w-72" />
        <Skeleton className="order-last h-11 w-full bg-surface-2 sm:order-none sm:h-9 sm:w-80 xl:w-[36rem]" />
        <div className="flex gap-2 sm:ml-auto">
          <Skeleton className="size-11 bg-surface-2 sm:size-9 lg:w-24" />
          <Skeleton className="h-11 w-[86px] bg-surface-2 sm:h-9 sm:w-[70px]" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-line-1 bg-surface-1">
        <div className="hidden h-9 items-center border-b border-line-1 bg-surface-2 px-3 sm:flex">
          <Skeleton className="ml-[30px] h-3 w-12 bg-surface-3" />
        </div>
        {NAME_WIDTHS.map((w, i) => (
          <div key={i} className="flex h-15 items-center gap-3 border-b border-line-1 px-3 sm:h-11">
            <Skeleton className="size-[18px] shrink-0 rounded bg-surface-3" />
            <div className="min-w-0 flex-1">
              <Skeleton className={cn("h-3.5 max-w-full bg-surface-2", w)} />
              <Skeleton className="mt-2 h-3 w-24 bg-surface-2 sm:hidden" />
            </div>
            <Skeleton className="hidden h-3.5 w-12 bg-surface-2 sm:block" />
            <Skeleton className="hidden h-3.5 w-14 bg-surface-2 sm:block" />
            <Skeleton className="hidden h-3.5 w-24 bg-surface-2 md:block" />
            <div className="w-[4.75rem] shrink-0 max-sm:w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}
