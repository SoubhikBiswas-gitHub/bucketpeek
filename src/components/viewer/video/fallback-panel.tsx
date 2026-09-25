"use client";
import { Download, Link2, RotateCw, Terminal, VideoOff, WifiOff } from "lucide-react";
import { CopyButton } from "@/components/common/copy-button";
import { openCopyLinkDialog } from "@/components/common/copy-link-dialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { StagePanel } from "./stage-panel";

export interface FallbackPanelProps {
  title: string;
  message: string;
  // A raw technical line, e.g. ffmpeg's last error.
  detail?: string;
  icon?: "video" | "offline";
  action?: { label: string; onClick: () => void };
  // Shows how to install ffmpeg so conversion works.
  showInstallHint?: boolean;
  downloadHref: string;
  fileKey: string;
  name: string;
}

const INSTALL = "brew install ffmpeg";

export function FallbackPanel({
  title,
  message,
  detail,
  icon = "video",
  action,
  showInstallHint,
  downloadHref,
  fileKey,
  name,
}: FallbackPanelProps) {
  const Icon = icon === "offline" ? WifiOff : VideoOff;

  return (
    <StagePanel tone="card" role="region" aria-labelledby="video-fallback-title">
      <Empty className="max-w-lg gap-0 p-0 text-wrap">
        <EmptyHeader className="max-w-none gap-0">
          <EmptyMedia
            aria-hidden
            className={cn(
              "mb-4 grid size-11 place-items-center rounded-lg border",
              detail ? "border-danger-line bg-danger-mist text-danger" : "border-line-2 bg-surface-2 text-text-2",
            )}
          >
            <Icon size={20} strokeWidth={1.75} />
          </EmptyMedia>
          <EmptyTitle id="video-fallback-title" role="heading" aria-level={2} className="text-base sm:text-lg">
            {title}
          </EmptyTitle>
          <EmptyDescription className="mt-1.5 max-w-md text-sm leading-relaxed text-pretty">{message}</EmptyDescription>
        </EmptyHeader>

        {detail && (
          <pre className="mt-4 w-full max-w-md overflow-x-auto rounded-md border border-line-2 bg-surface-2 px-3 py-2 text-left font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-text-2">
            {detail}
          </pre>
        )}

        <EmptyContent className="mt-5 w-auto max-w-none flex-row flex-wrap justify-center gap-2 text-wrap">
          {action && (
            <Button type="button" onClick={action.onClick}>
              <RotateCw aria-hidden data-icon="inline-start" />
              {action.label}
            </Button>
          )}
          <Button asChild variant={action ? "outline" : "default"}>
            <a href={downloadHref} download>
              <Download aria-hidden data-icon="inline-start" />
              Download
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void openCopyLinkDialog({ keys: [fileKey], subject: name, successTitle: "Link copied" })}
          >
            <Link2 aria-hidden data-icon="inline-start" />
            Copy link
          </Button>
        </EmptyContent>

        {showInstallHint && (
          <div className="mt-6 w-full max-w-md border-t border-line-1 pt-5 text-left">
            <p className="flex items-center gap-2 text-[13px] font-medium text-text-1">
              <Terminal aria-hidden className="size-4 text-text-3" />
              Play it here instead
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-text-2">
              Install ffmpeg on the machine running Deccan Lens, then restart the app. Videos like this one will convert
              as they play.
            </p>
            <div className="mt-2.5 flex items-center gap-1 rounded-md border border-line-2 bg-surface-2 py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-1">
                <span aria-hidden className="mr-2 text-text-3 select-none">
                  $
                </span>
                {INSTALL}
              </code>
              <CopyButton value={INSTALL} label="Copy command" />
            </div>
            <p className="mt-2 text-xs text-text-3">
              On Linux, use your package manager, for example{" "}
              <code className="font-mono text-text-2">apt install ffmpeg</code>.
            </p>
          </div>
        )}
      </Empty>
    </StagePanel>
  );
}
