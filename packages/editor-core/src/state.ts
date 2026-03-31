import {
  createTextDocument,
  mapOffsetThroughChanges,
  type OffsetAffinity,
  type TextChange,
  type TextDocument
} from "./document";

export type EditorMode = "normal" | "insert" | "visual";

export interface SelectionRange {
  anchor: number;
  head: number;
  preferredColumn: number | null;
}

export interface SelectionSet {
  ranges: SelectionRange[];
  primaryIndex: number;
}

export interface EditorEffect {
  type: string;
  value?: unknown;
}

export interface InsertSession {
  restoreOffset: number;
  restoreAffinity: OffsetAffinity;
  moved: boolean;
}

export interface Transaction {
  changes?: readonly TextChange[];
  selection?: SelectionSet;
  mode?: EditorMode;
  insertSession?: InsertSession | null;
  yankBuffer?: string | null;
  lastDeletedFrom?: number | null;
  effects?: readonly EditorEffect[];
}

export interface EditorState {
  doc: TextDocument;
  selection: SelectionSet;
  mode: EditorMode;
  revision: number;
  yankBuffer: string | null;
  lastDeletedFrom: number | null;
  language?: string;
  theme?: string;
  insertSession: InsertSession | null;
  viewport?: {
    fromLine: number;
    toLine: number;
  };
}

export function createSelection(anchor = 0, head = anchor, preferredColumn: number | null = null): SelectionSet {
  return {
    ranges: [{ anchor, head, preferredColumn }],
    primaryIndex: 0
  };
}

export function clampInsertionOffset(doc: TextDocument, offset: number): number {
  return Math.max(0, Math.min(offset, doc.length));
}

export function clampCharacterOffset(doc: TextDocument, offset: number): number {
  if (doc.length === 0) {
    return 0;
  }

  return Math.max(0, Math.min(offset, doc.length - 1));
}

export function createCharacterSelection(doc: TextDocument, cursor = 0, preferredColumn: number | null = null): SelectionSet {
  const nextCursor = clampCharacterOffset(doc, cursor);
  return createSelection(nextCursor, nextCursor, preferredColumn);
}

export function getPrimaryRange(selection: SelectionSet): SelectionRange {
  return selection.ranges[selection.primaryIndex] ?? selection.ranges[0];
}

export function getCursorOffset(selection: SelectionSet): number {
  return getPrimaryRange(selection).head;
}

export function withCursor(selection: SelectionSet, cursor: number, preferredColumn: number | null = null): SelectionSet {
  const next = createSelection(cursor, cursor, preferredColumn);
  return {
    ...next,
    primaryIndex: selection.primaryIndex
  };
}

export function getSelectionOffsets(state: EditorState): { from: number; to: number } {
  const range = getPrimaryRange(state.selection);

  if (state.mode === "insert" || state.doc.length === 0) {
    const offset = clampInsertionOffset(state.doc, range.head);
    return { from: offset, to: offset };
  }

  const from = clampCharacterOffset(state.doc, Math.min(range.anchor, range.head));
  const to = Math.min(state.doc.length, clampCharacterOffset(state.doc, Math.max(range.anchor, range.head)) + 1);
  return { from, to };
}

export function getActiveCharacterOffset(state: EditorState): number {
  if (state.doc.length === 0) {
    return 0;
  }

  if (state.mode === "insert") {
    const offset = clampInsertionOffset(state.doc, getCursorOffset(state.selection));
    return clampCharacterOffset(state.doc, offset === state.doc.length ? offset - 1 : offset);
  }

  return clampCharacterOffset(state.doc, getCursorOffset(state.selection));
}

export function createEditorState(options: {
  value?: string;
  selection?: SelectionSet;
  mode?: EditorMode;
  language?: string;
  theme?: string;
} = {}): EditorState {
  const doc = createTextDocument(options.value ?? "");
  const defaultSelection =
    options.selection ??
    (options.mode === "insert" ? createSelection(0, 0) : createCharacterSelection(doc, 0));

  return {
    doc,
    selection: defaultSelection,
    mode: options.mode ?? "normal",
    revision: 0,
    yankBuffer: null,
    lastDeletedFrom: null,
    language: options.language,
    theme: options.theme,
    insertSession: null,
    viewport: {
      fromLine: 0,
      toLine: 0
    }
  };
}

export function applyTransaction(state: EditorState, transaction: Transaction): EditorState {
  const changes = transaction.changes ?? [];
  const nextDoc = changes.length > 0 ? state.doc.applyChanges(changes) : state.doc;
  const nextSelection = transaction.selection ?? mapSelection(state.selection, changes);
  const nextMode = transaction.mode ?? state.mode;
  const nextInsertSession =
    nextMode === "insert"
      ? transaction.insertSession !== undefined
        ? transaction.insertSession
        : mapInsertSession(state.insertSession, changes)
      : null;

  return {
    ...state,
    doc: nextDoc,
    selection: normalizeSelection(nextDoc, nextSelection, nextMode),
    mode: nextMode,
    yankBuffer: transaction.yankBuffer ?? state.yankBuffer,
    lastDeletedFrom: transaction.lastDeletedFrom !== undefined ? transaction.lastDeletedFrom : state.lastDeletedFrom,
    insertSession: nextInsertSession,
    revision: state.revision + 1
  };
}

export function mapSelection(selection: SelectionSet, changes: readonly TextChange[]): SelectionSet {
  if (changes.length === 0) {
    return selection;
  }

  return {
    primaryIndex: selection.primaryIndex,
    ranges: selection.ranges.map((range) => ({
      anchor: mapOffsetThroughChanges(range.anchor, changes),
      head: mapOffsetThroughChanges(range.head, changes),
      preferredColumn: range.preferredColumn
    }))
  };
}

export function normalizeSelection(doc: TextDocument, selection: SelectionSet, mode: EditorMode): SelectionSet {
  const range = getPrimaryRange(selection);
  const preferredColumn = range.preferredColumn;

  if (mode === "insert") {
    const offset = clampInsertionOffset(doc, range.head);
    return createSelection(offset, offset, preferredColumn);
  }

  if (doc.length === 0) {
    return createSelection(0, 0, preferredColumn);
  }

  return createSelection(
    clampCharacterOffset(doc, range.anchor),
    clampCharacterOffset(doc, range.head),
    preferredColumn
  );
}

function mapInsertSession(session: InsertSession | null, changes: readonly TextChange[]): InsertSession | null {
  if (!session || changes.length === 0) {
    return session;
  }

  return {
    ...session,
    restoreOffset: mapOffsetThroughChanges(session.restoreOffset, changes, session.restoreAffinity)
  };
}
