import { describe, expect, it } from "vitest";

import type { TextChange } from "@mewhhaha/wx-core";

import { advancePosition, applyTextChange, buildTreeEdit, positionAtOffset, rebaseTextChanges } from "./incrementalEdits";

describe("incremental tree-sitter edit helpers", () => {
  it("computes positions from offsets", () => {
    expect(positionAtOffset("ab\ncd\nef", 0)).toEqual({ row: 0, column: 0 });
    expect(positionAtOffset("ab\ncd\nef", 4)).toEqual({ row: 1, column: 1 });
    expect(positionAtOffset("ab\ncd\nef", 8)).toEqual({ row: 2, column: 2 });
  });

  it("computes web-tree-sitter UTF-16 columns from document offsets", () => {
    expect(positionAtOffset("éα\n😀x", 2)).toEqual({ row: 0, column: 2 });
    expect(positionAtOffset("éα\n😀x", 5)).toEqual({ row: 1, column: 2 });
    expect(positionAtOffset("éα\n😀x", 6)).toEqual({ row: 1, column: 3 });
  });

  it("advances positions across inserted newlines", () => {
    expect(advancePosition({ row: 2, column: 3 }, "xy")).toEqual({ row: 2, column: 5 });
    expect(advancePosition({ row: 2, column: 3 }, "\nxy\nz")).toEqual({ row: 4, column: 1 });
  });

  it("advances web-tree-sitter UTF-16 columns across non-ASCII insertions", () => {
    expect(advancePosition({ row: 0, column: 2 }, "é😀")).toEqual({ row: 0, column: 5 });
    expect(advancePosition({ row: 0, column: 2 }, "é\nα")).toEqual({ row: 1, column: 1 });
  });

  it("builds tree edits for multiline insertions", () => {
    const edit = buildTreeEdit("import x;", {
      from: 6,
      to: 6,
      insert: "\nconst y = 1;"
    });

    expect(edit).toEqual({
      startIndex: 6,
      oldEndIndex: 6,
      newEndIndex: 19,
      startPosition: { row: 0, column: 6 },
      oldEndPosition: { row: 0, column: 6 },
      newEndPosition: { row: 1, column: 12 }
    });
  });

  it("builds tree edits in web-tree-sitter's UTF-16 coordinate space", () => {
    const edit = buildTreeEdit("aéα\n😀x", {
      from: 2,
      to: 6,
      insert: "β\nz"
    });

    expect(edit).toEqual({
      startIndex: 2,
      oldEndIndex: 6,
      newEndIndex: 5,
      startPosition: { row: 0, column: 2 },
      oldEndPosition: { row: 1, column: 2 },
      newEndPosition: { row: 1, column: 1 }
    });
  });

  it("rebases multiple changes into the evolving text coordinates", () => {
    const original: TextChange[] = [
      { from: 1, to: 1, insert: "X" },
      { from: 4, to: 5, insert: "YZ" }
    ];

    expect(rebaseTextChanges(original)).toEqual([
      { from: 1, to: 1, insert: "X" },
      { from: 5, to: 6, insert: "YZ" }
    ]);
  });

  it("applies rebased changes to reach the final text", () => {
    const originalText = "abcd";
    const original: TextChange[] = [
      { from: 1, to: 1, insert: "X" },
      { from: 3, to: 4, insert: "YZ" }
    ];

    let nextText = originalText;

    for (const change of rebaseTextChanges(original)) {
      nextText = applyTextChange(nextText, change);
    }

    expect(nextText).toBe("aXbcYZ");
  });
});
