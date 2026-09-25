"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Download, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export interface PreviewErrorProps {
  title: string;
  message: string;
  downloadHref: string;
}

export function PreviewError({ title, message, downloadHref }: PreviewErrorProps) {
  const router = useRouter();
  const titleId = useId();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-4 sm:p-6">
      <section
        aria-labelledby={titleId}
        aria-busy={pending}
        className="w-full max-w-lg rounded-lg border border-danger-line bg-danger-mist p-4 sm:p-5"
      >
        <div className="flex gap-3">
          <CircleAlert aria-hidden className="mt-px size-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] leading-snug font-medium [overflow-wrap:anywhere] text-text-1">
              {title || "The preview couldn’t be loaded"}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed [overflow-wrap:anywhere] text-text-2">
              {message || "Something went wrong while reading this file."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={() => startTransition(() => router.refresh())} disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" aria-hidden /> : <RotateCw data-icon="inline-start" />}
                {pending ? "Trying again" : "Try again"}
              </Button>
              <Button asChild variant="outline">
                <a href={downloadHref} download>
                  <Download data-icon="inline-start" />
                  Download
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
