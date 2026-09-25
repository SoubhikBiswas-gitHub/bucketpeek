"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { cn } from "@/lib/utils"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { SearchIcon, CheckIcon } from "lucide-react"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl! bg-surface-2 text-text-1",
        className
      )}
      {...props}
    />
  )
}

// Dialog props go to the Radix root, everything else to DialogContent. The title and description
// sit inside the content, so they only exist while the dialog is open.
function CommandDialog({
  title = "Command palette",
  description = "Search for a file, folder or action.",
  children,
  className,
  showCloseButton = false,
  open,
  defaultOpen,
  onOpenChange,
  modal,
  ...props
}: React.ComponentProps<typeof Dialog> &
  Omit<React.ComponentProps<typeof DialogContent>, "title"> & {
    title?: string
    description?: string
  }) {
  return (
    <Dialog
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      modal={modal}
    >
      <DialogContent
        className={cn(
          "top-[12vh] translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl",
          className
        )}
        showCloseButton={showCloseButton}
        {...props}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  )
}

// `icon` replaces the leading search glyph; `children` render after the field (clear button, hints).
function CommandInput({
  className,
  wrapperClassName,
  icon,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  wrapperClassName?: string
  icon?: React.ReactNode
}) {
  return (
    <div
      data-slot="command-input-wrapper"
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-line-2 px-4",
        wrapperClassName
      )}
    >
      {icon ?? (
        <SearchIcon aria-hidden className="size-4 shrink-0 text-text-3" />
      )}
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-base text-text-1 outline-hidden placeholder:text-text-3 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          className
        )}
        {...props}
      />
      {children}
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[min(60vh,420px)] scroll-py-2 overflow-x-hidden overflow-y-auto overscroll-contain p-1.5 outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-10 text-center text-sm text-text-2", className)}
      {...props}
    />
  )
}

function CommandLoading({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Loading>) {
  return <CommandPrimitive.Loading data-slot="command-loading" {...props} />
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden text-text-1 not-first:mt-1.5 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-text-3",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1.5 my-1.5 h-px bg-line-2", className)}
      {...props}
    />
  )
}

// cmdk sets data-selected="true" or "false", so selection styles match the value, not the attribute.
function CommandItem({
  className,
  children,
  indicator = true,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & {
  indicator?: boolean
}) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-text-2 outline-hidden select-none pointer-coarse:min-h-11 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-surface-3 data-[selected=true]:text-text-1 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      {indicator && (
        <CheckIcon aria-hidden className="ml-auto text-brand opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
      )}
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-xs text-text-3 group-data-[selected=true]/command-item:text-text-2",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandLoading,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
