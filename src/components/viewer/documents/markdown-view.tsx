"use client";

import { useState } from "react";
import { Code, Eye } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBody, useCodeLines } from "./code-body";
import { codeText, type CodeData } from "./code-model";
import { CodeMeta, useMoreCode, WrapToggle } from "./code-view";
import { CopyContentsButton } from "./copy-contents-button";
import { DocFrame, DocToolbar } from "./doc-chrome";
import { LoadMoreFooter } from "./load-more-footer";

export interface MarkdownViewProps {
  // Server-rendered Markdown.
  rendered: React.ReactNode;
  source: CodeData;
  truncated: boolean;
  downloadHref: string;
}

type Mode = "rendered" | "source";

// Both panes stay mounted so each keeps its scroll position.
export function MarkdownView({ rendered, source: initial, truncated, downloadHref }: MarkdownViewProps) {
  const [mode, setMode] = useState<Mode>("rendered");
  const [wrap, setWrap] = useState(initial.wrapDefault);
  // Extra text only reaches the Source view, so switch to it once more arrives.
  const { data: source, loader } = useMoreCode(initial, truncated, downloadHref, () => setMode("source"));
  const lines = useCodeLines(source);

  return (
    <DocFrame>
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="flex min-h-0 flex-1 flex-col gap-0">
        <DocToolbar>
          <TabsList aria-label="Markdown view">
            <TabsTrigger value="rendered" className="px-2.5">
              <Eye aria-hidden strokeWidth={1.75} />
              Rendered
            </TabsTrigger>
            <TabsTrigger value="source" className="px-2.5">
              <Code aria-hidden strokeWidth={1.75} />
              Source
            </TabsTrigger>
          </TabsList>
          {mode === "source" && <CodeMeta data={source} className="max-sm:hidden" />}
          <div className="ml-auto flex items-center gap-1">
            {mode === "source" && <WrapToggle wrap={wrap} onWrapChange={setWrap} />}
            <CopyContentsButton text={() => codeText(source)} label="Copy Markdown" showLabel />
          </div>
        </DocToolbar>
        <TabsContent
          value="rendered"
          forceMount
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain data-[state=inactive]:hidden"
        >
          {rendered}
        </TabsContent>
        <TabsContent value="source" forceMount className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <CodeBody lines={lines} maxLineLength={source.maxLineLength} wrap={wrap} label="Markdown source" />
        </TabsContent>
      </Tabs>
      {truncated && (
        <LoadMoreFooter
          loader={loader}
          downloadHref={downloadHref}
          message={mode === "rendered" ? "Showing the first 512 KB. Loading more adds it to the Source view." : undefined}
        />
      )}
    </DocFrame>
  );
}
