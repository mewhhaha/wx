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
  history?: {
    undo(): boolean;
    redo(): boolean;
  };
  viewport?: {
    fromLine: number;
    toLine: number;
    visibleLineCount: number;
  };
}

export type EditorDispatch = (transaction: Transaction) => void;
export type Command = (state: EditorState, dispatch: EditorDispatch, context: CommandContext) => boolean;

type TextobjectMode = "around" | "inside";
type CharacterKind = "word" | "whitespace" | "punctuation" | null;
type CharacterClassifier = (character: string | undefined) => CharacterKind;

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function isWhitespaceCharacter(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function classifyCharacter(character: string | undefined): CharacterKind {
  if (character === undefined) {
    return null;
  }

  if (isWhitespaceCharacter(character)) {
    return "whitespace";
  }

  return isWordCharacter(character) ? "word" : "punctuation";
}

function classifyLongCharacter(character: string | undefined): CharacterKind {
  if (character === undefined) {
    return null;
  }

  return isWhitespaceCharacter(character) ? "whitespace" : "word";
}

function findSegmentStartWithClassifier(text: string, offset: number, classify: CharacterClassifier): number {
  const kind = classify(text[offset]);

  if (!kind) {
    return 0;
  }

  let index = offset;
  while (index > 0 && classify(text[index - 1]) === kind) {
    index -= 1;
  }
  return index;
}

function findSegmentEndWithClassifier(text: string, offset: number, classify: CharacterClassifier): number {
  const kind = classify(text[offset]);

  if (!kind) {
    return 0;
  }

  let index = offset + 1;
  while (index < text.length && classify(text[index]) === kind) {
    index += 1;
  }
  return index;
}

function findSegmentStart(text: string, offset: number): number {
  return findSegmentStartWithClassifier(text, offset, classifyCharacter);
}

function findSegmentEnd(text: string, offset: number): number {
  return findSegmentEndWithClassifier(text, offset, classifyCharacter);
}

function isRunStartWithClassifier(text: string, offset: number, classify: CharacterClassifier): boolean {
  return offset <= 0 || classify(text[offset - 1]) !== classify(text[offset]);
}

function isRunStart(text: string, offset: number): boolean {
  return isRunStartWithClassifier(text, offset, classifyCharacter);
}

function isRunEndWithClassifier(text: string, offset: number, classify: CharacterClassifier): boolean {
  return offset >= text.length - 1 || classify(text[offset + 1]) !== classify(text[offset]);
}

function isRunEnd(text: string, offset: number): boolean {
  return isRunEndWithClassifier(text, offset, classifyCharacter);
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

function moveVerticalByLines(state: EditorState, dispatch: EditorDispatch, delta: number): boolean {
  const range = getPrimaryRange(state.selection);
  const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
  const position = state.doc.positionAt(activeOffset);
  const targetLineIndex = Math.max(0, Math.min(state.doc.lineCount - 1, position.line + delta));

  if (targetLineIndex === position.line) {
    return true;
  }

  const goalColumn = range.preferredColumn ?? position.column;
  const targetLine = state.doc.lineAt(targetLineIndex);
  const maxColumn = state.mode === "insert" ? targetLine.text.length : Math.max(0, targetLine.text.length - 1);
  const cursor = targetLine.start + Math.min(goalColumn, maxColumn);
  return moveToOffset(state, dispatch, cursor, goalColumn);
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
  return moveVerticalByLines(state, dispatch, direction);
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

function openLine(state: EditorState, dispatch: EditorDispatch, context: CommandContext, position: "above" | "below"): boolean {
  if (state.mode === "insert") {
    return true;
  }

  if (state.doc.length === 0) {
    dispatch({
      mode: "insert",
      selection: createSelection(0, 0),
      insertSession: {
        restoreOffset: 0,
        restoreAffinity: "right",
        moved: false
      }
    });
    context.requestFocus?.();
    return true;
  }

  const activeOffset = getActiveCharacterOffset(state);
  const line = state.doc.lineAt(state.doc.positionAt(activeOffset).line);
  const insertAt =
    position === "above"
      ? line.start
      : line.end < state.doc.length && state.doc.text[line.end] === "\n"
        ? line.end + 1
        : state.doc.length;
  const change: TextChange = {
    from: insertAt,
    to: insertAt,
    insert: "\n"
  };

  dispatch({
    changes: [change],
    mode: "insert",
    selection: createSelection(insertAt, insertAt),
    insertSession: {
      restoreOffset: insertAt,
      restoreAffinity: "left",
      moved: false
    }
  });
  context.requestFocus?.();
  return true;
}

export const openBelow: Command = (state, dispatch, context) => openLine(state, dispatch, context, "below");
export const openAbove: Command = (state, dispatch, context) => openLine(state, dispatch, context, "above");

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
    const position = state.doc.positionAt(cursor);
    const previousCharacter = cursor > 0 ? state.doc.text[cursor - 1] : undefined;
    const nextCursor =
      state.doc.length === 0
        ? 0
        : state.insertSession && !state.insertSession.moved
          ? clampCharacterOffset(state.doc, state.insertSession.restoreOffset)
          : clampCharacterOffset(
              state.doc,
              cursor > 0 && position.column > 0 && previousCharacter !== "\n" ? cursor - 1 : cursor
            );
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

function findNextWordStartFromOffset(
  text: string,
  offset: number,
  classify: CharacterClassifier = classifyCharacter
): number | null {
  if (text.length === 0) {
    return null;
  }

  let index = Math.max(0, Math.min(offset, text.length - 1));

  if (classify(text[index]) !== "whitespace") {
    index = findSegmentEndWithClassifier(text, index, classify);
  }

  while (index < text.length && classify(text[index]) === "whitespace") {
    index = findSegmentEndWithClassifier(text, index, classify);
  }

  return index < text.length ? index : null;
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

function findPreviousLongWordStartFromOffset(text: string, offset: number): number | null {
  if (text.length === 0) {
    return null;
  }

  const index = Math.max(0, Math.min(offset, text.length - 1));

  if (
    classifyLongCharacter(text[index]) !== "whitespace" &&
    !isRunStartWithClassifier(text, index, classifyLongCharacter)
  ) {
    return findSegmentStartWithClassifier(text, index, classifyLongCharacter);
  }

  let probe =
    classifyLongCharacter(text[index]) === "whitespace"
      ? findSegmentStartWithClassifier(text, index, classifyLongCharacter) - 1
      : index - 1;

  while (probe >= 0 && classifyLongCharacter(text[probe]) === "whitespace") {
    probe = findSegmentStartWithClassifier(text, probe, classifyLongCharacter) - 1;
  }

  return probe >= 0 ? findSegmentStartWithClassifier(text, probe, classifyLongCharacter) : null;
}

function findNextLongWordEndFromOffset(text: string, offset: number): number | null {
  if (text.length === 0) {
    return null;
  }

  let index = Math.max(0, Math.min(offset, text.length - 1));

  if (
    classifyLongCharacter(text[index]) !== "whitespace" &&
    !isRunEndWithClassifier(text, index, classifyLongCharacter)
  ) {
    return findSegmentEndWithClassifier(text, index, classifyLongCharacter) - 1;
  }

  if (classifyLongCharacter(text[index]) !== "whitespace") {
    index = findSegmentEndWithClassifier(text, index, classifyLongCharacter);
  }

  while (index < text.length && classifyLongCharacter(text[index]) === "whitespace") {
    index = findSegmentEndWithClassifier(text, index, classifyLongCharacter);
  }

  if (index >= text.length) {
    return null;
  }

  return findSegmentEndWithClassifier(text, index, classifyLongCharacter) - 1;
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

function gotoTarget(state: EditorState, dispatch: EditorDispatch, target: number): boolean {
  return moveToOffset(state, dispatch, target, null);
}

function paragraphStartAtOrBefore(doc: EditorState["doc"], lineIndex: number): number | null {
  let line = Math.max(0, Math.min(lineIndex, doc.lineCount - 1));

  while (line >= 0 && doc.lineAt(line).text.trim().length === 0) {
    line -= 1;
  }

  if (line < 0) {
    return null;
  }

  while (line > 0 && doc.lineAt(line - 1).text.trim().length > 0) {
    line -= 1;
  }

  return line;
}

function findMatchingBracketOffset(text: string, offset: number): number | null {
  const character = text[offset];
  const openToClose = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["<", ">"]
  ]);
  const closeToOpen = new Map([
    [")", "("],
    ["]", "["],
    ["}", "{"],
    [">", "<"]
  ]);

  if (openToClose.has(character)) {
    const closeChar = openToClose.get(character)!;
    let depth = 0;

    for (let index = offset + 1; index < text.length; index += 1) {
      if (text[index] === character) {
        depth += 1;
        continue;
      }

      if (text[index] === closeChar) {
        if (depth === 0) {
          return index;
        }

        depth -= 1;
      }
    }
  }

  if (closeToOpen.has(character)) {
    const openChar = closeToOpen.get(character)!;
    let depth = 0;

    for (let index = offset - 1; index >= 0; index -= 1) {
      if (text[index] === character) {
        depth += 1;
        continue;
      }

      if (text[index] === openChar) {
        if (depth === 0) {
          return index;
        }

        depth -= 1;
      }
    }
  }

  return null;
}

export const selectAll: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  dispatch({
    selection: createSelection(0, state.doc.length - 1)
  });
  return true;
};

export const gotoFileStart: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  return gotoTarget(state, dispatch, 0);
};

export const gotoLastLine: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  const lastLineIndex =
    state.doc.lineCount > 1 && state.doc.lineAt(state.doc.lineCount - 1).text.length === 0
      ? state.doc.lineCount - 2
      : state.doc.lineCount - 1;

  return gotoTarget(state, dispatch, state.doc.lineAt(Math.max(0, lastLineIndex)).start);
};

export const gotoLineStart: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  const line = state.doc.lineAt(state.doc.positionAt(getActiveCharacterOffset(state)).line);
  return gotoTarget(state, dispatch, line.start);
};

export const gotoLineEnd: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  const line = state.doc.lineAt(state.doc.positionAt(getActiveCharacterOffset(state)).line);
  const target = Math.max(line.start, line.end - 1);
  return gotoTarget(state, dispatch, target);
};

export const gotoFirstNonWhitespace: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  const line = state.doc.lineAt(state.doc.positionAt(getActiveCharacterOffset(state)).line);
  const column = line.text.search(/\S/);
  if (column < 0) {
    return true;
  }

  return gotoTarget(state, dispatch, line.start + column);
};

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

export const moveNextWordStart: Command = (state, dispatch) => {
  const target = findNextWordStartFromOffset(state.doc.text, getActiveCharacterOffset(state), classifyCharacter);
  return target === null ? true : gotoTarget(state, dispatch, target);
};

export const moveNextLongWordStart: Command = (state, dispatch) => {
  const target = findNextWordStartFromOffset(state.doc.text, getActiveCharacterOffset(state), classifyLongCharacter);
  return target === null ? true : gotoTarget(state, dispatch, target);
};

export const movePrevLongWordStart: Command = (state, dispatch) => {
  const target = findPreviousLongWordStartFromOffset(state.doc.text, getActiveCharacterOffset(state));
  return target === null ? true : gotoTarget(state, dispatch, target);
};

export const moveNextLongWordEnd: Command = (state, dispatch) => {
  const target = findNextLongWordEndFromOffset(state.doc.text, getActiveCharacterOffset(state));
  return target === null ? true : gotoTarget(state, dispatch, target);
};

function findCharacterTarget(
  text: string,
  offset: number,
  targetCharacter: string,
  direction: 1 | -1,
  inclusive: boolean
): number | null {
  const start = offset + direction;

  for (let index = start; index >= 0 && index < text.length; index += direction) {
    if (text[index] !== targetCharacter) {
      continue;
    }

    if (inclusive) {
      return index;
    }

    const target = index - direction;
    return target >= 0 && target < text.length ? target : null;
  }

  return null;
}

export function findNextChar(targetCharacter: string): Command {
  return (state, dispatch) => {
    const target = findCharacterTarget(state.doc.text, getActiveCharacterOffset(state), targetCharacter, 1, true);
    return target === null ? true : gotoTarget(state, dispatch, target);
  };
}

export function findPrevChar(targetCharacter: string): Command {
  return (state, dispatch) => {
    const target = findCharacterTarget(state.doc.text, getActiveCharacterOffset(state), targetCharacter, -1, true);
    return target === null ? true : gotoTarget(state, dispatch, target);
  };
}

export function findTillNextChar(targetCharacter: string): Command {
  return (state, dispatch) => {
    const target = findCharacterTarget(state.doc.text, getActiveCharacterOffset(state), targetCharacter, 1, false);
    return target === null ? true : gotoTarget(state, dispatch, target);
  };
}

export function findTillPrevChar(targetCharacter: string): Command {
  return (state, dispatch) => {
    const target = findCharacterTarget(state.doc.text, getActiveCharacterOffset(state), targetCharacter, -1, false);
    return target === null ? true : gotoTarget(state, dispatch, target);
  };
}

function getVisibleLineCount(context: CommandContext): number {
  return Math.max(1, context.viewport?.visibleLineCount ?? 1);
}

export const pageUp: Command = (state, dispatch, context) =>
  moveVerticalByLines(state, dispatch, -(Math.max(1, getVisibleLineCount(context) - 1)));

export const pageDown: Command = (state, dispatch, context) =>
  moveVerticalByLines(state, dispatch, Math.max(1, getVisibleLineCount(context) - 1));

export const halfPageUp: Command = (state, dispatch, context) =>
  moveVerticalByLines(state, dispatch, -Math.max(1, Math.floor(getVisibleLineCount(context) / 2)));

export const halfPageDown: Command = (state, dispatch, context) =>
  moveVerticalByLines(state, dispatch, Math.max(1, Math.floor(getVisibleLineCount(context) / 2)));

export const gotoWindowTop: Command = (state, dispatch, context) => {
  const line = context.viewport?.fromLine ?? 0;
  return gotoTarget(state, dispatch, state.doc.lineAt(line).start);
};

export const gotoWindowCenter: Command = (state, dispatch, context) => {
  const viewport = context.viewport;
  const line =
    viewport ? Math.floor((viewport.fromLine + viewport.toLine) / 2) : state.doc.positionAt(getActiveCharacterOffset(state)).line;
  return gotoTarget(state, dispatch, state.doc.lineAt(line).start);
};

export const gotoWindowBottom: Command = (state, dispatch, context) => {
  const line = context.viewport?.toLine ?? Math.max(0, state.doc.lineCount - 1);
  return gotoTarget(state, dispatch, state.doc.lineAt(line).start);
};

export const gotoMatchingBracket: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  const activeOffset = getActiveCharacterOffset(state);
  const target = findMatchingBracketOffset(state.doc.text, activeOffset);
  return target === null ? true : gotoTarget(state, dispatch, target);
};

export const gotoNextParagraph: Command = (state, dispatch) => {
  const currentLine = state.doc.positionAt(getActiveCharacterOffset(state)).line;
  let line = currentLine;

  if (state.doc.lineAt(line).text.trim().length === 0) {
    while (line < state.doc.lineCount && state.doc.lineAt(line).text.trim().length === 0) {
      line += 1;
    }
  } else {
    while (line < state.doc.lineCount && state.doc.lineAt(line).text.trim().length > 0) {
      line += 1;
    }

    while (line < state.doc.lineCount && state.doc.lineAt(line).text.trim().length === 0) {
      line += 1;
    }
  }

  if (line >= state.doc.lineCount) {
    return true;
  }

  return gotoTarget(state, dispatch, state.doc.lineAt(line).start);
};

export const gotoPrevParagraph: Command = (state, dispatch) => {
  const currentLine = state.doc.positionAt(getActiveCharacterOffset(state)).line;
  const currentLineBlank = state.doc.lineAt(currentLine).text.trim().length === 0;
  const currentParagraphStart = paragraphStartAtOrBefore(state.doc, currentLine);

  if (currentParagraphStart === null) {
    return true;
  }

  if (!currentLineBlank && currentLine > currentParagraphStart) {
    return gotoTarget(state, dispatch, state.doc.lineAt(currentParagraphStart).start);
  }

  const previousParagraphStart = paragraphStartAtOrBefore(state.doc, Math.max(0, currentParagraphStart - 1));
  return previousParagraphStart === null ? true : gotoTarget(state, dispatch, state.doc.lineAt(previousParagraphStart).start);
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

function selectionForInsertedText(doc: EditorState["doc"], from: number, insert: string): SelectionSet {
  if (insert.length === 0) {
    return createCharacterSelection(doc, from);
  }

  return createSelection(from, from + insert.length - 1);
}

function linewisePasteOffset(state: EditorState): number {
  if (state.doc.length === 0) {
    return 0;
  }

  const selection = getSelectionOffsets(state);
  const activeOffset = Math.max(0, Math.min(state.doc.length - 1, selection.to - 1));
  const line = state.doc.lineAt(state.doc.positionAt(activeOffset).line);
  const newlineOffset = line.end;

  return newlineOffset < state.doc.length && state.doc.text[newlineOffset] === "\n" ? newlineOffset + 1 : state.doc.length;
}

function lineSelectionHead(doc: EditorState["doc"], lineIndex: number): number {
  const line = doc.lineAt(lineIndex);
  const newlineOffset = line.end;
  const hasNewline = newlineOffset < doc.length && doc.text[newlineOffset] === "\n";

  if (hasNewline) {
    return newlineOffset;
  }

  return Math.max(line.start, line.end - 1);
}

function lineSelectionEndExclusive(doc: EditorState["doc"], lineIndex: number): number {
  return Math.min(doc.length, lineSelectionHead(doc, lineIndex) + 1);
}

export const selectLineBelow: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  const selection = getSelectionOffsets(state);
  const fromLine = state.doc.positionAt(selection.from).line;
  const currentLine = state.doc.positionAt(getActiveCharacterOffset(state)).line;
  const selectionHeadLine = state.doc.positionAt(Math.max(selection.from, selection.to - 1)).line;
  const selectedLineStart = state.doc.lineAt(fromLine).start;
  const selectedLineEnd = lineSelectionEndExclusive(state.doc, selectionHeadLine);
  const isFullLineSelection = selection.from === selectedLineStart && selection.to === selectedLineEnd;
  const targetFromLine = isFullLineSelection ? fromLine : currentLine;
  const targetToLine = Math.min(
    state.doc.lineCount - 1,
    isFullLineSelection ? selectionHeadLine + 1 : currentLine
  );

  dispatch({
    selection: createSelection(state.doc.lineAt(targetFromLine).start, lineSelectionHead(state.doc, targetToLine)),
    mode: state.mode === "insert" ? "normal" : state.mode
  });
  return true;
};

export const undo: Command = (_state, _dispatch, context) => context.history?.undo() ?? false;

export const redo: Command = (_state, _dispatch, context) => context.history?.redo() ?? false;

function applySingleChange(state: EditorState, dispatch: EditorDispatch, change: TextChange): boolean {
  dispatch({
    changes: [change],
    selection: selectionAfterChange(state, change)
  });
  return true;
}

function selectionAfterDeletion(doc: EditorState["doc"], from: number): SelectionSet {
  if (doc.length === 0) {
    return createSelection(0, 0);
  }

  return createCharacterSelection(doc, Math.max(0, Math.min(from, doc.length - 1)));
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

export const deleteSelection: Command = (state, dispatch) => {
  const selection = getSelectionOffsets(state);

  if (selection.to <= selection.from) {
    return true;
  }

  const deletedText = state.doc.slice(selection.from, selection.to);
  const change: TextChange = {
    from: selection.from,
    to: selection.to,
    insert: ""
  };
  const nextDoc = state.doc.applyChanges([change]);

  dispatch({
    changes: [change],
    selection: selectionAfterDeletion(nextDoc, selection.from),
    mode: "normal",
    insertSession: null,
    yankBuffer: deletedText,
    lastDeletedFrom: selection.from
  });
  return true;
};

export const yankSelection: Command = (state, dispatch) => {
  const selection = getSelectionOffsets(state);
  const yanked = state.doc.slice(selection.from, selection.to);

  dispatch({
    yankBuffer: yanked,
    lastDeletedFrom: null,
    mode: state.mode === "visual" ? "normal" : state.mode,
    selection:
      state.mode === "visual" ? createCharacterSelection(state.doc, getActiveCharacterOffset(state)) : state.selection
  });
  return true;
};

export const pasteAfter: Command = (state, dispatch) => {
  const yanked = state.yankBuffer;

  if (!yanked) {
    return true;
  }

  const insertAt =
    yanked.endsWith("\n")
      ? linewisePasteOffset(state)
      : state.lastDeletedFrom !== null
        ? state.lastDeletedFrom
        : getSelectionOffsets(state).to;
  const change: TextChange = {
    from: insertAt,
    to: insertAt,
    insert: yanked
  };

  dispatch({
    changes: [change],
    selection: selectionForInsertedText(state.doc.applyChanges([change]), insertAt, yanked),
    mode: "normal",
    lastDeletedFrom: null
  });
  return true;
};

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }

  return backslashes % 2 === 1;
}

function findQuotedTextobject(text: string, range: { from: number; to: number }, delimiter: string) {
  let open = -1;

  for (let index = Math.max(0, range.from); index >= 0; index -= 1) {
    if (text[index] === delimiter && !isEscaped(text, index)) {
      open = index;
      break;
    }
  }

  if (open < 0) {
    return null;
  }

  for (let index = Math.max(range.to - 1, open + 1); index < text.length; index += 1) {
    if (text[index] === delimiter && !isEscaped(text, index)) {
      return { from: open, to: index + 1 };
    }
  }

  return null;
}

function findPairedTextobject(text: string, range: { from: number; to: number }, openChar: string, closeChar: string) {
  let open = -1;
  let depth = 0;

  for (let index = Math.max(0, range.from); index >= 0; index -= 1) {
    if (text[index] === closeChar) {
      depth += 1;
      continue;
    }

    if (text[index] === openChar) {
      if (depth === 0) {
        open = index;
        break;
      }

      depth -= 1;
    }
  }

  if (open < 0) {
    return null;
  }

  depth = 0;

  for (let index = open + 1; index < text.length; index += 1) {
    if (text[index] === openChar) {
      depth += 1;
      continue;
    }

    if (text[index] === closeChar) {
      if (depth === 0) {
        const close = index + 1;
        return close < range.to ? null : { from: open, to: close };
      }

      depth -= 1;
    }
  }

  return null;
}

function findSurroundTextobject(text: string, range: { from: number; to: number }, object: string) {
  switch (object) {
    case "'":
    case '"':
    case "`":
      return findQuotedTextobject(text, range, object);
    case "(":
    case ")":
      return findPairedTextobject(text, range, "(", ")");
    case "[":
    case "]":
      return findPairedTextobject(text, range, "[", "]");
    case "{":
    case "}":
      return findPairedTextobject(text, range, "{", "}");
    case "<":
    case ">":
      return findPairedTextobject(text, range, "<", ">");
    default:
      return null;
  }
}

export function selectTextobject(mode: TextobjectMode, object: string): Command {
  return (state, dispatch) => {
    if (state.doc.length === 0) {
      return true;
    }

    const current = getSelectionOffsets(state);
    const objectRange = findSurroundTextobject(state.doc.text, current, object);

    if (!objectRange) {
      return true;
    }

    const nextRange =
      mode === "inside"
        ? {
            from: Math.min(objectRange.to, objectRange.from + 1),
            to: Math.max(objectRange.from + 1, objectRange.to - 1)
          }
        : objectRange;

    if (nextRange.to <= nextRange.from) {
      return true;
    }

    dispatch({
      selection: createSelection(nextRange.from, nextRange.to - 1),
      mode: state.mode === "insert" ? "normal" : state.mode
    });
    return true;
  };
}

export function reduceTransaction(state: EditorState, transaction: Transaction): EditorState {
  return applyTransaction(state, transaction);
}
