export interface JsonShape {
  root: "object" | "array";
  // Keys or items at the root.
  size: number;
  // Objects, arrays and values in the whole document.
  nodes: number;
  // Root = 1.
  depth: number;
  // `collapsed` depth for the tree so the first view stays readable.
  initialDepth: number;
  // Expanding everything this big would freeze the page.
  tooBigToExpandAll: boolean;
}

// Visible rows we aim for on first render.
const FIRST_VIEW_ROWS = 400;
export const EXPAND_ALL_LIMIT = 6_000;

export function jsonShape(value: object): JsonShape {
  // perLevel[d] = number of child rows that appear when level d is expanded.
  const perLevel: number[] = [];
  let nodes = 0;
  let depth = 1;
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length) {
    const [v, level] = stack.pop()!;
    nodes++;
    if (level > depth) depth = level;
    if (v && typeof v === "object") {
      const children = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
      perLevel[level] = (perLevel[level] ?? 0) + children.length;
      if (nodes > 200_000) break;
      for (const c of children) stack.push([c, level + 1]);
    }
  }

  let visible = 0;
  let initialDepth = 1;
  for (let d = 1; d <= Math.min(depth, 4); d++) {
    visible += perLevel[d] ?? 0;
    if (visible > FIRST_VIEW_ROWS && d > 1) break;
    initialDepth = d;
  }

  return {
    root: Array.isArray(value) ? "array" : "object",
    size: Array.isArray(value) ? value.length : Object.keys(value).length,
    nodes,
    depth,
    initialDepth,
    tooBigToExpandAll: nodes > EXPAND_ALL_LIMIT,
  };
}
