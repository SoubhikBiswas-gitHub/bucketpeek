"use client";

import { useRef, useState } from "react";
import { Braces, ChevronsDownUp, ChevronsUpDown, ListTree } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { plural } from "@/lib/format";
import { CodeBody, useCodeLines } from "./code-body";
import { codeText, plainCodeData, type CodeData } from "./code-model";
import { CodeMeta, WrapToggle } from "./code-view";
import { CopyContentsButton } from "./copy-contents-button";
import { DocFrame, DocMeta, DocNotice, DocToolbar, MetaDot } from "./doc-chrome";
import { jsonShape, type JsonShape } from "./json-model";
import { JsonTree } from "./json-tree";
import { LoadMoreFooter } from "./load-more-footer";
import { useTextLoader } from "./use-text-loader";

export type RawOnlyReason = "truncated" | "invalid" | "primitive";

export interface JsonViewProps {
  value: object | null;
  shape: JsonShape | null;
  raw: CodeData;
  rawOnly: RawOnlyReason | null;
  parseError: string | null;
  truncated: boolean;
  downloadHref: string;
}

type Mode = "tree" | "raw";

type Doc = Pick<JsonViewProps, "value" | "shape" | "raw" | "rawOnly" | "parseError">;

export function JsonView({ truncated, downloadHref, ...initial }: JsonViewProps) {
  const [doc, setDoc] = useState<Doc>(initial);
  const { value, shape, raw, rawOnly, parseError } = doc;
  const hasTree = value !== null && shape !== null;
  const [mode, setMode] = useState<Mode>(hasTree ? "tree" : "raw");
  const [wrap, setWrap] = useState(raw.wrapDefault);
  // Remounting the tree is how @uiw/react-json-view applies a new `collapsed` depth.
  const [tree, setTree] = useState<{ collapsed: number | false; version: number }>({
    collapsed: shape?.initialDepth ?? 1,
    version: 0,
  });
  const lines = useCodeLines(raw);
  const copy = <CopyContentsButton text={() => codeText(raw)} label="Copy JSON" showLabel />;

  // Over the preview limit the tree needs the whole document: load it all, then parse.
  const acc = useRef("");
  const loader = useTextLoader({
    downloadHref,
    enabled: truncated,
    onChunk: ({ text, first, done }) => {
      acc.current = first ? text : acc.current + text;
      if (!done) return;
      try {
        const parsed: unknown = JSON.parse(acc.current);
        const pretty = JSON.stringify(parsed, null, 2);
        const next = plainCodeData(pretty, initial.raw);
        if (parsed !== null && typeof parsed === "object") {
          const s = jsonShape(parsed);
          setDoc({ value: parsed, shape: s, raw: next, rawOnly: null, parseError: null });
          setTree((t) => ({ collapsed: s.initialDepth, version: t.version + 1 }));
          setMode("tree");
        } else {
          setDoc({ value: null, shape: null, raw: next, rawOnly: "primitive", parseError: null });
        }
      } catch (e) {
        setDoc({
          value: null,
          shape: null,
          raw: plainCodeData(acc.current, initial.raw),
          rawOnly: "invalid",
          parseError: e instanceof Error ? e.message : null,
        });
      }
    },
  });

  const footer =
    rawOnly === "truncated" ? (
      <LoadMoreFooter
        loader={loader}
        downloadHref={downloadHref}
        variant="full"
        fullLabel="Load full file"
        message="Showing the first 512 KB as text. The tree view needs the whole file."
      />
    ) : rawOnly === "invalid" ? (
      <DocNotice downloadHref={truncated ? downloadHref : undefined}>
        This isn&apos;t valid JSON, so the tree view isn&apos;t available.
        {parseError && <span className="ml-1 font-mono text-xs text-text-3">{parseError}</span>}
      </DocNotice>
    ) : null;

  const rawBody = (
    <CodeBody lines={lines} maxLineLength={raw.maxLineLength} wrap={wrap} label="Raw JSON" />
  );

  if (!hasTree) {
    return (
      <DocFrame>
        <DocToolbar>
          {rawOnly === "primitive" ? (
            <DocMeta>
              <span className="text-text-2">Single value</span>
              <MetaDot />
              JSON
            </DocMeta>
          ) : (
            <CodeMeta data={raw} />
          )}
          <div className="ml-auto flex items-center gap-1">
            <WrapToggle wrap={wrap} onWrapChange={setWrap} />
            {copy}
          </div>
        </DocToolbar>
        {rawBody}
        {footer}
      </DocFrame>
    );
  }

  const setDepth = (collapsed: number | false) => setTree((t) => ({ collapsed, version: t.version + 1 }));

  return (
    <DocFrame>
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="flex min-h-0 flex-1 flex-col gap-0">
        <DocToolbar>
          <TabsList aria-label="JSON view">
            <TabsTrigger value="tree" className="px-2.5">
              <ListTree aria-hidden strokeWidth={1.75} />
              Tree
            </TabsTrigger>
            <TabsTrigger value="raw" className="px-2.5">
              <Braces aria-hidden strokeWidth={1.75} />
              Raw
            </TabsTrigger>
          </TabsList>
          {mode === "tree" ? (
            <DocMeta className="max-sm:hidden">
              <span className="text-text-2">{shape.root === "array" ? "Array" : "Object"}</span>
              <MetaDot />
              {shape.root === "array" ? plural(shape.size, "item") : plural(shape.size, "key")}
            </DocMeta>
          ) : (
            <CodeMeta data={raw} className="max-sm:hidden" />
          )}
          <div className="ml-auto flex items-center gap-1">
            {mode === "tree" ? (
              <ExpandToggle
                expanded={tree.collapsed === false}
                onExpandedChange={(expand) => setDepth(expand ? false : 1)}
                disabledReason={
                  shape.tooBigToExpandAll
                    ? `This file has ${shape.nodes.toLocaleString("en-US")} values, too many to expand at once. Open branches one at a time.`
                    : null
                }
              />
            ) : (
              <WrapToggle wrap={wrap} onWrapChange={setWrap} />
            )}
            {copy}
          </div>
        </DocToolbar>
        <TabsContent
          value="tree"
          forceMount
          className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 py-3 sm:px-4 data-[state=inactive]:hidden"
        >
          <JsonTree key={tree.version} value={value} collapsed={tree.collapsed} />
        </TabsContent>
        <TabsContent value="raw" forceMount className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          {rawBody}
        </TabsContent>
      </Tabs>
      {footer}
    </DocFrame>
  );
}

function ExpandToggle({
  expanded,
  onExpandedChange,
  disabledReason,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  disabledReason: string | null;
}) {
  const Icon = expanded ? ChevronsDownUp : ChevronsUpDown;
  // Too big to expand: still focusable (aria-disabled) so the reason is reachable; collapsing still works.
  const blocked = disabledReason !== null && !expanded;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={expanded}
          onPressedChange={(next) => {
            if (!blocked) onExpandedChange(next);
          }}
          aria-label="Expand all"
          aria-disabled={blocked || undefined}
          className="gap-1.5 aria-disabled:opacity-50 max-sm:size-7 max-sm:px-0"
        >
          <Icon aria-hidden strokeWidth={1.75} className="size-4" />
          <span className="max-sm:sr-only">{expanded ? "Collapse all" : "Expand all"}</span>
        </Toggle>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{blocked ? disabledReason : expanded ? "Collapse all" : "Expand all"}</TooltipContent>
    </Tooltip>
  );
}
