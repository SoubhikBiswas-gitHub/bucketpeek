"use client";

import { useMemo, useRef, useState } from "react";
import { CircleAlert, TriangleAlert, WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CodeBody, useCodeLines, type CodeBodyHandle, type CodeLines } from "./code-body";
import { codeText, plainCodeData, type CodeData, type LogLevel } from "./code-model";
import { CopyContentsButton } from "./copy-contents-button";
import { DocFrame, DocMeta, DocToolbar, EmptyDocument, MetaDot } from "./doc-chrome";
import { LoadMoreFooter } from "./load-more-footer";
import { useTextLoader } from "./use-text-loader";

export interface CodeViewProps {
  data: CodeData;
  name: string;
  truncated: boolean;
  downloadHref: string;
}

export function CodeView({ data: initial, name, truncated, downloadHref }: CodeViewProps) {
  const [wrap, setWrap] = useState(initial.wrapDefault);
  const { data, loader } = useMoreCode(initial, truncated, downloadHref);
  const lines = useCodeLines(data);
  const body = useRef<CodeBodyHandle>(null);
  const [active, setActive] = useState<number | null>(null);

  if (data.lineCount === 0) {
    return (
      <DocFrame>
        <EmptyDocument />
      </DocFrame>
    );
  }

  const jump = (index: number) => {
    setActive(index);
    body.current?.scrollToLine(index);
  };

  return (
    <DocFrame>
      <DocToolbar>
        <CodeMeta data={data} />
        {lines.levels && <LogJumps lines={lines} active={active} onJump={jump} />}
        <div className="ml-auto flex items-center gap-1">
          <WrapToggle wrap={wrap} onWrapChange={setWrap} />
          <CopyContentsButton text={() => codeText(data)} showLabel />
        </div>
      </DocToolbar>
      <CodeBody
        lines={lines}
        maxLineLength={data.maxLineLength}
        wrap={wrap}
        label={`Contents of ${name}`}
        activeLine={active}
        handleRef={body}
      />
      {truncated && <LoadMoreFooter loader={loader} downloadHref={downloadHref} />}
    </DocFrame>
  );
}

export function useMoreCode(initial: CodeData, truncated: boolean, downloadHref: string, onFirstChunk?: () => void) {
  const acc = useRef("");
  const [loaded, setLoaded] = useState<CodeData | null>(null);
  const loader = useTextLoader({
    downloadHref,
    enabled: truncated,
    onChunk: ({ text, first }) => {
      acc.current = first ? text : acc.current + text;
      setLoaded(plainCodeData(acc.current, initial));
      if (first) onFirstChunk?.();
    },
  });
  return { data: loaded ?? initial, loader };
}

export function CodeMeta({ data, className }: { data: CodeData; className?: string }) {
  return (
    <DocMeta className={className}>
      <span className="text-text-2">{plural(data.lineCount, "line")}</span>
      <MetaDot />
      {data.langLabel}
      {data.plainReason === "large" && (
        <span className="max-sm:hidden">
          <MetaDot />
          Highlighting is off for large files
        </span>
      )}
    </DocMeta>
  );
}

export function WrapToggle({ wrap, onWrapChange }: { wrap: boolean; onWrapChange: (wrap: boolean) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle size="sm" pressed={wrap} onPressedChange={onWrapChange} aria-label="Wrap long lines" className="gap-1.5">
          <WrapText aria-hidden strokeWidth={1.75} className="size-4" />
          <span className="max-sm:sr-only">Wrap</span>
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{wrap ? "Stop wrapping long lines" : "Wrap long lines"}</TooltipContent>
    </Tooltip>
  );
}

const LEVEL_UI: Record<LogLevel, { noun: string; icon: typeof CircleAlert; className: string }> = {
  error: { noun: "error", icon: CircleAlert, className: "text-danger hover:text-danger hover:bg-danger-mist" },
  warn: { noun: "warning", icon: TriangleAlert, className: "text-brand hover:text-brand hover:bg-brand-mist" },
};

function LogJumps({ lines, active, onJump }: { lines: CodeLines; active: number | null; onJump: (i: number) => void }) {
  const found = useMemo(() => {
    const out: Record<LogLevel, number[]> = { error: [], warn: [] };
    lines.levels?.forEach((l, i) => l && out[l].push(i));
    return out;
  }, [lines.levels]);

  const levels = (["error", "warn"] as const).filter((l) => found[l].length > 0);
  if (!levels.length) return null;

  return (
    <div className="flex items-center gap-0.5">
      {levels.map((level) => {
        const idx = found[level];
        const ui = LEVEL_UI[level];
        const Icon = ui.icon;
        const next = idx.find((i) => active === null || i > active) ?? idx[0];
        const pos = active !== null ? idx.indexOf(active) : -1;
        return (
          <Tooltip key={level}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn("tabular-nums", ui.className)}
                onClick={() => onJump(next)}
                aria-label={`${plural(idx.length, ui.noun)}. Jump to line ${next + 1}`}
              >
                <Icon aria-hidden data-icon="inline-start" strokeWidth={1.75} className="size-4" />
                {pos >= 0 ? `${pos + 1} of ${plural(idx.length, ui.noun)}` : plural(idx.length, ui.noun)}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Jump to the next {ui.noun} (line {next + 1})
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
