import { Clock, HardDrive } from "lucide-react";
import { KindIcon } from "@/components/common/kind-icon";
import { Pill } from "@/components/common/pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/format";
import type { FileMeta } from "@/lib/types";
import { exactBytes, exactDateTime, kindLabel, parseDate, shortDate } from "./file-info";

export interface FileMetaBarProps {
  file: FileMeta;
  position: { index: number; total: number } | null;
  actions: React.ReactNode;
}

export function FileMetaBar({ file, position, actions }: FileMetaBarProps) {
  const modified = parseDate(file.modified);
  // Extension-less names get the "File" type label; the kind reads better there.
  const typeText = file.type === "File" ? kindLabel(file.kind) : file.type;

  return (
    <div className="flex shrink-0 items-center gap-3">
      <ul aria-label="File facts" className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <li className="flex min-w-0">
          <Pill icon={<KindIcon kind={file.kind} size={14} />} title={kindLabel(file.kind)}>
            {typeText}
          </Pill>
        </li>
        {/* Phones keep one line: size and date live in the details sheet there. */}
        <li className="flex max-sm:hidden">
          <Pill icon={<HardDrive />} title={exactBytes(file.size)}>
            {formatBytes(file.size)}
          </Pill>
        </li>
        {modified && (
          <li className="flex max-sm:hidden">
            <Tooltip>
              <TooltipTrigger asChild>
                <Pill icon={<Clock />} tabIndex={0} className="cursor-default">
                  <time dateTime={modified.toISOString()}>
                    Modified {shortDate(modified)}
                  </time>
                </Pill>
              </TooltipTrigger>
              <TooltipContent side="bottom">Modified {exactDateTime(modified)}</TooltipContent>
            </Tooltip>
          </li>
        )}
        {/* On phones the position sits here instead of between the prev/next buttons. */}
        {position && position.total > 0 && (
          <li className="flex sm:hidden">
            <Pill>
              <span className="sr-only">File </span>
              {position.index.toLocaleString("en-US")} of {position.total.toLocaleString("en-US")}
            </Pill>
          </li>
        )}
      </ul>
      <div className="shrink-0">{actions}</div>
    </div>
  );
}
