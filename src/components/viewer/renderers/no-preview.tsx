import { useId } from "react";
import { Download } from "lucide-react";
import { KindIcon } from "@/components/common/kind-icon";
import { Button } from "@/components/ui/button";
import { TEXT_KINDS } from "@/lib/kinds";
import { formatBytes } from "@/lib/format";
import type { FileMeta } from "@/lib/types";

export interface NoPreviewProps {
  file: FileMeta;
  downloadHref: string;
}

function describe(file: FileMeta): { title: string; body: string } {
  const hasExt = file.name.lastIndexOf(".") > 0;
  const ext = hasExt ? `.${file.ext}` : "";

  if (file.size === 0) {
    return { title: "This file is empty", body: "It has 0 bytes, so there is nothing to preview." };
  }
  if (TEXT_KINDS.has(file.kind)) {
    return {
      title: "This file isn’t readable text",
      body: `It has a ${ext || "text"} name, but its contents look binary. Download it to open it in an app that understands the format.`,
    };
  }
  if (file.kind === "archive") {
    return {
      title: `No preview for ${ext} files`,
      body: "Download the archive to inspect its contents on your computer.",
    };
  }
  return {
    title: hasExt ? `No preview for ${ext} files` : "No preview for this file",
    body: "Download it to open the file in an app that supports this format.",
  };
}

export function NoPreview({ file, downloadHref }: NoPreviewProps) {
  const titleId = useId();
  const { title, body } = describe(file);
  const contentType = file.contentType && file.contentType !== "application/octet-stream" ? file.contentType : null;

  return (
    <section
      aria-labelledby={titleId}
      className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-5 py-8 text-center"
    >
      <div className="grid size-16 shrink-0 place-items-center rounded-xl border border-line-2 bg-surface-2">
        <KindIcon kind={file.kind} size={30} strokeWidth={1.5} />
      </div>

      <h2
        id={titleId}
        className="mt-5 max-w-md text-[17px] font-semibold tracking-tight [overflow-wrap:anywhere] text-text-1"
      >
        {title}
      </h2>

      <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] text-text-2">
        <span className="tabular-nums">{formatBytes(file.size)}</span>
        <span aria-hidden className="text-line-3">
          ·
        </span>
        <span>{file.type === "File" ? "Unknown type" : `${file.type} file`}</span>
        {contentType && (
          <>
            <span aria-hidden className="text-line-3">
              ·
            </span>
            <span className="max-w-[16rem] truncate font-mono text-xs text-text-3" title={contentType}>
              {contentType}
            </span>
          </>
        )}
      </p>

      <p className="mt-3 max-w-md text-[13px] leading-relaxed text-pretty text-text-2">{body}</p>

      <Button asChild size="lg" className="mt-6">
        <a href={downloadHref} download>
          <Download data-icon="inline-start" />
          Download
        </a>
      </Button>
    </section>
  );
}
