import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Focus uses the global brand outline (see globals.css). On coarse pointers an invisible ::after
// extends the hit area to at least 44x44px without changing the visual size.
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity] duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/20 pointer-coarse:after:absolute pointer-coarse:after:inset-x-[min(0px,calc((100%-44px)/2))] pointer-coarse:after:inset-y-[min(0px,calc((100%-44px)/2))] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-brand-strong bg-brand-strong text-on-brand hover:border-brand-strong-hover hover:bg-brand-strong-hover aria-expanded:bg-brand-strong-hover",
        outline:
          "border-line-2 bg-surface-2 text-text-1 hover:border-line-3 hover:bg-surface-3 aria-expanded:border-line-3 aria-expanded:bg-surface-3",
        secondary:
          "border-line-2 bg-surface-3 text-text-1 hover:border-line-3 hover:bg-line-2 aria-expanded:bg-line-2",
        ghost:
          "text-text-2 hover:bg-surface-3 hover:text-text-1 aria-expanded:bg-surface-3 aria-expanded:text-text-1",
        destructive:
          "border-danger-line bg-danger-mist text-danger hover:border-danger/60 hover:bg-danger/15 focus-visible:outline-danger",
        link: "h-auto! border-0 px-0! text-brand underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-md px-2.5 text-[13px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-[15px] has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        icon: "size-8",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-10 [&_svg:not([class*='size-'])]:size-[18px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
