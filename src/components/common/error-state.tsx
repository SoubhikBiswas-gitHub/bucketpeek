import { useId } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert, Database, FileQuestion, KeyRound, Settings2, WifiOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { CopyButton } from "@/components/common/copy-button";
import { RetryButton } from "@/components/common/retry-button";
import type { AppError } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  // `status`, when present, picks the icon and the secondary action.
  error: Pick<AppError, "title" | "message" | "detail"> & { status?: number };
  // Defaults to a "Try again" button that re-fetches the page.
  action?: { label: string; href: string; icon?: LucideIcon };
  // An error boundary's `retry`. Ignored when `action` is set.
  onRetry?: () => void;
  // Use 2 when the page already has an h1.
  headingLevel?: 1 | 2;
  className?: string;
}

interface Secondary {
  label: string;
  href: string;
  icon: LucideIcon;
}

function presentation(status: number | undefined): { icon: LucideIcon; secondary: Secondary } {
  const settings = { label: "Check settings", href: "/setup", icon: Settings2 };
  if (status === 401 || status === 403) return { icon: KeyRound, secondary: { ...settings, label: "Update connection" } };
  if (status === 404) return { icon: FileQuestion, secondary: { label: "Go to bucket root", href: "/browse", icon: Database } };
  if (status === 503) return { icon: WifiOff, secondary: settings };
  return { icon: CircleAlert, secondary: settings };
}

export function ErrorState({ error, action, onRetry, headingLevel = 1, className }: ErrorStateProps) {
  const titleId = useId();
  const { icon: Icon, secondary } = presentation(error.status);
  const showSecondary = secondary.href !== action?.href;
  const ActionIcon = action?.icon ?? ArrowLeft;
  const SecondaryIcon = secondary.icon;
  const detail = error.detail && error.detail !== error.message ? error.detail : "";

  // Fills the page's remaining height and centers; scrolls internally only if the details panel is taller.
  return (
    <div data-slot="error-state" className={cn("flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain", className)}>
      <Empty
        role="region"
        aria-labelledby={titleId}
        className="m-auto block w-full max-w-xl flex-none px-1 py-6 text-left text-wrap sm:py-10"
      >
        <EmptyHeader className="block max-w-none">
          <EmptyMedia className="mb-5 grid size-11 place-items-center rounded-lg border border-danger-line bg-danger-mist text-danger">
            <Icon aria-hidden size={20} strokeWidth={1.9} />
          </EmptyMedia>
          <EmptyTitle
            id={titleId}
            role="heading"
            aria-level={headingLevel}
            className="text-xl text-balance wrap-anywhere sm:text-2xl"
          >
            {error.title}
          </EmptyTitle>
          <EmptyDescription className="mt-2 text-[15px] leading-relaxed text-pretty wrap-anywhere">
            {error.message}
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent className="mt-6 max-w-none flex-row flex-wrap items-stretch gap-2.5 text-wrap">
          {action ? (
            <Button asChild>
              <Link href={action.href}>
                <ActionIcon aria-hidden data-icon="inline-start" />
                {action.label}
              </Link>
            </Button>
          ) : (
            <RetryButton onRetry={onRetry} />
          )}
          {showSecondary && (
            <Button asChild variant="outline">
              <Link href={secondary.href}>
                <SecondaryIcon aria-hidden data-icon="inline-start" />
                {secondary.label}
              </Link>
            </Button>
          )}
        </EmptyContent>

        {detail && (
          <details className="group mt-7 rounded-lg border border-line-1 bg-surface-1 text-sm open:pb-1">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-3.5 text-text-2 select-none hover:text-text-1 [&::-webkit-details-marker]:hidden">
              <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 text-text-3 transition-transform group-open:rotate-90 motion-reduce:transition-none">
                <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Technical details
            </summary>
            <div className="relative mx-1.5 mb-1.5 rounded-md border border-line-1 bg-surface-0">
              <pre className="max-h-48 overflow-auto sm:max-h-64 p-3.5 pr-12 font-mono text-xs leading-relaxed whitespace-pre-wrap text-text-2 wrap-anywhere">
                {detail}
              </pre>
              <CopyButton value={detail} label="Copy details" className="absolute top-1.5 right-1.5" />
            </div>
          </details>
        )}
      </Empty>
    </div>
  );
}
