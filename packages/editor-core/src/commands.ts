import { type TextChange } from "./document";
import {
  applyTransaction,
  clampCharacterOffset,
  clampInsertionOffset,
  createCharacterSelection,
  createSelection,
  getActiveCharacterOffset,
  getCursorOffset,
  getPrimaryRange,
  getSelectionOffsets,
  type EditorState,
  type SelectionSet,
  type Transaction
} from "./state";

export interface CommandContext {
  requestFocus?: () => void;
}

export type EditorDispatch = (transaction: Transaction) => void;
export type Command = (state: EditorState, dispatch: EditorDispatch, context: CommandContext) => boolean;

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function isWhitespaceCharacter(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function classifyCharacter(character: string | undefined): "word" | "whitespace" | "punctuation" | null {
  if (character === undefined) {
    return null;
  }

  if (isWhitespaceCharacter(character)) {
    return "whitespace";
  }

  return isWordCharacter(character) ? "word" : "punctuation";
}

function findSegmentStart(text: string, offset: number): number {
  const kind = classifyCharacter(text[offset]);

  if (!kind) {
    return 0;
  }

  let index = offset;
  while (index > 0 && classifyCharacter(text[index - 1]) === kind) {
    index -= 1;
  }
  return index;
}

function findSegmentEnd(text: string, offset: number): number {
  const kind = classifyCharacter(text[offset]);

  if (!kind) {
    return 0;
  }

  let index = offset + 1;
  while (index < text.length && classifyCharacter(text[index]) === kind) {
    index += 1;
  }
  return index;
}

function isRunStart(text: string, offset: number): boolean {
  return offset <= 0 || classifyCharacter(text[offset - 1]) !== classifyCharacter(text[offset]);
}

function isRunEnd(text: string, offset: number): boolean {
  return offset >= text.length - 1 || classifyCharacter(text[offset + 1]) !== classifyCharacter(text[offset]);
}

function withInsertMovement(state: EditorState, cursor: number) {
  if (state.mode !== "insert" || !state.insertSession) {
    return undefined;
  }

  return {
    ...state.insertSession,
    moved: state.insertSession.moved || cursor !== getCursorOffset(state.selection)
  };
}

function moveToOffset(state: EditorState, dispatch: EditorDispatch, cursor: number, preferredColumn: number | null): boolean {
  if (state.mode === "insert") {
    const nextCursor = clampInsertionOffset(state.doc, cursor);
    dispatch({
      selection: createSelection(nextCursor, nextCursor, preferredColumn),
      insertSession: withInsertMovement(state, nextCursor)
    });
    return true;
  }

  const target = clampCharacterOffset(state.doc, cursor);
  dispatch({
    selection:
      state.mode === "visual"
        ? createSelection(getPrimaryRange(state.selection).anchor, target, preferredColumn)
        : createCharacterSelection(state.doc, target, preferredColumn)
  });
  return true;
}

export const moveLeft: Command = (state, dispatch) => {
  const cursor = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
  return moveToOffset(state, dispatch, Math.max(0, cursor - 1), null);
};

export const moveRight: Command = (state, dispatch) => {
  const cursor = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
  const limit = state.mode === "insert" ? state.doc.length : Math.max(0, state.doc.length - 1);
  return moveToOffset(state, dispatch, Math.min(limit, cursor + 1), null);
};

function moveVertical(state: EditorState, dispatch: EditorDispatch, direction: -1 | 1): boolean {
  const range = getPrimaryRange(state.selection);
  const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
  const position = state.doc.positionAt(activeOffset);
  const targetLineIndex = Math.max(0, Math.min(state.doc.lineCount - 1, position.line + direction));

  if (targetLineIndex === position.line) {
    return true;
  }

  const goalColumn = range.preferredColumn ?? position.column;
  const targetLine = state.doc.lineAt(targetLineIndex);
  const maxColumn = state.mode === "insert" ? targetLine.text.length : Math.max(0, targetLine.text.length - 1);
  const cursor = targetLine.start + Math.min(goalColumn, maxColumn);
  return moveToOffset(state, dispatch, cursor, goalColumn);
}

export const moveUp: Command = (state, dispatch) => moveVertical(state, dispatch, -1);
export const moveDown: Command = (state, dispatch) => moveVertical(state, dispatch, 1);

export const enterInsertMode: Command = (state, dispatch, context) => {
  if (state.mode === "insert") {
    return true;
  }

  const selection = getSelectionOffsets(state);
  dispatch({
    mode: "insert",
    selection: createSelection(selection.from, selection.from),
    insertSession: {
      restoreOffset: getActiveCharacterOffset(state),
      restoreAffinity: "right",
      moved: false
    }
  });
  context.requestFocus?.();
  return true;
};

export const appendInsertMode: Command = (state, dispatch, context) => {
  if (state.mode === "insert") {
    return true;
  }

  const selection = getSelectionOffsets(state);
  dispatch({
    mode: "insert",
    selection: createSelection(selection.to, selection.to),
    insertSession: {
      restoreOffset: getActiveCharacterOffset(state),
      restoreAffinity: "left",
      moved: false
    }
  });
  context.requestFocus?.();
  return true;
};

export const toggleVisualMode: Command = (state, dispatch) => {
  if (state.mode === "insert") {
    return false;
  }

  if (state.mode === "visual") {
    const active = getActiveCharacterOffset(state);
    dispatch({
      mode: "normal",
      selection: createCharacterSelection(state.doc, active)
    });
    return true;
  }

  dispatch({ mode: "visual" });
  return true;
};

export const enterNormalMode: Command = (state, dispatch) => {
  if (state.mode === "insert") {
    const cursor = clampInsertionOffset(state.doc, getCursorOffset(state.selection));
    const nextCursor =
      state.doc.length === 0
        ? 0
        : state.insertSession && !state.insertSession.moved
          ? clampCharacterOffset(state.doc, state.insertSession.restoreOffset)
          : clampCharacterOffset(state.doc, cursor > 0 ? cursor - 1 : cursor);
    dispatch({
      mode: "normal",
      selection: createCharacterSelection(state.doc, nextCursor),
      insertSession: null
    });
    return true;
  }

  dispatch({
    mode: "normal",
    selection: createCharacterSelection(state.doc, getActiveCharacterOffset(state)),
    insertSession: null
  });
  return true;
};

function findNextWordEndFromOffset(text: string, offset: number): number | null {
  if (text.length === 0) {
    return null;
  }

  let index = Math.max(0, Math.min(offset, text.length - 1));

  if (classifyCharacter(text[index]) !== "whitespace" && isRunEnd(text, index)) {
    index += 1;
  }

  if (index >= text.length) {
    return null;
  }

  if (classifyCharacter(text[index]) === "whitespace") {
    const whitespaceEnd = findSegmentEnd(text, index);
    if (whitespaceEnd >= text.length) {
      return text.length - 1;
    }
    return findSegmentEnd(text, whitespaceEnd) - 1;
  }

  return findSegmentEnd(text, index) - 1;
}

function findPreviousWordStartFromOffset(text: string, offset: number): number | null {
  if (text.length === 0) {
    return null;
  }

  let end = Math.max(0, Math.min(offset, text.length - 1)) + 1;
  const current = end - 1;

  if (classifyCharacter(text[current]) !== "whitespace" && isRunStart(text, current)) {
    end = current;
  }

  if (end <= 0) {
    return null;
  }

  return findSegmentStart(text, end - 1);
}

function selectNormalWordForward(state: EditorState, dispatch: EditorDispatch): boolean {
  const selection = getSelectionOffsets(state);
  let start = selection.to - selection.from === 1 ? selection.from : selection.to;

  if (selection.to - selection.from === 1) {
    const current = Math.max(0, Math.min(start, state.doc.length - 1));
    if (classifyCharacter(state.doc.text[current]) !== "whitespace" && isRunEnd(state.doc.text, current)) {
      start = current + 1;
    }
  }

  if (start >= state.doc.length) {
    return true;
  }

  const target = findNextWordEndFromOffset(state.doc.text, start);
  if (target === null) {
    return true;
  }

  dispatch({
    selection: createSelection(start, target)
  });
  return true;
}

function selectNormalWordBackward(state: EditorState, dispatch: EditorDispatch): boolean {
  const selection = getSelectionOffsets(state);
  let end = selection.to - selection.from === 1 ? selection.to : selection.from;

  if (selection.to - selection.from === 1) {
    const current = Math.max(0, Math.min(selection.from, state.doc.length - 1));
    if (isRunStart(state.doc.text, current)) {
      end = selection.from;
    }
  }

  if (end <= 0) {
    return true;
  }

  const target = findPreviousWordStartFromOffset(state.doc.text, end - 1);
  if (target === null) {
    return true;
  }

  dispatch({
    selection: createSelection(end - 1, target)
  });
  return true;
}

function selectToTarget(state: EditorState, dispatch: EditorDispatch, target: number): boolean {
  const active = getActiveCharacterOffset(state);

  if (state.mode === "visual") {
    dispatch({
      selection: createSelection(getPrimaryRange(state.selection).anchor, target)
    });
    return true;
  }

  dispatch({
    selection: createSelection(active, target)
  });
  return true;
}

export const moveWordForward: Command = (state, dispatch) => {
  if (state.mode === "normal") {
    return selectNormalWordForward(state, dispatch);
  }

  const target = findNextWordEndFromOffset(state.doc.text, getActiveCharacterOffset(state));
  return target === null ? true : selectToTarget(state, dispatch, target);
};

export const moveWordBackward: Command = (state, dispatch) => {
  if (state.mode === "normal") {
    return selectNormalWordBackward(state, dispatch);
  }

  const target = findPreviousWordStartFromOffset(state.doc.text, getActiveCharacterOffset(state));
  return target === null ? true : selectToTarget(state, dispatch, target);
};

function changeAtCursor(state: EditorState, insert: string, removeBefore = 0, removeAfter = 0): TextChange {
  const cursor = clampInsertionOffset(state.doc, getCursorOffset(state.selection));
  return {
    from: Math.max(0, cursor - removeBefore),
    to: Math.min(state.doc.length, cursor + removeAfter),
    insert
  };
}

function selectionAfterChange(state: EditorState, change: TextChange): SelectionSet {
  return createSelection(change.from + change.insert.length, change.from + change.insert.length, null);
}

function applySingleChange(state: EditorState, dispatch: EditorDispatch, change: TextChange): boolean {
  dispatch({
    changes: [change],
    selection: selectionAfterChange(state, change)
  });
  return true;
}

export function insertText(text: string): Command {
  return (state, dispatch) => applySingleChange(state, dispatch, changeAtCursor(state, text));
}

export const insertNewline: Command = (state, dispatch) => applySingleChange(state, dispatch, changeAtCursor(state, "\n"));

export const deleteBackward: Command = (state, dispatch) => {
  const cursor = getCursorOffset(state.selection);
  if (cursor === 0) {
    return true;
  }

  return applySingleChange(state, dispatch, changeAtCursor(state, "", 1, 0));
};

export const deleteForward: Command = (state, dispatch) => {
  const cursor = getCursorOffset(state.selection);
  if (cursor === state.doc.length) {
    return true;
  }

  return applySingleChange(state, dispatch, changeAtCursor(state, "", 0, 1));
};

export function reduceTransaction(state: EditorState, transaction: Transaction): EditorState {
  return applyTransaction(state, transaction);
}
