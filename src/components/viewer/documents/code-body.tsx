"use client";

import { memo, useEffect, useImperativeHandle, useMemo, useRef, type CSSProperties, type Ref } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import {
  LOG_STYLES,
  logLevelOf,
  logSegments,
  splitLines,
  VIRTUALIZE_AT_LINES,
  lineTextOf,
  type CodeData,
  type CodeStyle,
  type CodeToken,
  type LogLevel,
} from "./code-model";

const ROW_HEIGHT = 20;
const PAD_Y = 8;

export interface CodeBodyHandle {
  // 0-based; centers the line in the view.
  scrollToLine: (index: number) => void;
}

export interface CodeLines {
  count: number;
  // Built lazily, only where needed.
  plain: string[] | null;
  tokens: CodeToken[][] | null;
  styles: CodeStyle[];
  levels: (LogLevel | null)[] | null;
}

export function useCodeLines(data: CodeData): CodeLines {
  return useMemo(() => {
    const tokens = data.tokens?.lines ?? null;
    const plain = data.text !== null && data.lineCount ? splitLines(data.text) : data.text !== null ? [] : null;
    const count = tokens ? tokens.length : (plain?.length ?? 0);
    let levels: (LogLevel | null)[] | null = null;
    if (data.log) {
      levels = new Array(count);
      for (let i = 0; i < count; i++) levels[i] = logLevelOf(plain ? plain[i] : lineTextOf(tokens![i]));
    }
    return { count, plain, tokens, styles: data.tokens?.styles ?? [], levels };
  }, [data]);
}

export interface CodeBodyProps {
  lines: CodeLines;
  maxLineLength: number;
  wrap: boolean;
  // Accessible name of the scroll region.
  label: string;
  // 0-based line to mark as the jump target.
  activeLine?: number | null;
  handleRef?: Ref<CodeBodyHandle>;
  className?: string;
}

// The line-number gutter is unselectable and hidden from assistive tech, so copying yields just the code.
export function CodeBody({ lines, maxLineLength, wrap, label, activeLine, handleRef, className }: CodeBodyProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = lines.count > VIRTUALIZE_AT_LINES;
  const digits = String(Math.max(lines.count, 1)).length;
  const gutter = `calc(${Math.max(digits, 2)}ch + 1.75rem)`;
  const minWidth = wrap ? undefined : `calc(${gutter} + ${maxLineLength}ch + 2.5rem)`;

  const logPlain = !!lines.levels && !lines.tokens;
  const styleObjects = useMemo(
    () =>
      (logPlain ? LOG_STYLES : lines.styles).map(
        (s): CSSProperties => ({
          color: s.color,
          fontStyle: s.italic ? "italic" : undefined,
          fontWeight: s.bold ? 600 : undefined,
        }),
      ),
    [lines.styles, logPlain],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns unstable functions by design.
  const virtualizer = useVirtualizer({
    count: lines.count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24,
    // Server render and first paint get a screenful of rows instead of an empty body.
    initialRect: { width: 1280, height: 900 },
    paddingStart: PAD_Y,
    paddingEnd: PAD_Y,
    enabled: virtual,
  });

  // Wrapped rows have variable heights; re-measure whenever wrapping flips.
  useEffect(() => {
    if (virtual) virtualizer.measure();
  }, [wrap, virtual, virtualizer]);

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToLine(index: number) {
        const el = scrollRef.current;
        if (!el) return;
        if (virtual) {
          virtualizer.scrollToIndex(index, { align: "center" });
          return;
        }
        const row = el.querySelector<HTMLElement>(`[data-line="${index + 1}"]`);
        if (row) el.scrollTo({ top: Math.max(0, row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2) });
      },
    }),
    [virtual, virtualizer],
  );

  const row = (index: number, extra?: { style?: CSSProperties; measure?: boolean }) => (
    <CodeRow
      key={index}
      index={index}
      gutter={gutter}
      wrap={wrap}
      plain={lines.plain ? lines.plain[index] : null}
      tokens={lines.tokens ? lines.tokens[index] : logPlain ? logSegments(lines.plain![index]) : null}
      styles={styleObjects}
      level={lines.levels?.[index] ?? null}
      active={activeLine === index}
      style={extra?.style}
      measureRef={extra?.measure ? virtualizer.measureElement : undefined}
    />
  );

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "relative min-h-0 flex-1 overflow-auto overscroll-contain bg-surface-1 font-mono text-[13px] leading-5 text-(--syntax-fg) [font-variant-ligatures:none] [tab-size:4] focus-visible:outline-offset-[-2px]",
        className,
      )}
    >
      {virtual ? (
        <div style={{ height: virtualizer.getTotalSize(), minWidth }} className="relative w-full">
          {virtualizer.getVirtualItems().map((item) =>
            row(item.index, {
              measure: wrap,
              style: { position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` },
            }),
          )}
        </div>
      ) : (
        <div style={{ minWidth, paddingBlock: PAD_Y }}>{Array.from({ length: lines.count }, (_, i) => row(i))}</div>
      )}
    </div>
  );
}

interface CodeRowProps {
  index: number;
  gutter: string;
  wrap: boolean;
  plain: string | null;
  tokens: CodeToken[] | null;
  styles: CSSProperties[];
  level: LogLevel | null;
  active: boolean;
  style?: CSSProperties;
  measureRef?: (node: HTMLDivElement | null) => void;
}

const LEVEL_ROW: Record<LogLevel, string> = {
  error: "bg-danger-mist",
  warn: "bg-brand-mist",
};

const LEVEL_GUTTER: Record<LogLevel, CSSProperties> = {
  error: {
    background: "linear-gradient(var(--danger-mist), var(--danger-mist)), var(--surface-1)",
    boxShadow: "inset 2px 0 0 var(--danger)",
    color: "var(--danger)",
  },
  warn: {
    background: "linear-gradient(var(--brand-mist), var(--brand-mist)), var(--surface-1)",
    boxShadow: "inset 2px 0 0 var(--brand)",
    color: "var(--brand)",
  },
};

const CodeRow = memo(function CodeRow({
  index,
  gutter,
  wrap,
  plain,
  tokens,
  styles,
  level,
  active,
  style,
  measureRef,
}: CodeRowProps) {
  return (
    <div
      ref={measureRef}
      data-index={index}
      data-line={index + 1}
      data-level={level ?? undefined}
      style={style}
      className={cn(
        "flex min-h-5 hover:bg-surface-2/70",
        level && LEVEL_ROW[level],
        active && "bg-surface-3! outline outline-1 -outline-offset-1 outline-line-3",
      )}
    >
      <span
        aria-hidden
        style={{ width: gutter, ...(level ? LEVEL_GUTTER[level] : null) }}
        className="sticky left-0 z-1 shrink-0 border-r border-line-1 bg-surface-1 pr-3 pl-2 text-right text-text-3 tabular-nums select-none"
      >
        {index + 1}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 pr-6 pl-4",
          wrap ? "break-words whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre",
          level === "error" && "text-text-1",
        )}
      >
        {tokens
          ? tokens.map(([text, s], i) =>
              s < 0 ? (
                text
              ) : (
                <span key={i} style={styles[s]}>
                  {text}
                </span>
              ),
            )
          : plain}
      </span>
    </div>
  );
});
