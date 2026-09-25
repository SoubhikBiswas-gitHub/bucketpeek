export type ColumnType = "number" | "date" | "boolean" | "text" | "empty";

export interface GridColumn {
  id: string;
  index: number;
  // "Column N" when the header cell is blank or missing.
  label: string;
  unnamed: boolean;
  type: ColumnType;
  // In `ch` of the monospace cell font, clamped.
  widthCh: number;
}

export interface GridRow {
  // 1-based data row number in the file (header excluded); stays with the row when sorting.
  n: number;
  cells: string[];
  lower: string[];
  // Parsed numbers for numeric columns (NaN when a cell isn't a number).
  nums: number[];
  // Cells the row actually had; later cells up to the header width were padded.
  given: number;
}

export interface Grid {
  columns: GridColumn[];
  rows: GridRow[];
  // Rows with fewer or more cells than the header.
  raggedRows: number;
  // Short rows are "missing" cells up to this width.
  headerCount: number;
}

const NUMBER = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const BOOLEAN = /^(?:true|false)$/i;
// Values that mean "no value" and shouldn't sway type detection.
const NULLISH = new Set(["", "na", "n/a", "null", "none", "nan", "-", "—"]);

export const TYPE_LABEL: Record<ColumnType, string> = {
  number: "number",
  date: "date",
  boolean: "boolean",
  text: "text",
  empty: "empty",
};

export const MIN_WIDTH_CH = 5;
export const MAX_WIDTH_CH = 44;

export function isNumeric(v: string): boolean {
  return /\d/.test(v) && NUMBER.test(v);
}

export function parseNumber(v: string): number {
  if (!isNumeric(v.trim())) return NaN;
  return Number(v.trim().replace(/,/g, ""));
}

function detectType(values: string[]): ColumnType {
  let seen = 0;
  let num = 0;
  let date = 0;
  let bool = 0;
  for (const raw of values) {
    const v = raw.trim();
    if (NULLISH.has(v.toLowerCase())) continue;
    seen++;
    if (isNumeric(v)) num++;
    else if (DATE.test(v)) date++;
    else if (BOOLEAN.test(v)) bool++;
  }
  if (!seen) return "empty";
  const share = (n: number) => n / seen >= 0.9;
  if (share(num)) return "number";
  if (share(date)) return "date";
  if (share(bool)) return "boolean";
  return "text";
}

// 95th-percentile length keeps one huge cell from making the whole column wide.
function typicalLength(values: string[]): number {
  if (!values.length) return 0;
  const lens = values.map((v) => v.length).sort((a, b) => a - b);
  return lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.95))];
}

export function buildGrid(header: string[], rows: string[][]): Grid {
  const width = Math.max(header.length, ...rows.map((r) => r.length), 0);
  let raggedRows = 0;

  const padded = rows.map((r) => {
    if (r.length !== header.length && header.length) raggedRows++;
    return r.length < width ? [...r, ...new Array<string>(width - r.length).fill("")] : r;
  });

  const columns: GridColumn[] = [];
  for (let i = 0; i < width; i++) {
    const name = (header[i] ?? "").trim();
    const label = name || `Column ${i + 1}`;
    const values = padded.map((r) => r[i]);
    const type = detectType(values);
    // Header text is proportional (narrower than mono) and sits beside a sort icon and type tag.
    const headerCh = Math.ceil(label.length * 0.95) + TYPE_LABEL[type].length + 5;
    const widthCh = Math.min(MAX_WIDTH_CH, Math.max(MIN_WIDTH_CH, headerCh, typicalLength(values) + 1));
    columns.push({ id: `c${i}`, index: i, label, unnamed: !name, type, widthCh });
  }

  const numericCols = columns.filter((c) => c.type === "number").map((c) => c.index);
  const gridRows: GridRow[] = padded.map((cells, idx) => {
    const nums = new Array<number>(width);
    for (const i of numericCols) nums[i] = parseNumber(cells[i]);
    return {
      n: idx + 1,
      cells,
      lower: cells.map((c) => c.toLowerCase()),
      nums,
      given: rows[idx].length,
    };
  });

  return { columns, rows: gridRows, raggedRows, headerCount: header.length };
}

