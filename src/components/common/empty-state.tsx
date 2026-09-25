import { createElement, isValidElement } from "react";
import Link from "next/link";
import { Inbox, type LucideProps } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<LucideProps>;

export interface EmptyStateProps {
  icon?: IconComponent | React.ReactElement;
  title: string;
  description?: React.ReactNode;
  action?: { label: string; href: string; icon?: IconComponent } | React.ReactNode;
  // "default" for a whole page or panel, "compact" inside a table or card.
  size?: "default" | "compact";
  bordered?: boolean;
  className?: string;
}

function isLinkAction(a: EmptyStateProps["action"]): a is { label: string; href: string; icon?: IconComponent } {
  return typeof a === "object" && a !== null && !isValidElement(a) && "href" in a && "label" in a;
}

export function EmptyState({ icon = Inbox, title, description, action, size = "default", bordered = false, className }: EmptyStateProps) {
  const compact = size === "compact";
  const glyph = isValidElement(icon)
    ? icon
    : createElement(icon as IconComponent, { "aria-hidden": true, size: compact ? 18 : 22, strokeWidth: 1.75 });

  return (
    <Empty
      data-slot="empty-state"
      className={cn(
        // Grows to fill a flex parent and centers itself, so it never pushes the page into scrolling.
        "my-auto text-wrap",
        compact ? "gap-3 px-4 py-8" : "gap-4 px-6 py-10 sm:py-12",
        bordered && "rounded-xl border border-dashed border-line-2",
        className,
      )}
    >
      <EmptyMedia
        className={cn(
          // The default variant with the app's own tile; the "icon" variant would resize the glyph to 20px.
          "mb-0 grid place-items-center rounded-lg border border-line-2 bg-surface-2 text-text-2 shadow-sm shadow-black/30",
          compact ? "size-10" : "size-12",
        )}
      >
        {glyph}
      </EmptyMedia>
      <EmptyHeader className="max-w-md min-w-0 items-stretch gap-1.5">
        <EmptyTitle
          role="heading"
          aria-level={2}
          className={cn("text-balance wrap-anywhere", compact ? "text-sm" : "text-base")}
        >
          {title}
        </EmptyTitle>
        {description && (
          <EmptyDescription className="text-sm leading-relaxed text-pretty wrap-anywhere">{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {action && (
        <EmptyContent className="mt-1 w-auto max-w-none flex-row flex-wrap justify-center gap-2 text-wrap">
          {isLinkAction(action) ? (
            <Button asChild variant="outline">
              <Link href={action.href}>
                {action.icon && createElement(action.icon, { "aria-hidden": true, "data-icon": "inline-start" } as LucideProps)}
                {action.label}
              </Link>
            </Button>
          ) : (
            action
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}
