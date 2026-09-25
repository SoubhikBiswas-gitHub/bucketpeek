"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { EllipsisVertical, LogOut, Search, Settings2 } from "lucide-react";
import { disconnect } from "@/app/setup/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openCommandMenu, useIsMac } from "./use-platform";

function DisconnectSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" className="w-full sm:w-auto" aria-disabled={pending || undefined}>
      {pending ? <Spinner aria-hidden data-icon="inline-start" /> : <LogOut aria-hidden data-icon="inline-start" />}
      {pending ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}

export function TopBarActions({ bucket }: { bucket: string }) {
  const mac = useIsMac();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <div className="hidden items-center gap-1 sm:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" className="max-lg:size-8 max-lg:px-0" aria-label="Connection settings">
              <Link href="/setup">
                <Settings2 aria-hidden data-icon="inline-start" />
                <span className="hidden lg:inline">Settings</span>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="lg:hidden">
            Connection settings
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={disconnectRef}
              variant="ghost"
              className="max-lg:size-8 max-lg:px-0"
              aria-label="Disconnect"
              aria-haspopup="dialog"
              onClick={() => {
                returnFocus.current = disconnectRef.current;
                setConfirmOpen(true);
              }}
            >
              <LogOut aria-hidden data-icon="inline-start" />
              <span className="hidden lg:inline">Disconnect</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="lg:hidden">
            Disconnect
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Non-modal so choosing "Disconnect" can hand focus to the dialog cleanly. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={moreRef} variant="ghost" size="icon-lg" className="sm:hidden" aria-label="More actions">
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-60">
          <DropdownMenuItem onSelect={openCommandMenu}>
            <Search aria-hidden />
            Search files
            <DropdownMenuShortcut>{mac ? "⌘K" : "Ctrl K"}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/setup">
              <Settings2 aria-hidden />
              Connection settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              returnFocus.current = moreRef.current;
              setConfirmOpen(true);
            }}
          >
            <LogOut aria-hidden />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogMedia className="border border-danger-line bg-danger-mist text-danger">
              <LogOut aria-hidden />
            </AlertDialogMedia>
            <AlertDialogTitle className="wrap-anywhere">
              Disconnect from <span className="font-mono text-[15px]">{bucket}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>You’ll need to enter your keys again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={disconnect} className="flex">
              <DisconnectSubmit />
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
