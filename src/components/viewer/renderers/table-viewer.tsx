import { DocFrame, EmptyDocument } from "@/components/viewer/documents/doc-chrome";
import { TableView } from "@/components/viewer/documents/table-view";

export interface TableViewerProps {
  header: string[];
  rows: string[][];
  truncated: boolean;
  rowsTruncated: boolean;
  downloadHref: string;
}

export function TableViewer({ header, rows, truncated, rowsTruncated, downloadHref }: TableViewerProps) {
  const width = Math.max(header.length, ...rows.map((r) => r.length), 0);
  if (width === 0) {
    return (
      <DocFrame>
        <EmptyDocument description="There are no rows or columns to show." />
      </DocFrame>
    );
  }

  return (
    <DocFrame>
      <TableView header={header} rows={rows} truncated={truncated} rowsTruncated={rowsTruncated} downloadHref={downloadHref} />
    </DocFrame>
  );
}
