"use client";

import { memo, useDeferredValue, useMemo, useRef, useState } from "react";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DocMeta, MetaDot } from "./doc-chrome";
import { buildGrid, TYPE_LABEL, type GridColumn, type GridRow } from "./table-model";

const ROW_HEIGHT = 32;
const CELL_PAD_PX = 24;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const colIndex = (columnId: string) => Number(columnId.slice(1));

const cellIncludes = (row: { original: GridRow }, columnId: string, query: string): boolean =>
  row.original.lower[colIndex(columnId)].includes(query);

const numberSort = (a: { original: GridRow }, b: { original: GridRow }, columnId: string): number => {
  const i = colIndex(columnId);
  const x = a.original.nums[i];
  const y = b.original.nums[i];
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) ? (Number.isNaN(y) ? 0 : 1) : -1;
  return x - y;
};

const textSort = (a: { original: GridRow }, b: { original: GridRow }, columnId: string): number => {
  const i = colIndex(columnId);
  return collator.compare(a.original.cells[i], b.original.cells[i]);
};

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { cellIncludes },
});

const helper = createColumnHelper<typeof features, GridRow>();

export interface DataGridProps {
  header: string[];
  rows: string[][];
  footer?: React.ReactNode;
}

export function DataGrid({ header, rows: rawRows, footer }: DataGridProps) {
  const grid = useMemo(() => buildGrid(header, rawRows), [header, rawRows]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const columns = useMemo(
    () =>
      grid.columns.map((col) =>
        helper.accessor((r): unknown => (r.cells[col.index] === "" ? undefined : r.cells[col.index]), {
          id: col.id,
          header: col.label,
          sortFn: col.type === "number" ? numberSort : textSort,
          sortUndefined: "last",
          sortDescFirst: false,
          filterFn: cellIncludes,
          meta: col,
        }),
      ),
    [grid.columns],
  );

  const table = useTable<typeof features, GridRow, { sorting: unknown; globalFilter: unknown }>(
    {
      features,
      columns,
      data: grid.rows,
      state: { globalFilter: deferredQuery },
      globalFilterFn: "cellIncludes",
      getColumnCanGlobalFilter: () => true,
      enableSortingRemoval: true,
    },
    (state) => ({ sorting: state.sorting, globalFilter: state.globalFilter }),
  );

  const rows = table.getRowModel().rows;
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const numberDigits = String(grid.rows.length || 1).length;
  const numberColWidth = `calc(${Math.max(numberDigits, 2)}ch + ${CELL_PAD_PX}px)`;
  const tableWidth = `calc(${numberDigits}ch + ${grid.columns.reduce((s, c) => s + c.widthCh, 0)}ch + ${
    (grid.columns.length + 1) * CELL_PAD_PX
  }px)`;

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns unstable functions by design.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // Server render and first paint get a screenful of rows instead of an empty body.
    initialRect: { width: 1280, height: 900 },
    getItemKey: (i) => rows[i].id,
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  const filtered = deferredQuery.length > 0;
  const stale = query.trim().toLowerCase() !== deferredQuery;

  return (
    <>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-1 px-2 py-1.5 sm:px-3">
        <InputGroup className="h-8 w-full sm:w-64">
          <InputGroupAddon>
            <Search aria-hidden className="size-4" strokeWidth={1.75} />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Filter rows"
            aria-label="Filter rows"
            aria-controls="data-grid"
            spellCheck={false}
            autoComplete="off"
            className="[&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear filter"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                <X aria-hidden strokeWidth={1.75} />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <DocMeta className="max-sm:order-last max-sm:w-full">
          <span aria-live="polite" aria-atomic className={cn("text-text-2", stale && "opacity-70")}>
            {filtered
              ? `${rows.length.toLocaleString("en-US")} of ${plural(grid.rows.length, "row")}`
              : plural(grid.rows.length, "row")}
          </span>
          <MetaDot />
          {plural(grid.columns.length, "column")}
          {grid.raggedRows > 0 && (
            <>
              <MetaDot />
              <span title="Rows with a different number of cells than the header. Short rows are padded with blanks.">
                {plural(grid.raggedRows, "uneven row")}
              </span>
            </>
          )}
        </DocMeta>
      </div>

      <div
        ref={scrollRef}
        id="data-grid"
        role="region"
        aria-label="Table data"
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-surface-1 focus-visible:outline-offset-[-2px]"
      >
        <table
          aria-rowcount={rows.length + 1}
          aria-colcount={grid.columns.length + 1}
          className="table-fixed border-separate border-spacing-0 font-mono text-[13px] leading-5 [font-variant-ligatures:none]"
          style={{ width: `max(100%, ${tableWidth})` }}
        >
          <colgroup>
            <col style={{ width: numberColWidth }} />
            {grid.columns.map((c) => (
              <col key={c.id} style={{ width: `calc(${c.widthCh}ch + ${CELL_PAD_PX}px)` }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr aria-rowindex={1}>
              <th
                scope="col"
                className="sticky left-0 z-10 h-10 border-r border-b border-line-2 bg-surface-2 px-3 text-right font-sans text-xs font-medium text-text-3"
              >
                <span className="sr-only">Row number</span>
                <span aria-hidden>#</span>
              </th>
              {headers.map((header) => {
                const col = header.column.columnDef.meta as GridColumn;
                return (
                  <HeaderCell
                    key={header.id}
                    col={col}
                    sorted={header.column.getIsSorted()}
                    onSort={header.column.getToggleSortingHandler()}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr aria-hidden>
                <td colSpan={grid.columns.length + 1} style={{ height: padTop }} className="p-0" />
              </tr>
            )}
            {items.map((item) => {
              const row = rows[item.index];
              return (
                <DataRow
                  key={row.id}
                  row={row.original}
                  ariaIndex={item.index + 2}
                  columns={grid.columns}
                  query={deferredQuery}
                  headerCount={grid.headerCount}
                />
              );
            })}
            {padBottom > 0 && (
              <tr aria-hidden>
                <td colSpan={grid.columns.length + 1} style={{ height: padBottom }} className="p-0" />
              </tr>
            )}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="sticky left-0 flex flex-col items-center gap-3 px-6 py-14 text-center font-sans">
            {filtered ? (
              <>
                <SearchX aria-hidden className="size-5 text-text-3" strokeWidth={1.75} />
                <p className="text-sm text-text-2">
                  No rows match <span className="font-medium break-all text-text-1">&ldquo;{query.trim()}&rdquo;</span>.
                </p>
                <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                  Clear filter
                </Button>
              </>
            ) : (
              <p className="text-sm text-text-2">The file has a header row but no data rows.</p>
            )}
          </div>
        )}
      </div>
      {footer}
    </>
  );
}

function HeaderCell({
  col,
  sorted,
  onSort,
}: {
  col: GridColumn;
  sorted: false | "asc" | "desc";
  onSort: ((e: unknown) => void) | undefined;
}) {
  const numeric = col.type === "number";
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
  const next = sorted === "asc" ? "descending" : sorted === "desc" ? "original order" : "ascending";
  return (
    <th
      scope="col"
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
      className="h-10 border-r border-b border-line-2 bg-surface-2 p-0 text-left font-sans font-medium last:border-r-0"
    >
      <button
        type="button"
        onClick={onSort}
        title={`${col.label}. Sort ${next}.`}
        className={cn(
          "group/sort flex size-full min-w-0 items-center gap-1.5 px-3 text-[13px] text-text-1 transition-colors duration-150 hover:bg-surface-3 focus-visible:-outline-offset-2",
          numeric && "flex-row-reverse text-right",
        )}
      >
        <span className={cn("min-w-0 truncate", col.unnamed && "text-text-3 italic")}>{col.label}</span>
        <span className="shrink-0 font-mono text-[11px] font-normal text-text-3">{TYPE_LABEL[col.type]}</span>
        <Icon
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            "size-3.5 shrink-0",
            numeric ? "mr-auto" : "ml-auto",
            sorted ? "text-brand" : "text-text-3 opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
          )}
        />
      </button>
    </th>
  );
}

const DataRow = memo(function DataRow({
  row,
  ariaIndex,
  columns,
  query,
  headerCount,
}: {
  row: GridRow;
  ariaIndex: number;
  columns: GridColumn[];
  query: string;
  headerCount: number;
}) {
  return (
    <tr aria-rowindex={ariaIndex} className="group/row">
      <th
        scope="row"
        className="sticky left-0 z-10 h-8 border-r border-b border-line-2 bg-surface-1 px-3 text-right font-normal text-text-3 tabular-nums group-hover/row:bg-surface-2"
      >
        {row.n}
      </th>
      {columns.map((col) => {
        const value = row.cells[col.index];
        const missing = col.index >= row.given && col.index < headerCount;
        return (
          <td
            key={col.id}
            title={value.length > col.widthCh ? value : undefined}
            className={cn(
              "h-8 truncate border-r border-b border-line-1 px-3 text-text-1 last:border-r-0 group-hover/row:bg-surface-2",
              col.type === "number" && "text-right tabular-nums",
            )}
          >
            {missing ? (
              <span className="text-text-3" title="This row has no cell for this column">
                <span aria-hidden>—</span>
                <span className="sr-only">Missing</span>
              </span>
            ) : query ? (
              <Highlight text={value} query={query} />
            ) : (
              value
            )}
          </td>
        );
      })}
    </tr>
  );
});

function Highlight({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const at = lower.indexOf(query);
  if (at < 0 || !query) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-brand-mist text-brand ring-1 ring-brand-line">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}
