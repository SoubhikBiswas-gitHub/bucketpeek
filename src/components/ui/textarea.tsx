import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md px-2.5 py-2 text-base md:text-sm border border-line-2 bg-surface-2 text-text-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none placeholder:text-text-3 hover:border-line-3 focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
