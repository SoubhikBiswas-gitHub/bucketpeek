"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Status is carried by the icon tint, not the toast surface.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      gap={8}
      // Clear of the home indicator on phones (the page uses viewport-fit=cover).
      mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      icons={{
        success: <CircleCheckIcon aria-hidden className="size-4 text-kind-data" />,
        info: <InfoIcon aria-hidden className="size-4 text-kind-image" />,
        warning: <TriangleAlertIcon aria-hidden className="size-4 text-brand" />,
        error: <OctagonXIcon aria-hidden className="size-4 text-danger" />,
        loading: <Loader2Icon aria-hidden className="size-4 animate-spin text-text-2" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface-3)",
          "--normal-text": "var(--text-1)",
          "--normal-border": "var(--line-2)",
          "--border-radius": "10px",
          "--width": "min(380px, calc(100vw - 32px))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast font-sans! text-sm! shadow-xl! shadow-black/50! gap-2.5!",
          title: "font-medium! text-text-1!",
          description: "text-text-2! leading-relaxed!",
          actionButton: "bg-brand-strong! text-on-brand! font-medium! rounded-md!",
          cancelButton: "bg-surface-2! text-text-2! rounded-md!",
          closeButton: "bg-surface-3! border-line-2! text-text-2! hover:text-text-1!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
