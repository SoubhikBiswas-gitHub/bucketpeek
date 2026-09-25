"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { DataGrid } from "./data-grid";
import { LoadMoreFooter } from "./load-more-footer";
import { keyFromDownloadHref, useTextLoader } from "./use-text-loader";

export interface TableViewProps {
  header: string[];
  rows: string[][];
  truncated: boolean;
  rowsTruncated: boolean;
  downloadHref: string;
}

export function TableView({ header: initialHeader, rows: initialRows, truncated, rowsTruncated, downloadHref }: TableViewProps) {
  const [table, setTable] = useState({ header: initialHeader, rows: initialRows });
  const remainder = useRef("");
  const partial = truncated || rowsTruncated;
  const delimiter = /\.tsv$/i.test(keyFromDownloadHref(downloadHref) ?? "") ? "\t" : "";

  const loader = useTextLoader({
    downloadHref,
    enabled: partial,
    onChunk: ({ text, first, done }) => {
      const input = (first ? "" : remainder.current) + text;
      const parsed: string[][] = [];
      const ends: number[] = [];
      Papa.parse<string[]>(input, {
        delimiter,
        skipEmptyLines: "greedy",
        step: (r) => {
          parsed.push(r.data);
          ends.push(r.meta.cursor);
        },
      });
      if (!done && parsed.length) {
        // The chunk may end mid-record; keep that record's text for the next round.
        parsed.pop();
        ends.pop();
        remainder.current = input.slice(ends.length ? ends[ends.length - 1] : 0);
      } else {
        remainder.current = "";
      }
      setTable((t) => {
        if (first) {
          const [header = [], ...rows] = parsed;
          return { header, rows };
        }
        return { header: t.header, rows: t.rows.concat(parsed) };
      });
    },
  });

  const footer = partial ? (
    <LoadMoreFooter
      loader={loader}
      downloadHref={downloadHref}
      variant={truncated ? "stream" : "full"}
      fullLabel={truncated ? "Load all" : "Load all rows"}
      message={`Showing the first ${initialRows.length.toLocaleString("en-US")} rows.`}
    />
  ) : null;

  return <DataGrid header={table.header} rows={table.rows} footer={footer} />;
}
