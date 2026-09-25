import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md px-2.5 py-1 text-base md:text-sm border border-line-2 bg-surface-2 text-text-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none placeholder:text-text-3 hover:border-line-3 focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-3 aria-invalid:ring-danger/20 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-1",
        className
      )}
      {...props}
    />
  )
}

export { Input }
