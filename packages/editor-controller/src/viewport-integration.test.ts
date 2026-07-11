import { createSelection } from "@mewhhaha/wx-core";
import { describe, expect, it } from "vitest";

import { createEditorController } from "./index";

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");
}

describe("viewport-scoped controller geometry", () => {
  it("keeps a 100-row viewport bounded for 1,000 and 20,000 unwrapped lines", async () => {
    for (const count of [1_000, 20_000]) {
      const controller = createEditorController({ value: lines(count) });
      controller.setViewportMetrics({ visibleRowCapacity: 100, wrapColumns: 100, softWrap: false });
      const before = controller.getPresentationState().viewport.visualRows;
      expect(before.length).toBeLessThanOrEqual(100);
      expect(controller.getPresentationState().viewport.totalVisualRows).toBe(count);
      expect(controller.getPresentationState().viewport.totalVisualRowsExact).toBe(true);

      await controller.handleKeyInput({ key: "j" });
      const after = controller.getPresentationState().viewport.visualRows;
      expect(after).toBe(before);
      expect(after.length).toBeLessThanOrEqual(100);
      expect(controller.getPresentationState().viewport.layoutWork).toMatchObject({
        reason: "reveal",
        rowsRebuilt: 0
      });
      expect(controller.getPresentationState().viewport.layoutWork!.rowsVisited).toBeLessThanOrEqual(3);
    }
  });

  it("preserves the visible source anchor across edits above, inside, and below", () => {
    const controller = createEditorController({ value: lines(30) });
    controller.setViewportMetrics({ visibleRowCapacity: 5, wrapColumns: 80, softWrap: false });
    const cursor = controller.getState().doc.lineAt(12).start;
    controller.dispatch({ selection: createSelection(cursor) });
    expect(controller.getPresentationState().viewport.visibleVisualRows[0]?.docLine).toBe(10);

    controller.dispatch({ changes: [{ from: 0, to: 0, insert: "new\n" }] });
    expect(controller.getPresentationState().viewport.visibleVisualRows[0]?.docLine).toBe(11);
    expect(controller.getState().doc.lineAt(11).text).toBe("line 10");

    const below = controller.getState().doc.lineAt(25).start;
    controller.dispatch({ changes: [{ from: below, to: below, insert: "tail " }] });
    expect(controller.getPresentationState().viewport.visibleVisualRows[0]?.docLine).toBe(11);
    expect(controller.getState().doc.lineAt(11).text).toBe("line 10");

    const inside = controller.getState().doc.lineAt(12).start;
    controller.dispatch({ changes: [{ from: inside, to: inside + 4, insert: "changed" }] });
    expect(controller.getPresentationState().viewport.visibleVisualRows[0]?.docLine).toBe(11);
  });

  it("keeps soft-wrapped rows and multiple selections within the bounded window", () => {
    const value = `${"abcdefghij".repeat(20)}\nsecond\nthird`;
    const controller = createEditorController({ value });
    controller.setViewportMetrics({ visibleRowCapacity: 8, wrapColumns: 10, softWrap: true });
    controller.replaceState({
      ...controller.getState(),
      mode: "visual",
      selection: {
        ranges: [createSelection(2, 25).ranges[0]!, createSelection(value.indexOf("second"), value.indexOf("third") - 2).ranges[0]!],
        primaryIndex: 1
      }
    });

    const narrow = controller.getPresentationState().viewport.visibleVisualRows;
    expect(narrow.length).toBeLessThanOrEqual(8);
    expect(narrow.some((row) => row.isContinuation)).toBe(true);
    expect(controller.getPresentationState().viewport.totalVisualRowsExact).toBe(false);
    controller.setViewportMetrics({ visibleRowCapacity: 8, wrapColumns: 20, softWrap: true });
    const wide = controller.getPresentationState().viewport.visibleVisualRows;
    expect(wide.length).toBeLessThanOrEqual(8);
    const activeOffset = controller.getState().selection.ranges[controller.getState().selection.primaryIndex]!.head;
    expect(wide.some((row) => activeOffset >= row.segmentStart && activeOffset <= row.segmentEnd)).toBe(true);
  });
});
