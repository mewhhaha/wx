import { describe, expect, it } from "vitest";
import { createTextDocument, planIndentation } from "@mewhhaha/wx-core";
import { materializeIndentationFixture, sceneOrWgslCaptureFixtures, typescriptIndentationFixtures } from "./indentFixtures";
import { collectIndentCaptures, indentationQueryOffset, indentQueryRange, resolveIndentCaptures } from "./indentQuery";

describe("wx-indent-v1 capture model", () => {
  it("collapses same-line scopes and honors a single alignment anchor", () => {
    expect(resolveIndentCaptures([
      { name: "indent", from: 0, to: 20, startRow: 0, endRow: 2, startColumn: 0, patternIndex: 1 },
      { name: "indent", from: 2, to: 5, startRow: 0, endRow: 0, startColumn: 2, patternIndex: 2 },
      { name: "align", from: 0, to: 20, startRow: 0, endRow: 2, startColumn: 0, patternIndex: 3 },
      { name: "anchor", from: 3, to: 4, startRow: 0, endRow: 0, startColumn: 3, patternIndex: 3 }
    ], 4)).toEqual({ indent: 1, outdent: 0, alignColumn: 3 });
  });

  it("lets opaque regions suppress compound/struct captures", () => {
    expect(resolveIndentCaptures([
      { name: "indent", from: 0, to: 30, startRow: 0, endRow: 4, startColumn: 0, patternIndex: 1 },
      { name: "opaque", from: 4, to: 20, startRow: 1, endRow: 3, startColumn: 0, patternIndex: 2 },
      { name: "outdent", from: 0, to: 30, startRow: 0, endRow: 4, startColumn: 0, patternIndex: 3 }
    ], 8)).toEqual({ indent: 0, outdent: 0, opaque: true });
  });

  it("drives executable newline outcomes through the core planner", () => {
    for (const fixture of typescriptIndentationFixtures) {
      const { text, offset } = materializeIndentationFixture(fixture);
      const doc = createTextDocument(text);
      const plan = planIndentation(doc, [{ from: offset }], fixture.action, undefined, [fixture.expected.result]);
      expect(doc.applyChanges(plan.changes).text, fixture.name).toBe(fixture.expected.text);
      expect(plan.insertionOffsets[0], fixture.name).toBe(fixture.expected.cursor);
    }
    expect(sceneOrWgslCaptureFixtures).toEqual(["struct Light { | }", "compound { | }"]);
  });

  it("normalizes o/O to line query starts while Enter remains caret-split", () => {
    const text = "if (ready) {\r\n  value\r\n  }";
    for (const offset of [14, 18, 21]) expect(indentationQueryOffset(text, offset, "open-below")).toBe(21);
    for (const offset of [23, 25, 26]) expect(indentationQueryOffset(text, offset, "open-above")).toBe(25);
    expect(indentationQueryOffset(text, 18, "enter")).toBe(18);
  });

  it("bounds query work at the insertion point while retaining complete alignment matches", () => {
    expect(indentQueryRange(20_000 * 80, 800_000)).toEqual({ startIndex: 799_999, endIndex: 800_000 });
    expect(indentQueryRange(4, 4)).toEqual({ startIndex: 3, endIndex: 4 });
    expect(indentQueryRange(0, 0)).toBeNull();

    const captures = collectIndentCaptures([{
      patternIndex: 9,
      captures: [
        { name: "align", node: { startIndex: 5, endIndex: 30, startPosition: { row: 0, column: 5 }, endPosition: { row: 2, column: 1 } } },
        // The anchor lies outside a hypothetical local window around offset 25 but is retained
        // because workers flatten the complete match returned by Query.matches.
        { name: "anchor", node: { startIndex: 5, endIndex: 6, startPosition: { row: 0, column: 5 }, endPosition: { row: 0, column: 6 } } },
        { name: "unsupported", node: { startIndex: 0, endIndex: 40, startPosition: { row: 0, column: 0 }, endPosition: { row: 3, column: 0 } } }
      ]
    }]);
    expect(resolveIndentCaptures(captures, 25)).toEqual({ indent: 0, outdent: 0, alignColumn: 5 });
  });

  it("models TypeScript and WGSL/scene newline outcomes rather than only storing fixture strings", () => {
    const nested = resolveIndentCaptures([
      { name: "indent", from: 0, to: 40, startRow: 0, endRow: 3, startColumn: 0, patternIndex: 1 },
      { name: "indent", from: 12, to: 24, startRow: 1, endRow: 1, startColumn: 12, patternIndex: 2 },
      { name: "outdent", from: 24, to: 25, startRow: 1, endRow: 1, startColumn: 24, patternIndex: 3 }
    ], 24);
    expect(nested).toEqual({ indent: 1, outdent: 1 });

    const wgslCloser = resolveIndentCaptures([
      { name: "indent", from: 0, to: 18, startRow: 0, endRow: 2, startColumn: 0, patternIndex: 1 },
      { name: "outdent", from: 16, to: 17, startRow: 2, endRow: 2, startColumn: 0, patternIndex: 2 }
    ], 16);
    expect(wgslCloser).toEqual({ indent: 1, outdent: 1 });

    const inTemplate = resolveIndentCaptures([
      { name: "indent", from: 0, to: 50, startRow: 0, endRow: 4, startColumn: 0, patternIndex: 1 },
      { name: "opaque", from: 8, to: 30, startRow: 1, endRow: 2, startColumn: 2, patternIndex: 2 }
    ], 20);
    expect(inTemplate).toEqual({ indent: 0, outdent: 0, opaque: true });
  });
});
