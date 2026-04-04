import { describe, expect, it } from "vitest";

import {
  applyTransaction,
  appendInsertMode,
  changeSelection,
  type Command,
  createEditorState,
  createSelection,
  createTextDocument,
  deleteBackward,
  deleteBackwardIndentAware,
  deleteSelection,
  deleteForward,
  enterInsertMode,
  enterNormalMode,
  getSelectionOffsets,
  getCursorOffset,
  gotoMatchingBracket,
  gotoNextParagraph,
  gotoPrevParagraph,
  gotoWindowBottom,
  gotoWindowCenter,
  gotoWindowTop,
  halfPageDown,
  halfPageUp,
  insertNewline,
  insertText,
  findNextChar,
  findPrevChar,
  findTillNextChar,
  findTillPrevChar,
  moveDown,
  moveNextLongWordEnd,
  moveNextLongWordStart,
  moveNextWordStart,
  movePrevLongWordStart,
  moveWordBackward,
  moveWordForward,
  moveLeft,
  moveRight,
  moveUp,
  openAbove,
  openBelow,
  pageDown,
  pageUp,
  pasteAfter,
  gotoFileStart,
  gotoFirstNonWhitespace,
  gotoLastLine,
  gotoLineEnd,
  gotoLineStart,
  selectAll,
  selectLineBelow,
  selectTextobject,
  toggleVisualMode,
  redo,
  undo,
  yankSelection,
  type Transaction
} from "./index";

function dispatchTransaction(state: { current: ReturnType<typeof createEditorState> }, transaction: Transaction): void {
  state.current = applyTransaction(state.current, transaction);
}

function run(
  state: { current: ReturnType<typeof createEditorState> },
  command: Command,
  viewport: { fromLine: number; toLine: number; visibleLineCount: number } | undefined = undefined
): void {
  command(state.current, (transaction) => dispatchTransaction(state, transaction), { viewport });
}

describe("editor core", () => {
  it("starts with a character selection in normal mode", () => {
    const state = createEditorState({ value: "abc" });
    expect(getSelectionOffsets(state)).toEqual({ from: 0, to: 1 });
    expect(getCursorOffset(state.selection)).toBe(0);
  });

  it("inserts text and newline in insert mode", () => {
    const state = { current: createEditorState({ value: "abc", mode: "insert", selection: createSelection(3) }) };
    insertText("d")(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    insertNewline(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    insertText("x")(state.current, (transaction) => dispatchTransaction(state, transaction), {});

    expect(state.current.doc.text).toBe("abcd\nx");
    expect(getCursorOffset(state.current.selection)).toBe(6);
  });

  it("deletes backward and forward", () => {
    const state = { current: createEditorState({ value: "abcd", mode: "insert", selection: createSelection(2) }) };
    deleteBackward(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    deleteForward(state.current, (transaction) => dispatchTransaction(state, transaction), {});

    expect(state.current.doc.text).toBe("ad");
    expect(getCursorOffset(state.current.selection)).toBe(1);
  });

  it("deletes back to the previous soft-tab stop in leading whitespace", () => {
    const state = { current: createEditorState({ value: "    ", mode: "insert", selection: createSelection(4) }) };

    deleteBackwardIndentAware("  ")(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    expect(state.current.doc.text).toBe("  ");
    expect(getCursorOffset(state.current.selection)).toBe(2);

    deleteBackwardIndentAware("  ")(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    expect(state.current.doc.text).toBe("");
    expect(getCursorOffset(state.current.selection)).toBe(0);
  });

  it("falls back to single-character backspace after non-whitespace", () => {
    const state = { current: createEditorState({ value: "  a", mode: "insert", selection: createSelection(3) }) };

    deleteBackwardIndentAware("  ")(state.current, (transaction) => dispatchTransaction(state, transaction), {});

    expect(state.current.doc.text).toBe("  ");
    expect(getCursorOffset(state.current.selection)).toBe(2);
  });

  it("deletes the current selection in normal mode", () => {
    const state = { current: createEditorState({ value: "abcd", selection: createSelection(1, 2) }) };

    run(state, deleteSelection);

    expect(state.current.doc.text).toBe("ad");
    expect(state.current.mode).toBe("normal");
    expect(state.current.yankBuffer).toBe("bc");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 2 });
  });

  it("changes the current selection and enters insert mode", () => {
    const state = { current: createEditorState({ value: "abcd", selection: createSelection(1, 2) }) };

    run(state, changeSelection);

    expect(state.current.doc.text).toBe("ad");
    expect(state.current.mode).toBe("insert");
    expect(state.current.yankBuffer).toBe("bc");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 1 });
    expect(state.current.insertSession).toEqual({
      restoreOffset: 1,
      restoreAffinity: "left",
      moved: false
    });
  });

  it("restores deleted text with d followed by p", () => {
    const state = { current: createEditorState({ value: "abcd", selection: createSelection(1, 2) }) };

    run(state, deleteSelection);
    run(state, pasteAfter);

    expect(state.current.doc.text).toBe("abcd");
    expect(state.current.yankBuffer).toBe("bc");
  });

  it("undoes and redoes document changes with u and U", () => {
    let undid = false;
    let redid = false;
    const state = { current: createEditorState({ value: "abc" }) };

    undo(state.current, () => {}, {
      history: {
        undo() {
          undid = true;
          return true;
        },
        redo() {
          return false;
        }
      }
    });
    redo(state.current, () => {}, {
      history: {
        undo() {
          return false;
        },
        redo() {
          redid = true;
          return true;
        }
      }
    });

    expect(undid).toBe(true);
    expect(redid).toBe(true);
  });

  it("moves across lines with clamping", () => {
    const state = {
      current: createEditorState({
        selection: createSelection(0),
        value: "abc\nx\nlong"
      })
    };

    moveRight(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    moveRight(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    moveDown(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    moveDown(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    moveUp(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    moveLeft(state.current, (transaction) => dispatchTransaction(state, transaction), {});

    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection))).toEqual({ line: 0, column: 3 });
    expect(getSelectionOffsets(state.current)).toEqual({ from: 3, to: 4 });
  });

  it("switches between normal, visual, and insert modes", () => {
    const state = { current: createEditorState({ value: "abc" }) };
    enterInsertMode(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    expect(state.current.mode).toBe("insert");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 0 });
    enterNormalMode(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    expect(state.current.mode).toBe("normal");
    toggleVisualMode(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    expect(state.current.mode).toBe("visual");
    toggleVisualMode(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    expect(state.current.mode).toBe("normal");
  });

  it("applies transactions and increments revision", () => {
    const doc = createTextDocument("hello");
    const initial = createEditorState({ value: doc.text });
    const next = applyTransaction(initial, {
      changes: [{ from: 5, to: 5, insert: " world" }]
    });

    expect(next.doc.text).toBe("hello world");
    expect(next.revision).toBe(1);
  });

  it("enters insert after the current selection with a", () => {
    const state = { current: createEditorState({ value: "abc" }) };
    run(state, moveRight);
    run(state, appendInsertMode);

    expect(state.current.mode).toBe("insert");
    expect(getCursorOffset(state.current.selection)).toBe(2);
    insertText("x")(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    expect(state.current.doc.text).toBe("abxc");
  });

  it("restores the same glyph after i then escape", () => {
    const state = { current: createEditorState({ value: "abc", selection: createSelection(1, 1) }) };

    run(state, enterInsertMode);
    expect(getCursorOffset(state.current.selection)).toBe(1);
    run(state, enterNormalMode);

    expect(state.current.mode).toBe("normal");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 2 });
    expect(getCursorOffset(state.current.selection)).toBe(1);
  });

  it("restores the same glyph after i inserts before it", () => {
    const state = { current: createEditorState({ value: "abc", selection: createSelection(1, 1) }) };

    run(state, enterInsertMode);
    insertText("X")(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    run(state, enterNormalMode);

    expect(state.current.doc.text).toBe("aXbc");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 2, to: 3 });
  });

  it("restores the same glyph after a then escape", () => {
    const state = { current: createEditorState({ value: "abc", selection: createSelection(1, 1) }) };

    run(state, appendInsertMode);
    expect(getCursorOffset(state.current.selection)).toBe(2);
    run(state, enterNormalMode);

    expect(state.current.mode).toBe("normal");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 2 });
  });

  it("restores the same glyph after a inserts after it", () => {
    const state = { current: createEditorState({ value: "abc", selection: createSelection(1, 1) }) };

    run(state, appendInsertMode);
    insertText("X")(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    run(state, enterNormalMode);

    expect(state.current.doc.text).toBe("abXc");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 2 });
  });

  it("falls back to the insertion point neighborhood after moving in insert mode", () => {
    const state = { current: createEditorState({ value: "abc", selection: createSelection(1, 1) }) };

    run(state, appendInsertMode);
    run(state, moveRight);
    run(state, enterNormalMode);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 2, to: 3 });
  });

  it("keeps the cursor on the same line when escaping insert mode at column zero", () => {
    const state = {
      current: createEditorState({
        value: "alpha\nbeta",
        mode: "insert",
        selection: createSelection(6, 6)
      })
    };

    state.current = applyTransaction(state.current, {
      insertSession: {
        restoreOffset: 2,
        restoreAffinity: "right",
        moved: true
      }
    });

    run(state, enterNormalMode);

    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection))).toEqual({ line: 1, column: 0 });
    expect(getSelectionOffsets(state.current)).toEqual({ from: 6, to: 7 });
  });

  it("opens a new line below with o and enters insert mode there", () => {
    const state = { current: createEditorState({ value: "alpha\nbeta", selection: createSelection(1, 1) }) };

    run(state, openBelow);

    expect(state.current.mode).toBe("insert");
    expect(state.current.doc.text).toBe("alpha\n\nbeta");
    expect(getCursorOffset(state.current.selection)).toBe(6);
  });

  it("opens a new line above with O and enters insert mode there", () => {
    const state = { current: createEditorState({ value: "alpha\nbeta", selection: createSelection(7, 7) }) };

    run(state, openAbove);

    expect(state.current.mode).toBe("insert");
    expect(state.current.doc.text).toBe("alpha\n\nbeta");
    expect(getCursorOffset(state.current.selection)).toBe(6);
  });

  it("keeps the inserted line selected after o then Escape", () => {
    const state = { current: createEditorState({ value: "alpha\nbeta", selection: createSelection(1, 1) }) };

    run(state, openBelow);
    run(state, enterNormalMode);

    expect(state.current.mode).toBe("normal");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 6, to: 7 });
  });

  it("keeps typed text on the inserted line selected after O then Escape", () => {
    const state = { current: createEditorState({ value: "alpha\nbeta", selection: createSelection(7, 7) }) };

    run(state, openAbove);
    insertText("z")(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    run(state, enterNormalMode);

    expect(state.current.doc.text).toBe("alpha\nz\nbeta");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 6, to: 7 });
  });

  it("selects the current line and extends downward with x", () => {
    const state = { current: createEditorState({ value: "alpha\nbeta\ngamma", selection: createSelection(1, 1) }) };

    run(state, selectLineBelow);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 6 });

    run(state, selectLineBelow);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 11 });
  });

  it("extends selection with visual h j k l motions", () => {
    const state = { current: createEditorState({ value: "abcd\nefgh" }) };
    run(state, toggleVisualMode);
    run(state, moveRight);
    run(state, moveRight);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 3 });
    run(state, moveDown);
    expect(state.current.mode).toBe("visual");
    expect(getSelectionOffsets(state.current).from).toBe(0);
  });

  it("moves h and l by one glyph in normal mode", () => {
    const state = { current: createEditorState({ value: "abcd", selection: createSelection(1, 1) }) };

    run(state, moveLeft);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 1 });
    run(state, moveRight);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 2 });
  });

  it("moves j and k by preferred column in normal mode", () => {
    const state = { current: createEditorState({ value: "abcd\nxy\nmnop", selection: createSelection(2, 2) }) };

    run(state, moveDown);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection))).toEqual({ line: 1, column: 1 });
    run(state, moveDown);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection))).toEqual({ line: 2, column: 2 });
    run(state, moveUp);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection))).toEqual({ line: 1, column: 1 });
  });

  it("selects the whole document with %", () => {
    const state = { current: createEditorState({ value: "abc\ndef", selection: createSelection(2, 2) }) };

    run(state, selectAll);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 7 });
  });

  it("goes to file start with gg", () => {
    const state = { current: createEditorState({ value: "abc\ndef", selection: createSelection(5, 5) }) };

    run(state, gotoFileStart);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 1 });
  });

  it("goes to the last non-empty line with ge", () => {
    const state = { current: createEditorState({ value: "abc\ndef\n", selection: createSelection(1, 1) }) };

    run(state, gotoLastLine);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 4, to: 5 });
  });

  it("goes to line start with gh", () => {
    const state = { current: createEditorState({ value: "abc\ndef", selection: createSelection(5, 5) }) };

    run(state, gotoLineStart);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 4, to: 5 });
  });

  it("goes to line end with gl", () => {
    const state = { current: createEditorState({ value: "abc\ndef", selection: createSelection(1, 1) }) };

    run(state, gotoLineEnd);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 2, to: 3 });
  });

  it("goes to first non-whitespace with gs", () => {
    const state = { current: createEditorState({ value: "abc\n   def", selection: createSelection(4, 4) }) };

    run(state, gotoFirstNonWhitespace);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 7, to: 8 });
  });

  it("yanks the current selection and pastes it after the selection", () => {
    const state = { current: createEditorState({ value: "abc", selection: createSelection(1, 1) }) };

    run(state, yankSelection);
    expect(state.current.yankBuffer).toBe("b");

    run(state, pasteAfter);
    expect(state.current.doc.text).toBe("abbc");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 2, to: 3 });
  });

  it("yanks a linewise selection and pastes it after the current line", () => {
    const state = { current: createEditorState({ value: "one\ntwo\n", selection: createSelection(0, 3) }) };

    run(state, yankSelection);
    expect(state.current.yankBuffer).toBe("one\n");

    run(state, pasteAfter);
    expect(state.current.doc.text).toBe("one\none\ntwo\n");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 4, to: 8 });
  });

  it("returns to normal mode after yanking from visual mode", () => {
    const state = { current: createEditorState({ value: "abcd" }) };

    run(state, toggleVisualMode);
    run(state, moveRight);
    run(state, yankSelection);

    expect(state.current.mode).toBe("normal");
    expect(state.current.yankBuffer).toBe("ab");
    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 2 });
  });

  it("extends in visual mode for goto motions", () => {
    const state = { current: createEditorState({ value: "abc\ndef", selection: createSelection(5, 5) }) };

    run(state, toggleVisualMode);
    run(state, gotoLineStart);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 4, to: 6 });

    run(state, gotoLineEnd);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 5, to: 7 });
  });

  it("moves w to the next lowercase word start", () => {
    const state = { current: createEditorState({ value: "alpha beta", selection: createSelection(0, 0) }) };

    run(state, moveNextWordStart);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 6, to: 7 });
  });

  it("moves W to the next long-word start after whitespace", () => {
    const state = { current: createEditorState({ value: "alpha += beta", selection: createSelection(0, 0) }) };

    run(state, moveNextLongWordStart);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 6, to: 7 });
    run(state, moveNextLongWordStart);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 9, to: 10 });
  });

  it("moves B to the start of the current long word or previous one", () => {
    const state = { current: createEditorState({ value: "alpha += beta", selection: createSelection(11, 11) }) };

    run(state, movePrevLongWordStart);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 9, to: 10 });

    run(state, movePrevLongWordStart);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 6, to: 7 });
  });

  it("moves E to the end of the current or next long word", () => {
    const state = { current: createEditorState({ value: "alpha += beta", selection: createSelection(0, 0) }) };

    run(state, moveNextLongWordEnd);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 4, to: 5 });

    run(state, moveNextLongWordEnd);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 7, to: 8 });
  });

  it("keeps the visual anchor for w, W, B, and E", () => {
    const state = { current: createEditorState({ value: "alpha += beta gamma" }) };

    run(state, toggleVisualMode);
    run(state, moveNextWordStart);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 7 });

    run(state, moveNextLongWordStart);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 10 });

    run(state, movePrevLongWordStart);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 7 });

    run(state, moveNextLongWordEnd);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 8 });
  });

  it("finds the next and previous matching character across lines", () => {
    const state = { current: createEditorState({ value: "abc\ndef\nghi", selection: createSelection(0, 0) }) };

    run(state, findNextChar("e"));
    expect(getSelectionOffsets(state.current)).toEqual({ from: 5, to: 6 });

    run(state, findPrevChar("b"));
    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 2 });
  });

  it("finds till the next and previous matching character across lines", () => {
    const state = { current: createEditorState({ value: "abc\ndef\nghi", selection: createSelection(0, 0) }) };

    run(state, findTillNextChar("e"));
    expect(getSelectionOffsets(state.current)).toEqual({ from: 4, to: 5 });

    run(state, findTillPrevChar("a"));
    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 2 });
  });

  it("treats missing find targets as a no-op", () => {
    const state = { current: createEditorState({ value: "abc", selection: createSelection(1, 1) }) };

    run(state, findNextChar("z"));

    expect(getSelectionOffsets(state.current)).toEqual({ from: 1, to: 2 });
  });

  it("moves by page and half-page using the measured viewport size", () => {
    const state = {
      current: createEditorState({
        value: Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n"),
        selection: createSelection(0, 0)
      })
    };
    const viewport = { fromLine: 0, toLine: 4, visibleLineCount: 5 };

    run(state, pageDown, viewport);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(4);

    run(state, halfPageDown, viewport);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(6);

    run(state, halfPageUp, viewport);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(4);

    run(state, pageUp, viewport);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(0);
  });

  it("moves to the visible top, center, and bottom lines", () => {
    const state = {
      current: createEditorState({
        value: Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n"),
        selection: createSelection(0, 0)
      })
    };
    const viewport = { fromLine: 4, toLine: 8, visibleLineCount: 5 };

    run(state, gotoWindowTop, viewport);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(4);

    run(state, gotoWindowCenter, viewport);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(6);

    run(state, gotoWindowBottom, viewport);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(8);
  });

  it("jumps between matching brackets with mm", () => {
    const state = { current: createEditorState({ value: "fn(alpha[beta])", selection: createSelection(2, 2) }) };

    run(state, gotoMatchingBracket);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 14, to: 15 });

    run(state, gotoMatchingBracket);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 2, to: 3 });
  });

  it("moves between paragraph boundaries", () => {
    const state = {
      current: createEditorState({
        value: "alpha\nbeta\n\n\ngamma\ndelta\n\nepsilon",
        selection: createSelection(1, 1)
      })
    };

    run(state, gotoNextParagraph);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(4);

    run(state, gotoNextParagraph);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(7);

    run(state, gotoPrevParagraph);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(4);

    run(state, gotoPrevParagraph);
    expect(state.current.doc.positionAt(getCursorOffset(state.current.selection)).line).toBe(0);
  });

  it("moves e to the end of the current word from its start", () => {
    const state = { current: createEditorState({ value: "alpha beta" }) };
    run(state, moveWordForward);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 5 });
    expect(getCursorOffset(state.current.selection)).toBe(4);
  });

  it("moves e to the next word end when already at a word end", () => {
    const state = { current: createEditorState({ value: "alpha beta", selection: createSelection(4, 4) }) };

    run(state, moveWordForward);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 5, to: 10 });
    expect(getCursorOffset(state.current.selection)).toBe(9);
  });

  it("moves e through whitespace to the next run end", () => {
    const state = { current: createEditorState({ value: "alpha   beta", selection: createSelection(5, 5) }) };

    run(state, moveWordForward);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 5, to: 12 });
    expect(getCursorOffset(state.current.selection)).toBe(11);
  });

  it("matches Helix-style e progression across words, spaces, and punctuation", () => {
    const state = {
      current: createEditorState({
        value: 'import { greet } from "./hello";',
        selection: createSelection(1, 1)
      })
    };

    const expectedSelections = [
      { from: 1, to: 6, text: "mport" },
      { from: 6, to: 8, text: " {" },
      { from: 8, to: 14, text: " greet" },
      { from: 14, to: 16, text: " }" },
      { from: 16, to: 21, text: " from" },
      { from: 21, to: 25, text: ' "./' },
      { from: 25, to: 30, text: "hello" },
      { from: 30, to: 32, text: '";' }
    ];

    for (const expected of expectedSelections) {
      run(state, moveWordForward);
      const selection = getSelectionOffsets(state.current);
      expect(selection).toEqual({ from: expected.from, to: expected.to });
      expect(state.current.doc.text.slice(selection.from, selection.to)).toBe(expected.text);
    }
  });

  it("moves b to the start of the current word from the middle", () => {
    const state = { current: createEditorState({ value: "alpha beta", selection: createSelection(8, 8) }) };

    run(state, moveWordBackward);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 6, to: 9 });
    expect(getCursorOffset(state.current.selection)).toBe(6);
  });

  it("moves b to the start of the previous whitespace run from a word start", () => {
    const state = { current: createEditorState({ value: "alpha beta", selection: createSelection(6, 6) }) };

    run(state, moveWordBackward);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 5, to: 6 });
    expect(getCursorOffset(state.current.selection)).toBe(5);
  });

  it("moves b to the start of the current whitespace run", () => {
    const state = { current: createEditorState({ value: "alpha   beta", selection: createSelection(7, 7) }) };

    run(state, moveWordBackward);

    expect(getSelectionOffsets(state.current)).toEqual({ from: 5, to: 8 });
    expect(getCursorOffset(state.current.selection)).toBe(5);
  });

  it("matches Helix-style b stepping across punctuation, words, and whitespace runs", () => {
    const state = {
      current: createEditorState({
        value: 'import { greet } from "./hello";',
        selection: createSelection(31, 31)
      })
    };

    const expectedSelections = [
      { from: 30, to: 32, text: '";' },
      { from: 25, to: 30, text: "hello" },
      { from: 22, to: 25, text: '"./' },
      { from: 21, to: 22, text: " " },
      { from: 17, to: 21, text: "from" },
      { from: 16, to: 17, text: " " },
      { from: 14, to: 16, text: " }" }
    ];

    for (const expected of expectedSelections) {
      run(state, moveWordBackward);
      const selection = getSelectionOffsets(state.current);
      expect(selection).toEqual({ from: expected.from, to: expected.to });
      expect(state.current.doc.text.slice(selection.from, selection.to)).toBe(expected.text);
    }
  });

  it("keeps the visual anchor while extending with e and b", () => {
    const state = { current: createEditorState({ value: "alpha beta gamma" }) };

    run(state, moveWordForward);
    run(state, toggleVisualMode);
    run(state, moveWordForward);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 10 });

    run(state, moveWordBackward);
    expect(getSelectionOffsets(state.current)).toEqual({ from: 0, to: 7 });
  });

  it("selects around a quoted textobject with ma'", () => {
    const state = {
      current: createEditorState({
        value: "const value = 'hello';",
        selection: createSelection(15, 15)
      })
    };

    run(state, selectTextobject("around", "'"));

    expect(getSelectionOffsets(state.current)).toEqual({ from: 14, to: 21 });
    expect(state.current.doc.text.slice(14, 21)).toBe("'hello'");
  });

  it("selects inside a quoted textobject with mi'", () => {
    const state = {
      current: createEditorState({
        value: "const value = 'hello';",
        selection: createSelection(15, 15)
      })
    };

    run(state, selectTextobject("inside", "'"));

    expect(getSelectionOffsets(state.current)).toEqual({ from: 15, to: 20 });
    expect(state.current.doc.text.slice(15, 20)).toBe("hello");
  });

  it("selects around bracket textobjects", () => {
    const state = {
      current: createEditorState({
        value: "call(alpha, beta)",
        selection: createSelection(6, 6)
      })
    };

    run(state, selectTextobject("around", "("));

    expect(getSelectionOffsets(state.current)).toEqual({ from: 4, to: 17 });
    expect(state.current.doc.text.slice(4, 17)).toBe("(alpha, beta)");
  });

  it("maps arrow-key-equivalent vertical insert motion to an insertion point", () => {
    const state = {
      current: createEditorState({
        value: "abcd\nxy",
        mode: "insert",
        selection: createSelection(3, 3)
      })
    };

    moveDown(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    expect(getCursorOffset(state.current.selection)).toBe(7);
    moveUp(state.current, (transaction) => dispatchTransaction(state, transaction), {});
    expect(getCursorOffset(state.current.selection)).toBe(3);
  });
});
