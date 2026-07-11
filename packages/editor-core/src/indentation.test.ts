import { describe, expect, it } from "vitest";
import { createTextDocument, getDocumentStorageStats } from "./document";
import { planIndentation, validateIndentationConfig } from "./indentation";

describe("planIndentation", () => {
  it("preserves CRLF, indents braces, and outdents a closer", () => {
    const doc = createTextDocument("if (x) {\r\n  }\r\n");
    const inside = planIndentation(doc, [{ from: 8 }], "enter");
    expect(inside.changes).toEqual([{ from: 8, to: 8, insert: "\r\n  " }]);
    const beforeCloser = planIndentation(doc, [{ from: 12 }], "enter");
    expect(beforeCloser.changes[0]?.insert).toBe("\r\n");
  });

  it("does not treat quoted or comment delimiters as syntax", () => {
    const doc = createTextDocument('  "{" // {');
    expect(planIndentation(doc, [{ from: doc.length }], "enter").changes[0]?.insert).toBe("\n  ");
  });

  it("deduplicates points while preserving mapping", () => {
    const doc = createTextDocument("x");
    const plan = planIndentation(doc, [{ from: 1 }, { from: 1 }], "enter", undefined, [], 1);
    expect(plan.changes).toHaveLength(1);
    expect(plan.insertionOffsets).toEqual([2, 2]);
    expect(plan.primaryIndex).toBe(1);
  });

  it("maps simultaneous cursors through every edit and keeps open-above cursors on the inserted line", () => {
    const doc = createTextDocument("  one\n  two");
    const entered = planIndentation(doc, [{ from: 5 }, { from: doc.length }], "enter", undefined, [], 1);
    expect(entered.changes).toEqual([
      { from: 5, to: 5, insert: "\n  " },
      { from: 11, to: 11, insert: "\n  " }
    ]);
    expect(entered.insertionOffsets).toEqual([8, 17]);
    expect(entered.primaryIndex).toBe(1);

    const above = planIndentation(doc, [{ from: 1 }, { from: 8 }], "open-above");
    expect(above.changes).toEqual([
      { from: 0, to: 0, insert: "  \n" },
      { from: 6, to: 6, insert: "  \n" }
    ]);
    expect(above.insertionOffsets).toEqual([2, 11]);
  });

  it("coalesces same-line open actions and intersecting replacement ranges", () => {
    const doc = createTextDocument("value\nnext");
    const below = planIndentation(doc, [{ from: 0 }, { from: 4 }], "open-below");
    expect(below.changes).toEqual([{ from: 5, to: 5, insert: "\n" }]);
    expect(below.insertionOffsets).toEqual([6, 6]);

    const overlapping = planIndentation(doc, [{ from: 1, to: 4 }, { from: 3, to: 7 }], "enter");
    expect(overlapping.changes).toEqual([{ from: 1, to: 7, insert: "\n" }]);
    expect(overlapping.insertionOffsets).toEqual([2, 2]);
  });

  it("keeps CRLF cursor mapping and exact tab alignment independent from guide width", () => {
    const doc = createTextDocument("\tcall(\r\n\t)\r\n");
    const plan = planIndentation(
      doc,
      [{ from: 6 }],
      "enter",
      { indentUnit: "\t", tabWidth: 4, guideWidth: 7 },
      [{ status: "ok", alignColumn: 6 }]
    );
    expect(plan.changes).toEqual([{ from: 6, to: 6, insert: "\r\n\t  " }]);
    expect(plan.insertionOffsets).toEqual([11]);
  });

  it("applies aligned outdent in visual-column space before rendering mixed tabs and spaces", () => {
    const doc = createTextDocument("\t  value");
    const tabs = planIndentation(
      doc,
      [{ from: doc.length }],
      "enter",
      { indentUnit: "\t", tabWidth: 4, guideWidth: 7 },
      [{ status: "ok", alignColumn: 6, outdent: 1 }]
    );
    expect(tabs.changes).toEqual([{ from: doc.length, to: doc.length, insert: "\n  " }]);

    const spaces = planIndentation(
      doc,
      [{ from: doc.length }],
      "enter",
      { indentUnit: "  ", tabWidth: 8, guideWidth: 3 },
      [{ status: "ok", alignColumn: 7, outdent: 2 }]
    );
    expect(spaces.changes[0]?.insert).toBe("\n   ");
  });

  it.each([undefined, "stale", "incomplete", "error"] as const)(
    "uses the plain-text fallback for provider status %s",
    (status) => {
      const doc = createTextDocument("if (ready) {");
      const hint = status === undefined ? undefined : { status, indent: 99, outdent: 99 };
      expect(planIndentation(doc, [{ from: doc.length }], "enter", undefined, [hint]).changes)
        .toEqual([{ from: doc.length, to: doc.length, insert: "\n  " }]);
    }
  );

  it("preserves nested indentation for open-below and outdents open-above at a closer", () => {
    const doc = createTextDocument("if (ready) {\n  value\n}");
    expect(planIndentation(doc, [{ from: doc.text.indexOf("value") }], "open-below").changes)
      .toEqual([{ from: 20, to: 20, insert: "\n  " }]);
    expect(planIndentation(doc, [{ from: doc.text.lastIndexOf("}") }], "open-above").changes)
      .toEqual([{ from: 21, to: 21, insert: "\n" }]);
  });

  it.each([
    { source: "a\nb", expected: "a\n\nb" },
    { source: "a\r\nb", expected: "a\r\n\r\nb" }
  ])("inserts open-below before the complete existing newline in $source", ({ source, expected }) => {
    const doc = createTextDocument(source);
    const plan = planIndentation(doc, [{ from: 0 }], "open-below");
    expect(doc.applyChanges(plan.changes).text).toBe(expected);
    expect(plan.insertionOffsets).toEqual([source.startsWith("a\r") ? 3 : 2]);
  });

  it.each([10, 11, 12])("makes open-below line-oriented before/on/after its opener at offset %i", (from) => {
    const doc = createTextDocument("if (ready) {\nnext");
    const plan = planIndentation(doc, [{ from }], "open-below");
    expect(doc.applyChanges(plan.changes).text).toBe("if (ready) {\n  \nnext");
  });

  it.each([13, 15, 16])("makes open-above closer handling line-oriented before/on/after its closer at offset %i", (from) => {
    const doc = createTextDocument("if (ready) {\n  }");
    const plan = planIndentation(doc, [{ from }], "open-above");
    expect(doc.applyChanges(plan.changes).text).toBe("if (ready) {\n\n  }");
  });

  it("keeps tabs, visual tab width, and guide width separate", () => {
    expect(validateIndentationConfig({ indentUnit: "\t", tabWidth: 8, guideWidth: 3 })).toEqual({ indentUnit: "\t", tabWidth: 8, guideWidth: 3 });
    expect(() => validateIndentationConfig({ indentUnit: "   ", tabWidth: 0, guideWidth: 2 })).toThrow(RangeError);
  });

  it("plans a 20k-line insertion without materializing per-line edits", () => {
    const doc = createTextDocument("  value\n".repeat(20_000));
    const started = performance.now();
    const plan = planIndentation(doc, [{ from: doc.length }], "enter");
    expect(plan.changes).toHaveLength(1);
    expect(getDocumentStorageStats(doc).textMaterialized).toBe(false);
    // P0-03's input budget is interactive; this guards against accidental document-wide edit plans.
    expect(performance.now() - started).toBeLessThan(100);
  });
});
