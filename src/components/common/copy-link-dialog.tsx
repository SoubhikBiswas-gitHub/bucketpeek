"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Clock, FileText, Files, Link2 } from "lucide-react";
import { toast } from "sonner";
import { writeClipboardLater } from "@/components/browser/clipboard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EXPIRY_OPTIONS, plural } from "@/lib/format";
import { DEFAULT_LINK_LIFETIME, isLinkLifetime, worksUntil, type WorksUntil } from "@/lib/link-expiry";
import { MAX_LINK_KEYS, type SignedLinks } from "@/lib/types";

export interface CopyLinkOptions {
  keys: string[];
  // What's being copied, e.g. "take.mp4" or "12 files".
  subject: string;
  // Folders left out of a selection, mentioned in the confirmation.
  skipped?: number;
  successTitle?: string;
}

export interface CopiedLinks {
  expiresAt: Date;
  until: WorksUntil;
}

interface Request extends CopyLinkOptions {
  openedAt: number;
  lifetime: number;
  resolve: (r: CopiedLinks | null) => void;
}

const STORAGE_KEY = "deccan-lens:link-lifetime";
const TICK_MS = 30_000;

function savedLifetime(): number {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY));
    return isLinkLifetime(v) ? v : DEFAULT_LINK_LIFETIME;
  } catch {
    return DEFAULT_LINK_LIFETIME;
  }
}

function saveLifetime(seconds: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(seconds));
  } catch {
    // Blocked storage: the choice just isn't remembered.
  }
}

let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function settle(req: Request, result: CopiedLinks | null) {
  req.resolve(result);
  if (current === req) {
    current = null;
    emit();
  }
}

// Asks how long the links should work, then signs and copies them. Resolves null if cancelled.
export function openCopyLinkDialog(options: CopyLinkOptions): Promise<CopiedLinks | null> {
  if (current) settle(current, null);
  return new Promise((resolve) => {
    current = { ...options, openedAt: Date.now(), lifetime: savedLifetime(), resolve };
    emit();
  });
}

async function signLinks(keys: string[], expiresIn: number): Promise<SignedLinks> {
  const links: SignedLinks["links"] = [];
  let expiresAt = "";
  for (let i = 0; i < keys.length; i += MAX_LINK_KEYS) {
    const res = await fetch("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: keys.slice(i, i + MAX_LINK_KEYS), expiresIn }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as (SignedLinks & { error?: { message: string } }) | null;
    if (!res.ok || !body?.links) throw new Error(body?.error?.message ?? `The server answered with status ${res.status}.`);
    links.push(...body.links);
    // The first batch's time is the earliest, so it holds for every link.
    expiresAt ||= body.expiresAt;
  }
  return { links, expiresAt };
}

// Mounted once in the app shell; every "Copy S3 link" action opens it through openCopyLinkDialog.
export function CopyLinkDialogHost() {
  const request = useSyncExternalStore(subscribe, () => current, () => null);
  // The last request stays rendered while the dialog animates closed.
  const [shown, setShown] = useState<Request | null>(null);
  if (request && request !== shown) setShown(request);

  const [choice, setChoice] = useState<{ req: Request; seconds: number } | null>(null);
  const [copyingFor, setCopyingFor] = useState<Request | null>(null);
  const [tick, setTick] = useState(0);
  const copyRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const untilId = useId();

  const open = request !== null;
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTick(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [open]);

  if (!shown) return null;
  const req = shown;
  const seconds = choice?.req === req ? choice.seconds : req.lifetime;
  const copying = copyingFor === req;
  const count = req.keys.length;
  const now = Math.max(req.openedAt, tick);
  const endsAt = new Date(now + seconds * 1000);
  const until = worksUntil(endsAt, new Date(now));
  const noun = count === 1 ? "link" : "links";

  function copy() {
    if (copying) return;
    saveLifetime(seconds);
    setCopyingFor(req);
    const signed = signLinks(req.keys, seconds);
    // Handed to the clipboard before any await: Safari only allows the write inside the click.
    const text = signed.then((s) => s.links.map((l) => new URL(l.url, window.location.origin).toString()).join("\n"));
    writeClipboardLater(text).then(
      async () => {
        const expiresAt = new Date((await signed).expiresAt);
        const done = { expiresAt, until: worksUntil(expiresAt) };
        const notes = [`Works until ${done.until.both}.`];
        if (req.skipped) notes.push(`${plural(req.skipped, "folder")} skipped.`);
        toast.success(req.successTitle ?? `Copied ${plural(count, "S3 link")}`, { description: notes.join(" ") });
        settle(req, done);
      },
      async (e: unknown) => {
        const fetchFailed = await signed.then(() => false, () => true);
        toast.error(`Couldn’t copy the ${noun}`, {
          description: fetchFailed && e instanceof Error ? e.message : "Your browser blocked clipboard access.",
        });
        setCopyingFor(null);
      },
    );
  }

  const Icon = count === 1 ? FileText : Files;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && settle(req, null)}>
      <DialogContent
        className="gap-5 sm:max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          copyRef.current?.focus();
        }}
      >
        <DialogHeader className="gap-1.5 pr-8">
          <DialogTitle>{count === 1 ? "Copy link" : `Copy ${plural(count, "link")}`}</DialogTitle>
          <DialogDescription className="text-[13px]">
            A presigned S3 {noun} that opens the {count === 1 ? "file" : "files"} straight from the bucket.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-line-2 bg-surface-1 px-3 py-2.5">
          <Icon aria-hidden className="size-4 shrink-0 text-text-3" />
          <p className="min-w-0 flex-1 truncate text-sm text-text-1" title={req.subject}>
            <span className="sr-only">Copying </span>
            {req.subject}
          </p>
          {req.skipped ? <span className="shrink-0 text-xs text-text-3">{plural(req.skipped, "folder")} skipped</span> : null}
        </div>

        <div className="grid gap-2">
          <p id={labelId} className="text-[13px] font-medium text-text-1">
            {count === 1 ? "Link works for" : "Links work for"}
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="lg"
            spacing={2}
            value={String(seconds)}
            onValueChange={(v) => {
              const n = Number(v);
              if (isLinkLifetime(n)) setChoice({ req, seconds: n });
            }}
            aria-labelledby={labelId}
            className="grid w-full grid-cols-2 sm:grid-cols-4"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <ToggleGroupItem
                key={o.seconds}
                value={String(o.seconds)}
                className="max-sm:h-11 data-[state=on]:border-brand-line data-[state=on]:bg-brand-mist data-[state=on]:text-brand"
              >
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div id={untilId} className="grid gap-1.5 rounded-lg border border-line-2 bg-surface-1 px-3 py-2.5">
          <p className="flex gap-2 text-[13px] leading-5 text-text-2">
            <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-text-3" />
            <span className="min-w-0 text-pretty">
              Works until{" "}
              <time dateTime={endsAt.toISOString()} className="font-medium whitespace-nowrap text-text-1 tabular-nums">
                {until.utc}
              </time>
              {" "}
              <span className="whitespace-nowrap">
                · <span className="font-medium text-text-1 tabular-nums">{until.ist}</span>
              </span>
            </span>
          </p>
          <p className="pl-6 text-xs leading-relaxed text-text-3">
            Anyone with the {noun} can open the {count === 1 ? "file" : "files"} until then.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => settle(req, null)} className="max-sm:h-11">
            Cancel
          </Button>
          <Button ref={copyRef} onClick={copy} disabled={copying} aria-describedby={untilId} className="max-sm:h-11">
            {copying ? <Spinner aria-hidden className="size-4" /> : <Link2 aria-hidden data-icon="inline-start" />}
            {copying ? "Copying…" : count === 1 ? "Copy link" : `Copy ${plural(count, "link")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
