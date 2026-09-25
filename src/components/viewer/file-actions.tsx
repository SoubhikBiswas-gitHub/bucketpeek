"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Download, Ellipsis, ExternalLink, Info, Terminal } from "lucide-react";
import { toast } from "sonner";
import { openCopyLinkDialog, type CopiedLinks } from "@/components/common/copy-link-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { awsCliCommand } from "@/lib/aws-cli";
import { browseHref, downloadHref, openHref } from "@/lib/paths";
import type { FileMeta } from "@/lib/types";
import { copyText } from "./copy-text";
import { FileDetailsSheet } from "./file-details";
import { ShareLinkControl } from "./share-link-control";
import { AUTO_REFRESH_MS, isAudioPlaying, useLinkExpiry } from "./use-link-expiry";

export interface FileActionsProps {
  file: FileMeta;
  // ISO time the preview's media URLs stop working.
  linksExpireAt: string;
  bucket: string;
  region: string;
  folder: string;
}

const AUTO_REFRESH_COOLDOWN_MS = 5 * 60_000;

export function FileActions({ file, linksExpireAt, bucket, region, folder }: FileActionsProps) {
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [, startRefresh] = useTransition();
  const [copied, setCopied] = useState<CopiedLinks | null>(null);
  const expiry = useLinkExpiry(linksExpireAt);

  // Quietly re-sign the preview about a minute before expiry, once per expiry time. A playing video
  // picks up the new link and continues from the same spot; a playing song would restart, so while
  // audio plays each tick re-checks, and the refresh happens once it pauses.
  // A cooldown also stops a refresh loop if the server's clock runs behind the browser's, where fresh
  // links would already look expired here.
  const autoRefreshedFor = useRef<string | null>(null);
  const lastAutoRefresh = useRef(0);
  useEffect(() => {
    const left = expiry.remainingMs;
    if (left === null || left > AUTO_REFRESH_MS) return;
    if (autoRefreshedFor.current === linksExpireAt || isAudioPlaying()) return;
    if (Date.now() - lastAutoRefresh.current < AUTO_REFRESH_COOLDOWN_MS) return;
    autoRefreshedFor.current = linksExpireAt;
    lastAutoRefresh.current = Date.now();
    startRefresh(() => router.refresh());
  }, [expiry.remainingMs, linksExpireAt, router]);

  const dl = downloadHref(file.key);
  const open = openHref(file.key);

  // Signed on each copy, for the lifetime chosen in the dialog, not reused from the page.
  async function copyLink(): Promise<boolean> {
    const result = await openCopyLinkDialog({ keys: [file.key], subject: file.name, successTitle: "Link copied" });
    if (result) setCopied(result);
    return result !== null;
  }

  // The AWS CLI fetches big files in parallel parts and retries failed ones, unlike a browser.
  async function copyCli(): Promise<boolean> {
    const command = awsCliCommand(bucket, file.key);
    if (!(await copyText(command))) {
      toast.error("Couldn’t copy the AWS CLI command", {
        description: "Your browser blocked clipboard access. Copy the S3 URI from File details instead.",
      });
      return false;
    }
    toast.success("Copied AWS CLI command", { description: command });
    return true;
  }

  const menuItem = "min-h-11 gap-2.5 px-3 text-text-1";

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <ShareLinkControl copied={copied} onCopy={copyLink} />

      {/* Tablet and up: every action visible. Download's label shows from lg; below that, icons with tooltips. */}
      <div role="group" aria-label="File actions" className="hidden items-center gap-1.5 sm:flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild className="max-lg:w-8 max-lg:px-0">
              <a href={dl} download={file.name}>
                <Download aria-hidden />
                <span className="sr-only lg:not-sr-only">Download</span>
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="lg:hidden">
            Download
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="outline" size="icon">
              <a href={open} target="_blank" rel="noopener noreferrer" aria-label="Open original in a new tab">
                <ExternalLink aria-hidden />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open original in a new tab</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" onClick={() => void copyCli()} aria-label="Copy AWS CLI command">
              <Terminal aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Copy AWS CLI command</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDetailsOpen(true)}
              aria-label="File details"
              aria-haspopup="dialog"
              aria-expanded={detailsOpen}
            >
              <Info aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">File details</TooltipContent>
        </Tooltip>
      </div>

      {/* Phones: everything collapses into one menu. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={menuTrigger} variant="outline" className="size-11 sm:hidden" aria-label="File actions">
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-60">
          <DropdownMenuItem asChild className={menuItem}>
            <Link href={browseHref(folder)}>
              <ArrowLeft aria-hidden />
              Back to folder
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className={menuItem}>
            <a href={dl} download={file.name}>
              <Download aria-hidden />
              Download
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={menuItem}>
            <a href={open} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              Open original in a new tab
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem className={menuItem} onSelect={() => void copyCli()}>
            <Terminal aria-hidden />
            Copy AWS CLI command
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={menuItem} onSelect={() => setDetailsOpen(true)}>
            <Info aria-hidden />
            File details
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <FileDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        file={file}
        bucket={bucket}
        region={region}
        folder={folder}
        fallbackFocus={menuTrigger}
      />
    </div>
  );
}
