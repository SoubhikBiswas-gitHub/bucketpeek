"use client";

import { useEffect } from "react";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { CircleAlert, Plug, RefreshCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const sans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], axes: ["opsz"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

interface GlobalErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
}

// Replaces the root layout when it fails, so it brings its own document, styles and fonts.
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable} h-full`}>
      <body className="flex h-dvh flex-col overflow-hidden">
        <title>{`Something went wrong · ${BRAND.name}`}</title>
        <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <section aria-labelledby="global-error-title" className="m-auto w-full max-w-lg px-5 py-10 sm:px-6">
            {/* Plain <img>: the image optimizer may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand-mark.svg" alt={BRAND.name} width={32} height={32} className="mb-8 size-8" />
            <div className="mb-5 grid size-11 place-items-center rounded-lg border border-danger-line bg-danger-mist text-danger">
              <CircleAlert aria-hidden size={20} strokeWidth={1.9} />
            </div>
            <h1 id="global-error-title" className="text-xl font-semibold tracking-tight text-text-1 sm:text-2xl">
              {BRAND.name} stopped working
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-pretty text-text-2">
              Something went wrong while loading the app. Try again. If that doesn’t help, reload the page or reconnect your bucket.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Button type="button" onClick={() => retry()}>
                <RotateCw aria-hidden data-icon="inline-start" />
                Try again
              </Button>
              <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                <RefreshCcw aria-hidden data-icon="inline-start" />
                Reload page
              </Button>
              {/* Plain anchor: a full navigation works even if the client router is broken. */}
              <Button asChild variant="ghost">
                <a href="/setup">
                  <Plug aria-hidden data-icon="inline-start" />
                  Reconnect
                </a>
              </Button>
            </div>
            {error.digest && (
              <p className="mt-7 text-xs text-text-3">
                Reference <code className="font-mono text-text-2 select-all">{error.digest}</code>
              </p>
            )}
          </section>
        </main>
      </body>
    </html>
  );
}
