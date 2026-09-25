import { describe, expect, it } from "vitest";
import { logLevelOf, logSegments, measureLines, normalizeNewlines } from "./code-model";
import { jsonShape } from "./json-model";
import { buildGrid, parseNumber } from "./table-model";

describe("code model", () => {
  it("normalizes CRLF and drops one trailing newline", () => {
    expect(normalizeNewlines("a\r\nb\rc\n")).toBe("a\nb\nc");
    expect(normalizeNewlines("a\n\n")).toBe("a\n");
  });

  it("counts tabs as four columns", () => {
    expect(measureLines(["\tab", "abcd"])).toBe(6);
  });

  it("detects log levels without matching ordinary words", () => {
    expect(logLevelOf("2026-08-14 ERROR camera lost")).toBe("error");
    expect(logLevelOf('{"level":"warn","msg":"x"}')).toBe("warn");
    expect(logLevelOf("level=error msg=boom")).toBe("error");
    expect(logLevelOf("no error here, all good")).toBeNull();
    expect(logLevelOf("INFO upload complete")).toBeNull();
  });

  it("splits a log line into timestamp, level and rest", () => {
    const segs = logSegments("2026-08-14T09:00:01Z WARN disk at 81%");
    expect(segs.map((s) => s[0]).join("")).toBe("2026-08-14T09:00:01Z WARN disk at 81%");
    expect(segs[0]).toEqual(["2026-08-14T09:00:01Z", 0]);
    expect(segs.find((s) => s[0] === "WARN")?.[1]).toBe(2);
  });
});

describe("table model", () => {
  it("pads ragged rows, names blank headers and types columns", () => {
    const grid = buildGrid(["id", "", "score"], [["1", "a", "0.5"], ["2", "b"], ["3", "c", "1,250", "extra"]]);
    expect(grid.columns.map((c) => c.label)).toEqual(["id", "Column 2", "score", "Column 4"]);
    expect(grid.columns[1].unnamed).toBe(true);
    expect(grid.columns[0].type).toBe("number");
    expect(grid.columns[2].type).toBe("number");
    expect(grid.rows[1].cells).toEqual(["2", "b", "", ""]);
    expect(grid.rows[1].given).toBe(2);
    expect(grid.raggedRows).toBe(2);
    expect(grid.rows[2].nums[2]).toBe(1250);
  });

  it("ignores null-like values when detecting types", () => {
    const grid = buildGrid(["t"], [["2026-08-01"], ["NA"], [""], ["2026-08-02T10:00:00Z"]]);
    expect(grid.columns[0].type).toBe("date");
  });

  it("parses only real numbers", () => {
    expect(parseNumber("-1.5e3")).toBe(-1500);
    expect(Number.isNaN(parseNumber("12abc"))).toBe(true);
    expect(Number.isNaN(parseNumber("."))).toBe(true);
  });

  it("clamps very wide columns", () => {
    const grid = buildGrid(["notes"], [["x".repeat(5000)]]);
    expect(grid.columns[0].widthCh).toBeLessThanOrEqual(44);
  });
});

describe("json model", () => {
  it("describes the root and picks a readable initial depth", () => {
    const shape = jsonShape({ a: 1, b: { c: [1, 2, 3] } });
    expect(shape.root).toBe("object");
    expect(shape.size).toBe(2);
    expect(shape.depth).toBe(4);
    expect(shape.initialDepth).toBeGreaterThanOrEqual(1);
    expect(shape.tooBigToExpandAll).toBe(false);
  });

  it("keeps huge arrays collapsed", () => {
    const shape = jsonShape(Array.from({ length: 3000 }, (_, i) => ({ i, tags: ["a", "b"] })));
    expect(shape.initialDepth).toBe(1);
    expect(shape.tooBigToExpandAll).toBe(true);
  });
});
