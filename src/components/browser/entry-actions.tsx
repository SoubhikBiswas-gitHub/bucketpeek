"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppWindow, Check, Copy, Download, ExternalLink, Eye, FolderOpen, Link2, MoreHorizontal, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { awsCliCommand } from "@/lib/aws-cli";
import { downloadHref } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { copyS3Links } from "./bulk-actions";
import { writeClipboard } from "./clipboard";
import { itemHref, s3Uri, type BrowserParams, type Item } from "./items";

type Keep = Pick<BrowserParams, "sort" | "dir" | "view">;

export interface EntryActions {
  href: (item: Item) => string;
  open: (item: Item, newTab?: boolean) => void;
  prefetch: (item: Item) => void;
  copyPath: (item: Item) => Promise<boolean>;
  /** The Deccan Lens page for the item. */
  copyLink: (item: Item) => Promise<boolean>;
  /** A presigned HTTPS link to the file in S3. */
  copyS3Link: (item: Item) => Promise<boolean>;
  /** An `aws s3 cp` command that downloads the file, or the folder recursively. */
  copyCli: (item: Item) => Promise<boolean>;
  download: (item: Item) => void;
}

const LAST_KEY = "lens:last-opened:";

/** Remembers the last row opened in a folder so focus can return to it. */
export function rememberOpened(prefix: string, id: string) {
  try {
    sessionStorage.setItem(LAST_KEY + prefix, id);
  } catch {
    /* storage unavailable; nothing to remember */
  }
}

export function lastOpened(prefix: string): string | null {
  try {
    return sessionStorage.getItem(LAST_KEY + prefix);
  } catch {
    return null;
  }
}

async function copy(text: string, what: string): Promise<boolean> {
  try {
    await writeClipboard(text);
    toast.success(`Copied ${what}`, { description: text });
    return true;
  } catch {
    toast.error(`Couldn’t copy the ${what}`, {
      description: "Your browser blocked clipboard access. Select the text and copy it manually.",
    });
    return false;
  }
}

export function useEntryActions(bucket: string, prefix: string, keep: Keep): EntryActions {
  const router = useRouter();
  const { sort, dir, view } = keep;

  const href = useCallback((item: Item) => itemHref(item, { sort, dir, view }), [sort, dir, view]);

  const open = useCallback(
    (item: Item, newTab = false) => {
      const url = href(item);
      if (newTab) {
        window.open(url, "_blank", "noopener");
        return;
      }
      rememberOpened(prefix, item.id);
      router.push(url);
    },
    [href, prefix, router],
  );

  const prefetch = useCallback(
    (item: Item) => {
      // Folder listings are cheap to prefetch; file views build previews, so only fetch those on demand.
      if (item.isFolder) router.prefetch(href(item));
    },
    [href, router],
  );

  return useMemo(
    () => ({
      href,
      open,
      prefetch,
      copyPath: (item: Item) => copy(s3Uri(bucket, item), "S3 path"),
      copyLink: (item: Item) => copy(new URL(href(item), window.location.origin).toString(), "link"),
      copyS3Link: (item: Item) => copyS3Links([item]),
      // The AWS CLI downloads big files in parallel parts and resumes after failures, unlike a browser.
      copyCli: (item: Item) => copy(awsCliCommand(bucket, item.id), "AWS CLI command"),
      download: (item: Item) => {
        if (item.isFolder) return;
        const a = document.createElement("a");
        a.href = downloadHref(item.file.key);
        a.download = item.name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
    }),
    [bucket, href, open, prefetch],
  );
}

interface MenuParts {
  Item: typeof ContextMenuItem | typeof DropdownMenuItem;
  Separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator;
  Label: typeof ContextMenuLabel | typeof DropdownMenuLabel;
}

function MenuItems({ item, actions, parts }: { item: Item; actions: EntryActions; parts: MenuParts }) {
  const { Item: MenuItem, Separator, Label } = parts;
  return (
    <>
      <Label className="truncate text-xs font-normal text-text-3" title={item.name}>
        {item.name}
      </Label>
      <MenuItem onSelect={() => actions.open(item)}>
        {item.isFolder ? <FolderOpen aria-hidden /> : <Eye aria-hidden />}
        Open
      </MenuItem>
      <MenuItem onSelect={() => actions.open(item, true)}>
        <ExternalLink aria-hidden />
        Open in new tab
      </MenuItem>
      {!item.isFolder && (
        <MenuItem onSelect={() => actions.download(item)}>
          <Download aria-hidden />
          Download
        </MenuItem>
      )}
      <Separator />
      <MenuItem onSelect={() => void actions.copyPath(item)}>
        <Copy aria-hidden />
        Copy S3 path
      </MenuItem>
      {!item.isFolder && (
        <MenuItem onSelect={() => void actions.copyS3Link(item)}>
          <Link2 aria-hidden />
          Copy S3 link
        </MenuItem>
      )}
      <MenuItem onSelect={() => void actions.copyCli(item)}>
        <Terminal aria-hidden />
        Copy AWS CLI command
      </MenuItem>
      <MenuItem onSelect={() => void actions.copyLink(item)}>
        <AppWindow aria-hidden />
        Copy Deccan Lens link
      </MenuItem>
    </>
  );
}

const CONTEXT_PARTS: MenuParts = { Item: ContextMenuItem, Separator: ContextMenuSeparator, Label: ContextMenuLabel };
const DROPDOWN_PARTS: MenuParts = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator, Label: DropdownMenuLabel };

export function EntryContextMenu({ item, actions }: { item: Item; actions: EntryActions }) {
  return (
    // Radix flips a context menu to the other side of the pointer but never slides it sideways, so at
    // most half the screen wide it always fits on one side of wherever it was opened.
    <ContextMenuContent className="w-[min(16rem,calc(50vw-0.5rem))]">
      <MenuItems item={item} actions={actions} parts={CONTEXT_PARTS} />
    </ContextMenuContent>
  );
}

/** Stops row activation when interacting with controls inside a row. */
function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function MoreActions({
  item,
  actions,
  tabIndex,
  className,
}: {
  item: Item;
  actions: EntryActions;
  tabIndex: number;
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          tabIndex={tabIndex}
          aria-label={`More actions for ${item.name}`}
          className={cn("text-text-2 hover:text-text-1", className)}
          onClick={stop}
          onKeyDown={stop}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-1rem)]" onClick={stop}>
        <MenuItems item={item} actions={actions} parts={DROPDOWN_PARTS} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActionButton({
  label,
  tabIndex,
  onClick,
  children,
  asLink,
}: {
  label: string;
  tabIndex: number;
  onClick?: () => void;
  children: React.ReactNode;
  asLink?: { href: string; download: string };
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {asLink ? (
          <Button asChild variant="ghost" size="icon-sm" className="text-text-2 hover:text-text-1">
            <a
              href={asLink.href}
              download={asLink.download}
              tabIndex={tabIndex}
              aria-label={label}
              onClick={stop}
              onKeyDown={stop}
            >
              {children}
            </a>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            tabIndex={tabIndex}
            aria-label={label}
            className="text-text-2 hover:text-text-1"
            onClick={(e) => {
              stop(e);
              onClick?.();
            }}
            onKeyDown={stop}
          >
            {children}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Inline Download and Copy path buttons. Hidden until row hover or focus on pointer devices. */
export function InlineActions({ item, actions, tabIndex }: { item: Item; actions: EntryActions; tabIndex: number }) {
  return (
    <>
      {!item.isFolder && (
        <ActionButton
          label="Download"
          tabIndex={tabIndex}
          asLink={{ href: downloadHref(item.file.key), download: item.name }}
        >
          <Download aria-hidden />
        </ActionButton>
      )}
      <CopyPathButton item={item} actions={actions} tabIndex={tabIndex} />
    </>
  );
}

/** Copy icon that confirms with a check for a moment after copying. */
function CopyPathButton({ item, actions, tabIndex }: { item: Item; actions: EntryActions; tabIndex: number }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ActionButton
      label={copied ? "Copied" : "Copy S3 path"}
      tabIndex={tabIndex}
      onClick={async () => {
        if (!(await actions.copyPath(item))) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check aria-hidden className="text-brand" /> : <Copy aria-hidden />}
    </ActionButton>
  );
}
