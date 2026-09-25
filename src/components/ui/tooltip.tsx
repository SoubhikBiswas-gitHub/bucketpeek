"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { useFullscreenElement } from "@/lib/use-fullscreen"
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

interface TooltipGuard {
  // A callback ref for the trigger; returns the cleanup.
  attach: (el: HTMLElement | null) => (() => void) | undefined
  release: () => void
}
const TooltipGuardContext = React.createContext<TooltipGuard | null>(null)

// Hidden while the trigger's menu or popover is open (aria-expanded="true"), and after it closes until
// the pointer leaves or focus moves on, since focus returning to the button would reopen it.
function Tooltip({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen ?? false)
  const controlled = openProp !== undefined
  const trigger = React.useRef<HTMLElement | null>(null)
  const suppressed = React.useRef(false)
  const onOpenChangeRef = React.useRef(onOpenChange)
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })

  const change = React.useCallback(
    (next: boolean) => {
      if (next && (suppressed.current || trigger.current?.getAttribute("aria-expanded") === "true")) return
      if (!controlled) setUncontrolled(next)
      onOpenChangeRef.current?.(next)
    },
    [controlled],
  )

  const guard = React.useMemo<TooltipGuard>(
    () => ({
      attach: (el) => {
        trigger.current = el
        if (!el) return undefined
        const observer = new MutationObserver(() => {
          const expanded = el.getAttribute("aria-expanded") === "true"
          if (expanded) change(false)
          else suppressed.current = true
        })
        observer.observe(el, { attributes: true, attributeFilter: ["aria-expanded"] })
        return () => observer.disconnect()
      },
      release: () => {
        suppressed.current = false
      },
    }),
    [change],
  )

  return (
    <TooltipGuardContext.Provider value={guard}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={controlled ? openProp : uncontrolled}
        onOpenChange={change}
        {...props}
      />
    </TooltipGuardContext.Provider>
  )
}

function TooltipTrigger({
  ref,
  onPointerLeave,
  onBlur,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const guard = React.useContext(TooltipGuardContext)
  const setRef = React.useCallback(
    (el: HTMLButtonElement | null) => {
      if (typeof ref === "function") ref(el)
      else if (ref) ref.current = el
      return guard?.attach(el)
    },
    [ref, guard],
  )
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      ref={setRef}
      onPointerLeave={(e) => {
        guard?.release()
        onPointerLeave?.(e)
      }}
      onBlur={(e) => {
        guard?.release()
        onBlur?.(e)
      }}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const fullscreen = useFullscreenElement()
  return (
    <TooltipPrimitive.Portal container={fullscreen ?? undefined}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-surface-3 px-2.5 py-1.5 text-xs leading-snug text-text-1 shadow-lg shadow-black/40 ring-1 ring-line-2 break-words has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
