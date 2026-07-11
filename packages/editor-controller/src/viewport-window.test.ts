import { createTextDocument } from "@mewhhaha/wx-core";
import { describe, expect, it } from "vitest";

import { ViewportWindowModel } from "./viewport-window";

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");
}

describe("ViewportWindowModel", () => {
  it("keeps cursor-only window work independent of document size", () => {
    const visits = [1_000, 20_000].map((count) => {
      const doc = createTextDocument(lines(count));
      const model = new ViewportWindowModel({ doc, visibleRowCapacity: 100, softWrap: false, wrapColumns: 80 });
      model.visualIndex.resetCounters();
      expect(model.reveal(doc.lineAt(50).start, 3)).toBe(false);
      return model.visualIndex.counters.rowsVisited;
    });
    expect(visits).toEqual([1, 1]);
  });

  it("preserves the top source anchor for edits above, inside, and below the viewport", () => {
    const doc = createTextDocument(lines(30));
    const top = doc.lineAt(10).start;
    const model = new ViewportWindowModel({
      doc,
      visibleRowCapacity: 5,
      softWrap: false,
      wrapColumns: 80,
      topAnchorOffset: top
    });

    const above = { from: 0, to: 0, insert: "new\n" };
    const withAbove = doc.applyChanges([above]);
    model.configure({ doc: withAbove, changes: [above], documentRevision: 1 });
    expect(model.window.rows[0]?.docLine).toBe(11);
    expect(model.window.rows[0]?.segmentStart).toBe(top + above.insert.length);

    const belowOffset = withAbove.lineAt(25).start;
    const below = { from: belowOffset, to: belowOffset, insert: "tail " };
    const withBelow = withAbove.applyChanges([below]);
    const anchoredBeforeBelow = model.topAnchor.offset;
    model.configure({ doc: withBelow, changes: [below], documentRevision: 2 });
    expect(model.topAnchor.offset).toBe(anchoredBeforeBelow);

    const inside = { from: model.topAnchor.offset, to: model.topAnchor.offset + 2, insert: "replacement" };
    const withInside = withBelow.applyChanges([inside]);
    model.configure({ doc: withInside, changes: [inside], documentRevision: 3 });
    expect(model.topAnchor.offset).toBe(withInside.lineAt(11).start);
    expect(withInside.slice(model.window.rows[0]!.segmentStart, model.window.rows[0]!.segmentEnd)).toContain("replacement");
  });

  it("preserves a source anchor while wrap width changes", () => {
    const doc = createTextDocument("abcdefghij\nsecond");
    const model = new ViewportWindowModel({
      doc,
      visibleRowCapacity: 3,
      softWrap: true,
      wrapColumns: 5,
      topAnchorOffset: 5
    });
    expect(model.window.top).toEqual({ docLine: 0, wrapSegment: 1 });
    model.configure({ softWrap: true, wrapColumns: 3 });
    expect(model.window.top).toEqual({ docLine: 0, wrapSegment: 1 });
    expect(model.window.rows[0]?.segmentStart).toBe(3);
    expect(model.window.geometryGeneration).toBe(1);
  });

  it("scrolls, reveals, aligns, and moves with bounded windows", () => {
    const doc = createTextDocument(lines(40));
    const model = new ViewportWindowModel({ doc, visibleRowCapacity: 5, softWrap: false, wrapColumns: 80 });
    expect(model.scroll(10)).toBe(true);
    expect(model.window.top.docLine).toBe(10);
    expect(model.reveal(doc.lineAt(14).start, 1)).toBe(true);
    expect(model.window.top.docLine).toBe(11);
    expect(model.align(doc.lineAt(20).start, "center")).toBe(true);
    expect(model.window.top.docLine).toBe(18);
    expect(model.moveFromOffset(doc.lineAt(20).start, 3).docLine).toBe(23);
  });
});
