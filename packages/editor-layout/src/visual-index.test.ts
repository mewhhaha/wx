import { createTextDocument } from "@mewhhaha/wx-core";
import { describe, expect, it } from "vitest";

import { createVisualLayoutIndex, visualRowKey } from "./visual-index";

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");
}

describe("sparse visual layout index", () => {
  it("visits bounded rows for the same unwrapped viewport at 1,000 and 20,000 lines", () => {
    const samples = [1_000, 20_000].map((lineCount) => {
      const doc = createTextDocument(lines(lineCount));
      const index = createVisualLayoutIndex({ doc, softWrap: false, wrapColumns: 80 });
      const anchor = doc.lineAt(500).start;
      index.resetCounters();
      const window = index.resolveWindow({ offset: anchor, affinity: "right" }, 0, 100, 0);
      return { window, counters: { ...index.counters } };
    });

    expect(samples[0]?.window.rows).toHaveLength(100);
    expect(samples[1]?.window.rows).toHaveLength(100);
    expect(samples[0]?.counters.rowsVisited).toBe(samples[1]?.counters.rowsVisited);
    expect(samples[1]?.counters.rowsVisited).toBeLessThanOrEqual(102);
    expect(samples[0]?.window.total).toEqual({ value: 1_000, exact: true });
    expect(samples[1]?.window.total).toEqual({ value: 20_000, exact: true });
  });

  it("resolves wrapped segments lazily with stable logical identities", () => {
    const doc = createTextDocument("abcdefghij\n短😀line\n");
    const index = createVisualLayoutIndex({ doc, softWrap: true, wrapColumns: 4, geometryGeneration: 3 });
    index.resetCounters();

    const first = index.resolveWindow({ offset: 0, affinity: "right" }, 0, 5, 0);
    expect(first.rows.map((row) => visualRowKey(row.id))).toEqual(["0:0", "0:1", "0:2", "1:0", "1:1"]);
    expect(first.rows.slice(0, 3).map((row) => [row.segmentStart, row.segmentEnd])).toEqual([
      [0, 4], [4, 8], [8, 10]
    ]);
    expect(first.total.exact).toBe(false);
    expect(first.geometryGeneration).toBe(3);
    expect(index.counters.mappingEntriesBuilt).toBeLessThanOrEqual(2);

    const emojiOffset = doc.text.indexOf("😀") + 2;
    expect(index.resolveOffset(emojiOffset).id).toEqual({ docLine: 1, wrapSegment: 0 });
  });

  it("moves across empty lines and exact wrap boundaries without duplicate rows", () => {
    const doc = createTextDocument("abcd\n\nabcdefgh");
    const index = createVisualLayoutIndex({ doc, softWrap: true, wrapColumns: 4 });
    const ids = [];
    let row = index.first();
    ids.push(visualRowKey(row.id));
    for (;;) {
      const next = index.move(row.id, 1);
      if (next.hitBoundary && visualRowKey(next.row.id) === visualRowKey(row.id)) break;
      row = next.row;
      ids.push(visualRowKey(row.id));
    }

    expect(ids).toEqual(["0:0", "1:0", "2:0", "2:1"]);
    expect(index.last().id).toEqual({ docLine: 2, wrapSegment: 1 });
  });

  it("invalidates only sparse mapping metadata when a document changes", () => {
    const doc = createTextDocument("alpha\nbeta");
    const index = createVisualLayoutIndex({ doc, documentRevision: 1, softWrap: true, wrapColumns: 3 });
    expect(index.resolveOffset(4).id).toEqual({ docLine: 0, wrapSegment: 1 });
    const next = doc.applyChanges([{ from: 0, to: 0, insert: "z" }]);
    index.applyChanges(next, [{ from: 0, to: 0, insert: "z" }], 2);
    index.resetCounters();
    expect(index.resolveOffset(5).id).toEqual({ docLine: 0, wrapSegment: 1 });
    expect(index.documentRevision).toBe(2);
    expect(index.counters.mappingEntriesBuilt).toBe(1);
  });
});
