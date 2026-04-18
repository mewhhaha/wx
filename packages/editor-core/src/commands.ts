import { mapOffsetThroughChanges, type TextChange } from "./document";
import {
  applyTransaction,
  clampCharacterOffset,
  clampInsertionOffset,
  createCharacterSelection,
  createSelection,
  createSelectionSet,
  getActiveCharacterOffset,
  getActiveCharacterOffsetForRange,
  getCursorOffset,
  getPrimaryRange,
  getSelectionOffsets,
  getSelectionOffsetsForRange,
  getSelectionRanges,
  type EditorState,
  type SelectionRange,
  type SelectionSet,
  type Transaction
} from "./state";

export interface CommandContext {
  requestFocus?: () => void;
  history?: {
    undo(): boolean;
    redo(): boolean;
    checkpoint?(): boolean;
  };
  viewport?: {
    fromLine: number;
    toLine: number;
    visibleLineCount: number;
  };
}

export type EditorDispatch = (transaction: Transaction) => void;
export type Command = (state: EditorState, dispatch: EditorDispatch, context: CommandContext) => boolean;

export type TextobjectMode = "around" | "inside";
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

function selectionChanged(left: SelectionSet, right: SelectionSet): boolean {
  if (left.primaryIndex !== right.primaryIndex || left.ranges.length !== right.ranges.length) {
    return true;
  }

  return left.ranges.some((range, index) => {
    const other = right.ranges[index];
    return (
      !other ||
      range.anchor !== other.anchor ||
      range.head !== other.head ||
      range.preferredColumn !== other.preferredColumn
    );
  });
}

function withInsertMovement(state: EditorState, nextSelection: SelectionSet) {
  if (state.mode !== "insert" || !state.insertSession) {
    return undefined;
  }

  return {
    ...state.insertSession,
    moved: state.insertSession.moved || selectionChanged(state.selection, nextSelection)
  };
}

function createRangeSelectionForOffset(
  state: EditorState,
  range: SelectionRange,
  cursor: number,
  preferredColumn: number | null
): SelectionRange {
  if (state.mode === "insert") {
    const nextCursor = clampInsertionOffset(state.doc, cursor);
    return {
      anchor: nextCursor,
      head: nextCursor,
      preferredColumn
    };
  }

  const target = clampCharacterOffset(state.doc, cursor);
  return state.mode === "visual"
    ? {
        anchor: range.anchor,
        head: target,
        preferredColumn
      }
    : {
        anchor: target,
        head: target,
        preferredColumn
      };
}

function mapSelectionSet(
  state: EditorState,
  mapper: (range: SelectionRange, index: number) => SelectionRange
): SelectionSet {
  return createSelectionSet(
    state.selection.ranges.map((range, index) => mapper(range, index)),
    state.selection.primaryIndex
  );
}

function moveSelectionsToOffsets(
  state: EditorState,
  dispatch: EditorDispatch,
  getCursor: (range: SelectionRange, index: number) => { cursor: number; preferredColumn: number | null }
): boolean {
  const nextSelection = mapSelectionSet(state, (range, index) => {
    const next = getCursor(range, index);
    return createRangeSelectionForOffset(state, range, next.cursor, next.preferredColumn);
  });

  dispatch({
    selection: nextSelection,
    insertSession: withInsertMovement(state, nextSelection)
  });
  return true;
}

function moveToOffset(state: EditorState, dispatch: EditorDispatch, cursor: number, preferredColumn: number | null): boolean {
  return moveSelectionsToOffsets(state, dispatch, () => ({ cursor, preferredColumn }));
}

function moveVerticalByLines(state: EditorState, dispatch: EditorDispatch, delta: number): boolean {
  return moveSelectionsToOffsets(state, dispatch, (range) => {
    const activeOffset = state.mode === "insert" ? range.head : getActiveCharacterOffsetForRange(state, range);
    const position = state.doc.positionAt(activeOffset);
    const targetLineIndex = Math.max(0, Math.min(state.doc.lineCount - 1, position.line + delta));
    const goalColumn = range.preferredColumn ?? position.column;
    const targetLine = state.doc.lineAt(targetLineIndex);
    const maxColumn = state.mode === "insert" ? targetLine.text.length : Math.max(0, targetLine.text.length - 1);
    return {
      cursor: targetLine.start + Math.min(goalColumn, maxColumn),
      preferredColumn: goalColumn
    };
  });
}

export const moveLeft: Command = (state, dispatch) => {
  return moveSelectionsToOffsets(state, dispatch, (range) => {
    const cursor = state.mode === "insert" ? range.head : getActiveCharacterOffsetForRange(state, range);
    return { cursor: Math.max(0, cursor - 1), preferredColumn: null };
  });
};

export const moveRight: Command = (state, dispatch) => {
  return moveSelectionsToOffsets(state, dispatch, (range) => {
    const cursor = state.mode === "insert" ? range.head : getActiveCharacterOffsetForRange(state, range);
    const limit = state.mode === "insert" ? state.doc.length : Math.max(0, state.doc.length - 1);
    return { cursor: Math.min(limit, cursor + 1), preferredColumn: null };
  });
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

  const nextSelection = createSelectionSet(
    getSelectionRanges(state).map((selection) => ({
      anchor: selection.from,
      head: selection.from,
      preferredColumn: null
    })),
    state.selection.primaryIndex
  );
  dispatch({
    mode: "insert",
    selection: nextSelection,
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

  const nextSelection = createSelectionSet(
    getSelectionRanges(state).map((selection) => ({
      anchor: selection.to,
      head: selection.to,
      preferredColumn: null
    })),
    state.selection.primaryIndex
  );
  dispatch({
    mode: "insert",
    selection: nextSelection,
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

  const insertOffsets = createSelectionSet(
    state.selection.ranges.map((range) => {
      const activeOffset = getActiveCharacterOffsetForRange(state, range);
      const line = state.doc.lineAt(state.doc.positionAt(activeOffset).line);
      const insertAt =
        position === "above"
          ? line.start
          : line.end < state.doc.length && state.doc.text[line.end] === "\n"
            ? line.end + 1
            : state.doc.length;
      return {
        anchor: insertAt,
        head: insertAt,
        preferredColumn: null
      };
    }),
    state.selection.primaryIndex
  );
  const changes = [...new Set(insertOffsets.ranges.map((range) => range.head))]
    .sort((left, right) => right - left)
    .map(
      (insertAt): TextChange => ({
        from: insertAt,
        to: insertAt,
        insert: "\n"
      })
    );
  const nextSelection = createSelectionSet(
    insertOffsets.ranges.map((range) => {
      const cursor = mapOffsetThroughChanges(range.head, changes, "left");
      return {
        anchor: cursor,
        head: cursor,
        preferredColumn: null
      };
    }),
    insertOffsets.primaryIndex
  );

  dispatch({
    changes,
    mode: "insert",
    selection: nextSelection,
    insertSession: {
      restoreOffset: insertOffsets.ranges[insertOffsets.primaryIndex]?.head ?? 0,
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
    dispatch({
      mode: "normal",
      selection: createSelectionSet(
        state.selection.ranges.map((range) => {
          const active = getActiveCharacterOffsetForRange(state, range);
          return {
            anchor: active,
            head: active,
            preferredColumn: null
          };
        }),
        state.selection.primaryIndex
      )
    });
    return true;
  }

  dispatch({ mode: "visual" });
  return true;
};

export const enterNormalMode: Command = (state, dispatch) => {
  if (state.mode === "insert") {
    const insertSession = state.insertSession;
    const nextSelection = createSelectionSet(
      state.selection.ranges.map((range, index) => {
        const cursor = clampInsertionOffset(state.doc, range.head);
        const position = state.doc.positionAt(cursor);
        const previousCharacter = cursor > 0 ? state.doc.text[cursor - 1] : undefined;
        const useRestore = !!insertSession && !insertSession.moved && index === state.selection.primaryIndex;
        const nextCursor =
          state.doc.length === 0
            ? 0
            : useRestore
              ? clampCharacterOffset(state.doc, insertSession.restoreOffset)
              : clampCharacterOffset(
                  state.doc,
                  cursor > 0 && position.column > 0 && previousCharacter !== "\n" ? cursor - 1 : cursor
                );
        return {
          anchor: nextCursor,
          head: nextCursor,
          preferredColumn: null
        };
      }),
      state.selection.primaryIndex
    );
    dispatch({
      mode: "normal",
      selection: nextSelection,
      insertSession: null
    });
    return true;
  }

  dispatch({
    mode: "normal",
    selection: createSelectionSet(
      state.selection.ranges.map((range) => {
        const active = getActiveCharacterOffsetForRange(state, range);
        return {
          anchor: active,
          head: active,
          preferredColumn: null
        };
      }),
      state.selection.primaryIndex
    ),
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
  const nextSelection = createSelectionSet(
    state.selection.ranges.map((range) => {
      const selection = getSelectionOffsetsForRange(state, range);
      let start = selection.to - selection.from === 1 ? selection.from : selection.to;

      if (selection.to - selection.from === 1) {
        const current = Math.max(0, Math.min(start, state.doc.length - 1));
        if (classifyCharacter(state.doc.text[current]) !== "whitespace" && isRunEnd(state.doc.text, current)) {
          start = current + 1;
        }
      }

      if (start >= state.doc.length) {
        return range;
      }

      const target = findNextWordEndFromOffset(state.doc.text, start);
      return target === null
        ? range
        : {
            anchor: start,
            head: target,
            preferredColumn: null
          };
    }),
    state.selection.primaryIndex
  );
  dispatch({
    selection: nextSelection
  });
  return true;
}

function selectNormalWordBackward(state: EditorState, dispatch: EditorDispatch): boolean {
  const nextSelection = createSelectionSet(
    state.selection.ranges.map((range) => {
      const selection = getSelectionOffsetsForRange(state, range);
      let end = selection.to - selection.from === 1 ? selection.to : selection.from;

      if (selection.to - selection.from === 1) {
        const current = Math.max(0, Math.min(selection.from, state.doc.length - 1));
        if (isRunStart(state.doc.text, current)) {
          end = selection.from;
        }
      }

      if (end <= 0) {
        return range;
      }

      const target = findPreviousWordStartFromOffset(state.doc.text, end - 1);
      return target === null
        ? range
        : {
            anchor: end - 1,
            head: target,
            preferredColumn: null
          };
    }),
    state.selection.primaryIndex
  );
  dispatch({
    selection: nextSelection
  });
  return true;
}

function selectToTargets(
  state: EditorState,
  dispatch: EditorDispatch,
  getTarget: (range: SelectionRange, index: number) => number | null
): boolean {
  const nextSelection = createSelectionSet(
    state.selection.ranges.map((range, index) => {
      const target = getTarget(range, index);
      if (target === null) {
        return range;
      }

      const active = getActiveCharacterOffsetForRange(state, range);
      if (state.mode === "visual") {
        return {
          anchor: range.anchor,
          head: target,
          preferredColumn: null
        };
      }

      return {
        anchor: active,
        head: target,
        preferredColumn: null
      };
    }),
    state.selection.primaryIndex
  );

  dispatch({
    selection: nextSelection
  });
  return true;
}

function gotoTargets(
  state: EditorState,
  dispatch: EditorDispatch,
  getTarget: (range: SelectionRange, index: number) => number | null
): boolean {
  return moveSelectionsToOffsets(state, dispatch, (range, index) => ({
    cursor: getTarget(range, index) ?? getActiveCharacterOffsetForRange(state, range),
    preferredColumn: null
  }));
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

function paragraphEndAtOrAfter(doc: EditorState["doc"], lineIndex: number): number | null {
  let line = Math.max(0, Math.min(lineIndex, doc.lineCount - 1));

  while (line < doc.lineCount && doc.lineAt(line).text.trim().length === 0) {
    line += 1;
  }

  if (line >= doc.lineCount) {
    return null;
  }

  while (line + 1 < doc.lineCount && doc.lineAt(line + 1).text.trim().length > 0) {
    line += 1;
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

  return gotoTargets(state, dispatch, () => 0);
};

export const gotoLastLine: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  const lastLineIndex =
    state.doc.lineCount > 1 && state.doc.lineAt(state.doc.lineCount - 1).text.length === 0
      ? state.doc.lineCount - 2
      : state.doc.lineCount - 1;

  return gotoTargets(state, dispatch, () => state.doc.lineAt(Math.max(0, lastLineIndex)).start);
};

export const gotoLineStart: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  return gotoTargets(state, dispatch, (range) => {
    const line = state.doc.lineAt(state.doc.positionAt(getActiveCharacterOffsetForRange(state, range)).line);
    return line.start;
  });
};

export const gotoLineEnd: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  return gotoTargets(state, dispatch, (range) => {
    const line = state.doc.lineAt(state.doc.positionAt(getActiveCharacterOffsetForRange(state, range)).line);
    return Math.max(line.start, line.end - 1);
  });
};

export const gotoFirstNonWhitespace: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  return gotoTargets(state, dispatch, (range) => {
    const line = state.doc.lineAt(state.doc.positionAt(getActiveCharacterOffsetForRange(state, range)).line);
    const column = line.text.search(/\S/);
    return column < 0 ? null : line.start + column;
  });
};

export const moveWordForward: Command = (state, dispatch) => {
  if (state.mode === "normal") {
    return selectNormalWordForward(state, dispatch);
  }

  return selectToTargets(state, dispatch, (range) =>
    findNextWordEndFromOffset(state.doc.text, getActiveCharacterOffsetForRange(state, range))
  );
};

export const moveWordBackward: Command = (state, dispatch) => {
  if (state.mode === "normal") {
    return selectNormalWordBackward(state, dispatch);
  }

  return selectToTargets(state, dispatch, (range) =>
    findPreviousWordStartFromOffset(state.doc.text, getActiveCharacterOffsetForRange(state, range))
  );
};

export const moveNextWordStart: Command = (state, dispatch) => {
  return gotoTargets(state, dispatch, (range) =>
    findNextWordStartFromOffset(state.doc.text, getActiveCharacterOffsetForRange(state, range), classifyCharacter)
  );
};

export const moveNextLongWordStart: Command = (state, dispatch) => {
  return gotoTargets(state, dispatch, (range) =>
    findNextWordStartFromOffset(state.doc.text, getActiveCharacterOffsetForRange(state, range), classifyLongCharacter)
  );
};

export const movePrevLongWordStart: Command = (state, dispatch) => {
  return gotoTargets(state, dispatch, (range) =>
    findPreviousLongWordStartFromOffset(state.doc.text, getActiveCharacterOffsetForRange(state, range))
  );
};

export const moveNextLongWordEnd: Command = (state, dispatch) => {
  return gotoTargets(state, dispatch, (range) =>
    findNextLongWordEndFromOffset(state.doc.text, getActiveCharacterOffsetForRange(state, range))
  );
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
    return gotoTargets(state, dispatch, (range) =>
      findCharacterTarget(state.doc.text, getActiveCharacterOffsetForRange(state, range), targetCharacter, 1, true)
    );
  };
}

export function findPrevChar(targetCharacter: string): Command {
  return (state, dispatch) => {
    return gotoTargets(state, dispatch, (range) =>
      findCharacterTarget(state.doc.text, getActiveCharacterOffsetForRange(state, range), targetCharacter, -1, true)
    );
  };
}

export function findTillNextChar(targetCharacter: string): Command {
  return (state, dispatch) => {
    return gotoTargets(state, dispatch, (range) =>
      findCharacterTarget(state.doc.text, getActiveCharacterOffsetForRange(state, range), targetCharacter, 1, false)
    );
  };
}

export function findTillPrevChar(targetCharacter: string): Command {
  return (state, dispatch) => {
    return gotoTargets(state, dispatch, (range) =>
      findCharacterTarget(state.doc.text, getActiveCharacterOffsetForRange(state, range), targetCharacter, -1, false)
    );
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
  return gotoTargets(state, dispatch, () => state.doc.lineAt(line).start);
};

export const gotoWindowCenter: Command = (state, dispatch, context) => {
  const viewport = context.viewport;
  return gotoTargets(state, dispatch, (range) => {
    const line =
      viewport
        ? Math.floor((viewport.fromLine + viewport.toLine) / 2)
        : state.doc.positionAt(getActiveCharacterOffsetForRange(state, range)).line;
    return state.doc.lineAt(line).start;
  });
};

export const gotoWindowBottom: Command = (state, dispatch, context) => {
  const line = context.viewport?.toLine ?? Math.max(0, state.doc.lineCount - 1);
  return gotoTargets(state, dispatch, () => state.doc.lineAt(line).start);
};

export const gotoMatchingBracket: Command = (state, dispatch) => {
  if (state.doc.length === 0) {
    return true;
  }

  return gotoTargets(state, dispatch, (range) =>
    findMatchingBracketOffset(state.doc.text, getActiveCharacterOffsetForRange(state, range))
  );
};

export const gotoNextParagraph: Command = (state, dispatch) => {
  return gotoTargets(state, dispatch, (range) => {
    const currentLine = state.doc.positionAt(getActiveCharacterOffsetForRange(state, range)).line;
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

    return line >= state.doc.lineCount ? null : state.doc.lineAt(line).start;
  });
};

export const gotoPrevParagraph: Command = (state, dispatch) => {
  return gotoTargets(state, dispatch, (range) => {
    const currentLine = state.doc.positionAt(getActiveCharacterOffsetForRange(state, range)).line;
    const currentLineBlank = state.doc.lineAt(currentLine).text.trim().length === 0;
    const currentParagraphStart = paragraphStartAtOrBefore(state.doc, currentLine);

    if (currentParagraphStart === null) {
      return null;
    }

    if (!currentLineBlank && currentLine > currentParagraphStart) {
      return state.doc.lineAt(currentParagraphStart).start;
    }

    const previousParagraphStart = paragraphStartAtOrBefore(state.doc, Math.max(0, currentParagraphStart - 1));
    return previousParagraphStart === null ? null : state.doc.lineAt(previousParagraphStart).start;
  });
};

function changeAtCursorForRange(
  state: EditorState,
  range: SelectionRange,
  insert: string,
  removeBefore = 0,
  removeAfter = 0
): TextChange {
  const cursor = clampInsertionOffset(state.doc, range.head);
  return {
    from: Math.max(0, cursor - removeBefore),
    to: Math.min(state.doc.length, cursor + removeAfter),
    insert
  };
}

function createCollapsedSelectionSet(offsets: readonly number[], primaryIndex: number): SelectionSet {
  return createSelectionSet(
    offsets.map((offset) => ({
      anchor: offset,
      head: offset,
      preferredColumn: null
    })),
    primaryIndex
  );
}

function createCollapsedSelectionSetFromMappedOffsets(
  offsets: readonly number[],
  changes: readonly TextChange[],
  affinity: "left" | "right",
  primaryIndex: number
): SelectionSet {
  return createCollapsedSelectionSet(
    offsets.map((offset) => mapOffsetThroughChanges(offset, changes, affinity)),
    primaryIndex
  );
}

function selectionForInsertedText(
  doc: EditorState["doc"],
  changes: readonly TextChange[],
  insertions: readonly { from: number; insert: string }[],
  primaryIndex: number
): SelectionSet {
  return createSelectionSet(
    insertions.map(({ from, insert }) => {
      const start = clampInsertionOffset(doc, mapOffsetThroughChanges(from, changes, "left"));

      if (insert.length === 0) {
        const cursor = doc.length === 0 ? 0 : clampCharacterOffset(doc, start);
        return {
          anchor: cursor,
          head: cursor,
          preferredColumn: null
        };
      }

      const end = clampCharacterOffset(doc, Math.max(start, start + insert.length - 1));
      return {
        anchor: doc.length === 0 ? 0 : clampCharacterOffset(doc, start),
        head: end,
        preferredColumn: null
      };
    }),
    primaryIndex
  );
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
    selection: createSelection(change.from + change.insert.length, change.from + change.insert.length, null)
  });
  return true;
}

function selectionAfterDeletion(
  doc: EditorState["doc"],
  changes: readonly TextChange[],
  froms: readonly number[],
  primaryIndex: number
): SelectionSet {
  if (doc.length === 0) {
    return createCollapsedSelectionSet(froms.map(() => 0), primaryIndex);
  }

  return createSelectionSet(
    froms.map((from) => {
      const cursor = Math.max(0, Math.min(mapOffsetThroughChanges(from, changes, "left"), doc.length - 1));
      return {
        anchor: cursor,
        head: cursor,
        preferredColumn: null
      };
    }),
    primaryIndex
  );
}

export function insertText(text: string): Command {
  return (state, dispatch) => {
    const changes = state.selection.ranges
      .map((range) => changeAtCursorForRange(state, range, text))
      .sort((left, right) => right.from - left.from || right.to - left.to);
    const baseOffsets = state.selection.ranges.map((range) => range.head);
    dispatch({
      changes,
      selection: createCollapsedSelectionSetFromMappedOffsets(
        baseOffsets,
        changes,
        "right",
        state.selection.primaryIndex
      )
    });
    return true;
  };
}

export const insertNewline: Command = (state, dispatch) => insertText("\n")(state, dispatch, {});

export const deleteBackward: Command = (state, dispatch) => {
  const changes = state.selection.ranges
    .map((range) => changeAtCursorForRange(state, range, "", 1, 0))
    .filter((change) => change.from < change.to)
    .sort((left, right) => right.from - left.from || right.to - left.to);

  if (changes.length === 0) {
    return true;
  }

  dispatch({
    changes,
    selection: createCollapsedSelectionSet(
      state.selection.ranges.map((range) => mapOffsetThroughChanges(range.head, changes, "left")),
      state.selection.primaryIndex
    )
  });
  return true;
};

export function deleteBackwardIndentAware(indentText: string): Command {
  const indentWidth = Math.max(1, indentText.length);

  return (state, dispatch) => {
    if (state.selection.ranges.every((range) => range.head === 0)) {
      return true;
    }
    const changes = state.selection.ranges
      .map((range) => {
        const cursor = range.head;

        if (cursor === 0) {
          return null;
        }

        const position = state.doc.positionAt(cursor);
        const line = state.doc.lineAt(position.line);
        const linePrefix = line.text.slice(0, position.column);

        if (linePrefix.length > 0 && /^[ \t]+$/.test(linePrefix)) {
          const deleteWidth = linePrefix.length % indentWidth || indentWidth;
          return changeAtCursorForRange(state, range, "", deleteWidth, 0);
        }

        return changeAtCursorForRange(state, range, "", 1, 0);
      })
      .filter((change): change is TextChange => !!change && change.from < change.to)
      .sort((left, right) => right.from - left.from || right.to - left.to);

    if (changes.length === 0) {
      return true;
    }

    dispatch({
      changes,
      selection: createCollapsedSelectionSet(
        state.selection.ranges.map((range) => mapOffsetThroughChanges(range.head, changes, "left")),
        state.selection.primaryIndex
      )
    });
    return true;
  };
}

export const deleteForward: Command = (state, dispatch) => {
  if (state.selection.ranges.every((range) => range.head === state.doc.length)) {
    return true;
  }

  const changes = state.selection.ranges
    .map((range) => changeAtCursorForRange(state, range, "", 0, 1))
    .filter((change) => change.from < change.to)
    .sort((left, right) => right.from - left.from || right.to - left.to);

  if (changes.length === 0) {
    return true;
  }

  dispatch({
    changes,
    selection: createCollapsedSelectionSet(
      state.selection.ranges.map((range) => mapOffsetThroughChanges(range.head, changes, "left")),
      state.selection.primaryIndex
    )
  });
  return true;
};

export const deleteSelection: Command = (state, dispatch) => {
  const selections = getSelectionRanges(state);
  if (selections.every((selection) => selection.to <= selection.from)) {
    return true;
  }

  const deletedText = selections
    .filter((selection) => selection.to > selection.from)
    .map((selection) => state.doc.slice(selection.from, selection.to))
    .join("\n");
  const changes = selections
    .filter((selection) => selection.to > selection.from)
    .map(
      (selection): TextChange => ({
        from: selection.from,
        to: selection.to,
        insert: ""
      })
    )
    .sort((left, right) => right.from - left.from || right.to - left.to);
  const nextDoc = state.doc.applyChanges(changes);

  dispatch({
    changes,
    selection: selectionAfterDeletion(
      nextDoc,
      changes,
      selections.map((selection) => selection.from),
      state.selection.primaryIndex
    ),
    mode: "normal",
    insertSession: null,
    yankBuffer: deletedText,
    lastDeletedFrom: selections[state.selection.primaryIndex]?.from ?? null
  });
  return true;
};

export const changeSelection: Command = (state, dispatch, context) => {
  const selections = getSelectionRanges(state);
  if (selections.every((selection) => selection.to <= selection.from)) {
    return true;
  }

  const deletedText = selections
    .filter((selection) => selection.to > selection.from)
    .map((selection) => state.doc.slice(selection.from, selection.to))
    .join("\n");
  const changes = selections
    .filter((selection) => selection.to > selection.from)
    .map(
      (selection): TextChange => ({
        from: selection.from,
        to: selection.to,
        insert: ""
      })
    )
    .sort((left, right) => right.from - left.from || right.to - left.to);
  const primaryFrom = selections[state.selection.primaryIndex]?.from ?? 0;

  dispatch({
    changes,
    selection: createCollapsedSelectionSet(
      selections.map((selection) => selection.from),
      state.selection.primaryIndex
    ),
    mode: "insert",
    insertSession: {
      restoreOffset: primaryFrom,
      restoreAffinity: "left",
      moved: false
    },
    yankBuffer: deletedText,
    lastDeletedFrom: primaryFrom
  });
  context.requestFocus?.();
  return true;
};

export const yankSelection: Command = (state, dispatch) => {
  const selections = getSelectionRanges(state);
  const yanked = selections.map((selection) => state.doc.slice(selection.from, selection.to)).join("\n");

  dispatch({
    yankBuffer: yanked,
    lastDeletedFrom: null,
    mode: state.mode === "visual" ? "normal" : state.mode,
    selection:
      state.mode === "visual"
        ? createSelectionSet(
            state.selection.ranges.map((range) => {
              const active = getActiveCharacterOffsetForRange(state, range);
              return {
                anchor: active,
                head: active,
                preferredColumn: null
              };
            }),
            state.selection.primaryIndex
          )
        : state.selection
  });
  return true;
};

export const pasteAfter: Command = (state, dispatch) => {
  const yanked = state.yankBuffer;

  if (!yanked) {
    return true;
  }

  const insertions = state.selection.ranges.map((range, index) => {
    const selection = getSelectionOffsetsForRange(state, range);
    const insertAt =
      yanked.endsWith("\n")
        ? linewisePasteOffset({
            ...state,
            selection: createSelectionSet([range])
          })
        : state.lastDeletedFrom !== null && index === state.selection.primaryIndex
          ? state.lastDeletedFrom
          : selection.to;
    return {
      from: insertAt,
      insert: yanked
    };
  });
  const changes = insertions
    .map(
      (insertion): TextChange => ({
        from: insertion.from,
        to: insertion.from,
        insert: insertion.insert
      })
    )
    .sort((left, right) => right.from - left.from || right.to - left.to);
  const nextDoc = state.doc.applyChanges(changes);

  dispatch({
    changes,
    selection: selectionForInsertedText(nextDoc, changes, insertions, state.selection.primaryIndex),
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

function findWordTextobject(text: string, range: { from: number; to: number }, classify: CharacterClassifier) {
  if (text.length === 0) {
    return null;
  }

  const active = Math.max(0, Math.min(text.length - 1, range.from));
  const kind = classify(text[active]);

  if (!kind || kind === "whitespace") {
    return null;
  }

  return {
    from: findSegmentStartWithClassifier(text, active, classify),
    to: findSegmentEndWithClassifier(text, active, classify)
  };
}

function findParagraphTextobject(doc: EditorState["doc"], range: { from: number; to: number }) {
  const activeLine = doc.positionAt(range.from).line;
  const startLine = paragraphStartAtOrBefore(doc, activeLine);
  const endLine = paragraphEndAtOrAfter(doc, activeLine);

  if (startLine === null || endLine === null) {
    return null;
  }

  return {
    from: doc.lineAt(startLine).start,
    to: lineSelectionEndExclusive(doc, endLine)
  };
}

function surroundPair(object: string): { open: string; close: string } | null {
  switch (object) {
    case "'":
    case "\"":
    case "`":
      return { open: object, close: object };
    case "(":
    case ")":
      return { open: "(", close: ")" };
    case "[":
    case "]":
      return { open: "[", close: "]" };
    case "{":
    case "}":
      return { open: "{", close: "}" };
    case "<":
    case ">":
      return { open: "<", close: ">" };
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
    const objectRange =
      object === "w"
        ? findWordTextobject(state.doc.text, current, classifyCharacter)
        : object === "W"
          ? findWordTextobject(state.doc.text, current, classifyLongCharacter)
          : object === "p"
            ? findParagraphTextobject(state.doc, current)
            : findSurroundTextobject(state.doc.text, current, object);

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

export function addSurround(object: string): Command {
  return (state, dispatch) => {
    const pair = surroundPair(object);
    const selection = getSelectionOffsets(state);

    if (!pair || selection.to < selection.from) {
      return true;
    }

    const changes: TextChange[] = [
      { from: selection.to, to: selection.to, insert: pair.close },
      { from: selection.from, to: selection.from, insert: pair.open }
    ];
    const nextDoc = state.doc.applyChanges(changes);
    dispatch({
      changes,
      selection: createSelection(selection.from, selection.to + pair.open.length + pair.close.length - 1),
      mode: "normal"
    });
    return nextDoc.length >= 0;
  };
}

export function deleteSurround(object: string): Command {
  return (state, dispatch) => {
    if (state.doc.length === 0) {
      return true;
    }

    const current = getSelectionOffsets(state);
    const objectRange = findSurroundTextobject(state.doc.text, current, object);

    if (!objectRange || objectRange.to - objectRange.from < 2) {
      return true;
    }

    const changes: TextChange[] = [
      { from: objectRange.to - 1, to: objectRange.to, insert: "" },
      { from: objectRange.from, to: objectRange.from + 1, insert: "" }
    ];
    const nextDoc = state.doc.applyChanges(changes);
    dispatch({
      changes,
      selection: createSelection(objectRange.from, Math.max(objectRange.from, objectRange.to - 3)),
      mode: "normal"
    });
    return nextDoc.length >= 0;
  };
}

export function replaceSurround(fromObject: string, toObject: string): Command {
  return (state, dispatch) => {
    const nextPair = surroundPair(toObject);
    const current = getSelectionOffsets(state);
    const objectRange = findSurroundTextobject(state.doc.text, current, fromObject);

    if (!nextPair || !objectRange || objectRange.to - objectRange.from < 2) {
      return true;
    }

    const changes: TextChange[] = [
      { from: objectRange.to - 1, to: objectRange.to, insert: nextPair.close },
      { from: objectRange.from, to: objectRange.from + 1, insert: nextPair.open }
    ];
    dispatch({
      changes,
      selection: createSelection(objectRange.from, objectRange.to - 1),
      mode: "normal"
    });
    return true;
  };
}

export function reduceTransaction(state: EditorState, transaction: Transaction): EditorState {
  return applyTransaction(state, transaction);
}
