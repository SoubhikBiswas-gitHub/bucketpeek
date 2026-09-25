import Image from "next/image";
import Link from "next/link";
import { CommandMenu } from "@/components/command/command-menu";
import { BRAND } from "@/lib/brand";
import type { ConnectionInfo } from "@/lib/types";
import { BucketChip } from "./bucket-chip";
import { SearchTrigger } from "./search-trigger";
import { TopBarActions } from "./top-bar-actions";

export interface TopBarProps {
  connection: ConnectionInfo;
  // Mock mode: the data comes from the local sample folder, not AWS.
  demo?: boolean;
}

export function TopBar({ connection, demo = false }: TopBarProps) {
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-surface-3 text-sm font-medium text-text-1 shadow-lg shadow-black/40 ring-1 ring-line-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:z-60 focus:px-3.5 focus:py-2"
      >
        Skip to content
      </a>
      <header className="relative z-40 shrink-0 border-b border-line-1 bg-surface-0 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-12 max-w-(--page-width) items-center gap-2 pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:h-(--topbar-height) sm:gap-3 sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))]">
          <Link
            href="/browse"
            aria-label={`${BRAND.name}, go to bucket root`}
            className="relative -ml-1 flex h-9 shrink-0 items-center gap-2.5 rounded-md px-1 text-[15px] font-semibold tracking-tight text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            <Image src="/brand-mark.svg" alt="" width={26} height={26} priority className="size-[26px]" />
            <span className="hidden sm:inline">{BRAND.name}</span>
          </Link>

          <svg aria-hidden viewBox="0 0 16 24" className="hidden h-6 w-3 shrink-0 text-line-3 sm:block">
            <path d="M11 3 5 21" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>

          <div className="flex min-w-0 flex-1 items-center">
            <BucketChip connection={connection} demo={demo} />
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <SearchTrigger />
            <span aria-hidden className="mx-1 hidden h-5 w-px bg-line-2 sm:block" />
            <TopBarActions bucket={connection.bucket} />
          </div>
        </div>
      </header>
      <CommandMenu bucket={connection.bucket} />
    </>
  );
}
