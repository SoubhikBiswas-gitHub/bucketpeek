import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "brand" | "warn" | "danger";

const TONES: Record<PillTone, { pill: string; icon: string }> = {
  neutral: { pill: "border-line-2 bg-surface-2 text-text-2", icon: "text-text-3" },
  brand: { pill: "border-brand-line bg-brand-mist text-brand", icon: "text-brand" },
  warn: { pill: "border-brand-line bg-brand-mist text-brand", icon: "text-brand" },
  danger: { pill: "border-danger-line bg-danger-mist text-danger", icon: "text-danger" },
};

export interface PillProps extends Omit<React.ComponentProps<"span">, "title"> {
  // Rendered at 14px, e.g. a Lucide icon or <KindIcon size={14} />.
  icon?: React.ReactNode;
  tone?: PillTone;
  // Native tooltip text; prefer a Tooltip wrapper for anything important.
  title?: string;
}

// Forwards props (and ref) so it can be a Tooltip trigger.
export function Pill({ icon, tone = "neutral", title, className, children, ...rest }: PillProps) {
  const t = TONES[tone];
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        "h-6 max-w-full min-w-0 gap-1.5 rounded-full px-2.5 text-xs font-normal tabular-nums",
        icon && "pl-2",
        t.pill,
        className,
      )}
      {...rest}
    >
      {icon && (
        // Wrapped so Badge's 12px `[&>svg]` rule doesn't shrink the icon.
        <span aria-hidden className={cn("flex shrink-0 items-center [&_svg]:size-3.5", t.icon)}>
          {icon}
        </span>
      )}
      <span className="min-w-0 truncate">{children}</span>
    </Badge>
  );
}
