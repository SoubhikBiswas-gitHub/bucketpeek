"use client";

import { useFormStatus } from "react-dom";
import { LogOutIcon } from "lucide-react";
import { disconnect } from "@/app/setup/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="destructive"
      disabled={pending}
      aria-disabled={pending}
      className="h-11 w-full transition-colors sm:h-8 sm:w-auto"
    >
      {pending ? <Spinner aria-hidden className="size-4" /> : null}
      {pending ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}

export function DisconnectButton({ disabled }: { disabled?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-11 shrink-0 border-danger-line px-3 text-danger transition-colors hover:bg-danger-mist hover:text-danger max-sm:w-11 max-sm:px-0 sm:h-8 dark:border-danger-line dark:bg-transparent dark:hover:bg-danger-mist"
        >
          <LogOutIcon aria-hidden />
          <span className="max-sm:sr-only">Disconnect</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <form action={disconnect} className="contents">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect from this bucket?</AlertDialogTitle>
            <AlertDialogDescription className="text-text-2">
              The keys are removed from this browser. You’ll need to enter them again to reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 transition-colors sm:h-8">Cancel</AlertDialogCancel>
            <ConfirmButton />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
