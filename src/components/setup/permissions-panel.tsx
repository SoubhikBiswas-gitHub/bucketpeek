"use client";

import { useRef, useState } from "react";
import { Collapsible } from "radix-ui";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

function policyFor(bucket: string): string {
  const arn = `arn:aws:s3:::${bucket}`;
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        { Sid: "ListBucket", Effect: "Allow", Action: "s3:ListBucket", Resource: arn },
        { Sid: "ReadFiles", Effect: "Allow", Action: "s3:GetObject", Resource: `${arn}/*` },
      ],
    },
    null,
    2,
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the legacy path (e.g. plain http on a LAN address).
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  } catch {
    return false;
  }
}

export function PermissionsPanel({ bucket }: { bucket: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const name = bucket ?? "your-bucket-name";
  const policy = policyFor(name);

  async function onCopy() {
    if (await copyText(policy)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Policy copied", {
        description: bucket ? `Scoped to ${bucket}.` : "Replace your-bucket-name with your bucket before saving it.",
      });
    } else {
      toast.error("Couldn’t copy the policy", { description: "Select the text and copy it yourself." });
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    // On short screens the policy opens below the fold; bring it into view.
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      contentRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  }

  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} className="min-w-0">
      <Collapsible.Trigger className="group -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 sm:min-h-9">
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-text-3 transition-transform duration-150 group-data-[state=open]:rotate-90"
        />
        What permissions do the keys need?
      </Collapsible.Trigger>
      <Collapsible.Content ref={contentRef} className="min-w-0 overflow-hidden">
        <div className="grid grid-cols-1 gap-3 pt-2 pb-2">
          <p className="text-sm text-pretty text-text-2">
            Read-only access is enough. Attach this policy to the IAM user that owns the keys.
          </p>
          <div className="relative min-w-0 rounded-lg border border-line-1 bg-surface-0">
            <div className="flex items-center justify-between gap-2 border-b border-line-1 py-1 pr-1 pl-3">
              <span className="truncate font-mono text-xs text-text-3">iam-policy.json</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCopy}
                className="h-9 shrink-0 text-text-2 transition-colors hover:text-text-1 sm:h-7"
              >
                {copied ? <CheckIcon aria-hidden className="text-brand" /> : <CopyIcon aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre
              tabIndex={0}
              aria-label="IAM policy JSON"
              className="max-h-60 overflow-auto rounded-b-lg p-3 font-mono text-xs leading-relaxed text-text-1 [font-variant-ligatures:none] focus-visible:outline-offset-[-2px]"
            >
              <code>{policy}</code>
            </pre>
          </div>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
