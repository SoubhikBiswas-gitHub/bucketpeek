import Image from "next/image";
import Link from "next/link";
import { Compass, FolderOpen, Settings2 } from "lucide-react";
import { RequestedPath } from "@/components/common/requested-path";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

export default function NotFound() {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <title>{`Page not found · ${BRAND.name}`}</title>
      <header className="shrink-0 border-b border-line-1 bg-surface-0 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-12 max-w-(--page-width) items-center px-4 sm:h-(--topbar-height) sm:px-6">
          <Link
            href="/browse"
            className="-ml-1 flex h-9 items-center gap-2.5 rounded-md px-1 text-[15px] font-semibold tracking-tight text-text-1"
          >
            <Image src="/brand-mark.svg" alt="" width={26} height={26} className="size-[26px]" />
            {BRAND.name}
          </Link>
        </div>
      </header>

      <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <section aria-labelledby="not-found-title" className="m-auto w-full max-w-lg px-5 py-10 sm:px-6">
          <div className="mb-5 grid size-11 place-items-center rounded-lg border border-line-2 bg-surface-2 text-text-2">
            <Compass aria-hidden size={20} strokeWidth={1.9} />
          </div>
          <p className="font-mono text-xs text-text-3">Error 404</p>
          <h1 id="not-found-title" className="mt-1.5 text-xl font-semibold tracking-tight text-text-1 sm:text-2xl">
            Page not found
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-pretty text-text-2">
            Nothing lives at{" "}
            <RequestedPath className="rounded-sm border border-line-2 bg-surface-2 box-decoration-clone px-1.5 py-0.5 font-mono text-[13px] break-all text-text-1" />
            . The link may be incomplete, or the page may have moved.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Button asChild>
              <Link href="/browse">
                <FolderOpen aria-hidden data-icon="inline-start" />
                Go to your files
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/setup">
                <Settings2 aria-hidden data-icon="inline-start" />
                Connection settings
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
