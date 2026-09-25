"use client"

import * as React from "react"
import { Check, Minus } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative grid size-4 shrink-0 place-items-center rounded-[4px] border border-line-3 bg-surface-1 text-surface-0 transition-[color,background-color,border-color] duration-100 outline-hidden",
        // outline-hidden also sets the outline style to none, so the focus ring restates solid.
        "hover:border-text-3 focus-visible:outline-solid focus-visible:outline-2focus-visible:outline-offset-2 focus-visible:outline-brand",
        "data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // A 44px hit area on touch screens without changing the visual size.
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-items-center">
        {props.checked === "indeterminate" ? (
          <Minus className="size-3" strokeWidth={3} aria-hidden />
        ) : (
          <Check className="size-3" strokeWidth={3} aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
