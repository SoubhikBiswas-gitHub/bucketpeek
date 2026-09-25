import { cn } from "@/lib/utils";

export interface PreviewStageProps {
  label: string;
  kind: string;
  children: React.ReactNode;
  className?: string;
}

// Gives its single child a definite height: renderers fill it, scroll internally, and never grow the page.
// Renderers should not draw their own outer border.
export function PreviewStage({ label, kind, children, className }: PreviewStageProps) {
  return (
    <section
      aria-label={label}
      data-slot="preview-stage"
      data-preview={kind}
      className={cn(
        "relative isolate flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line-1 bg-surface-1",
        "*:min-h-0 *:min-w-0 *:flex-1",
        className,
      )}
    >
      {children}
    </section>
  );
}
