import { describe, expect, it } from "vitest";

import type { TextChange } from "@whx/editor-core";

import { advancePosition, applyTextChange, buildTreeEdit, positionAtOffset, rebaseTextChanges } from "./incrementalEdits";

describe("incremental tree-sitter edit helpers", () => {
  it("computes positions from offsets", () => {
    expect(positionAtOffset("ab\ncd\nef", 0)).toEqual({ row: 0, column: 0 });
    expect(positionAtOffset("ab\ncd\nef", 4)).toEqual({ row: 1, column: 1 });
    expect(positionAtOffset("ab\ncd\nef", 8)).toEqual({ row: 2, column: 2 });
  });

  it("advances positions across inserted newlines", () => {
    expect(advancePosition({ row: 2, column: 3 }, "xy")).toEqual({ row: 2, column: 5 });
    expect(advancePosition({ row: 2, column: 3 }, "\nxy\nz")).toEqual({ row: 4, column: 1 });
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
