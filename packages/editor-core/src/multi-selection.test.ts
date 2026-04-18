import { describe, expect, it } from "vitest";

import {
  applyTransaction,
  createEditorState,
  createSelection,
  createSelectionSet,
  deleteSelection,
  enterInsertMode,
  getSelectionRanges,
  insertText,
  moveDown,
  type Command,
  type Transaction
} from "./index";

function dispatchTransaction(state: { current: ReturnType<typeof createEditorState> }, transaction: Transaction): void {
  state.current = applyTransaction(state.current, transaction);
}

function run(state: { current: ReturnType<typeof createEditorState> }, command: Command): void {
  command(state.current, (transaction) => dispatchTransaction(state, transaction), {});
}

describe("multi-selection", () => {
  it("normalizes and preserves multiple ranges", () => {
    const state = createEditorState({
      value: "alpha beta gamma",
      selection: createSelectionSet([
        { anchor: 11, head: 14, preferredColumn: null },
        { anchor: 0, head: 4, preferredColumn: null },
        { anchor: 0, head: 4, preferredColumn: null }
      ], 1)
    });

    expect(state.selection.ranges).toHaveLength(2);
    expect(getSelectionRanges(state)).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 15 }
    ]);
    expect(state.selection.primaryIndex).toBe(0);
  });

  it("inserts text at every cursor in insert mode", () => {
    const state = {
      current: createEditorState({
        value: "abc\ndef",
        mode: "insert",
        selection: createSelectionSet([
          { anchor: 1, head: 1, preferredColumn: null },
          { anchor: 5, head: 5, preferredColumn: null }
        ])
      })
    };

    insertText("!")(state.current, (transaction) => dispatchTransaction(state, transaction), {});

    expect(state.current.doc.text).toBe("a!bc\nd!ef");
    expect(state.current.selection.ranges.map((range) => range.head)).toEqual([2, 7]);
  });

  it("deletes every selected range in one transaction", () => {
    const state = {
      current: createEditorState({
        value: "alpha beta gamma",
        selection: createSelectionSet([
          { anchor: 0, head: 4, preferredColumn: null },
          { anchor: 11, head: 15, preferredColumn: null }
        ])
      })
    };

    run(state, deleteSelection);

    expect(state.current.doc.text).toBe(" beta ");
    expect(getSelectionRanges(state.current)).toEqual([
      { from: 0, to: 1 },
      { from: 5, to: 6 }
    ]);
    expect(state.current.yankBuffer).toBe("alpha\ngamma");
  });

  it("moves all cursors vertically while preserving column", () => {
    const state = {
      current: createEditorState({
        value: "one\nthree\nfive",
        selection: createSelectionSet([
          { anchor: 1, head: 1, preferredColumn: null },
          { anchor: 5, head: 5, preferredColumn: null }
        ])
      })
    };

    run(state, moveDown);

    expect(state.current.doc.positionAt(state.current.selection.ranges[0]!.head)).toEqual({ line: 1, column: 1 });
    expect(state.current.doc.positionAt(state.current.selection.ranges[1]!.head)).toEqual({ line: 2, column: 1 });
  });

  it("enters insert mode for all active selections", () => {
    const state = {
      current: createEditorState({
        value: "abc def",
        selection: createSelectionSet([
          { anchor: 0, head: 2, preferredColumn: null },
          { anchor: 4, head: 6, preferredColumn: null }
        ])
      })
    };

    run(state, enterInsertMode);

    expect(state.current.mode).toBe("insert");
    expect(state.current.selection.ranges.map((range) => range.head)).toEqual([0, 4]);
  });
});
