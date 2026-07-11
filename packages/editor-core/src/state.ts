import {
  createTextDocument,
  mapOffsetThroughChanges,
  type OffsetAffinity,
  type TextChange,
  type TextDocument
} from "./document";

export type EditorMode = "normal" | "insert" | "visual";
export type RegisterKind = "characterwise" | "linewise";

export function inferRegisterKind(value: string | null): RegisterKind {
  return value?.endsWith("\n") ? "linewise" : "characterwise";
}

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
  yankKind?: RegisterKind;
  lastDeletedFrom?: number | null;
  effects?: readonly EditorEffect[];
}

export interface EditorState {
  doc: TextDocument;
  selection: SelectionSet;
  mode: EditorMode;
  revision: number;
  yankBuffer: string | null;
  yankKind: RegisterKind;
  lastDeletedFrom: number | null;
  language?: string;
  theme?: string;
  insertSession: InsertSession | null;
  viewport?: {
    fromLine: number;
    toLine: number;
  };
}

export interface EditorBufferDocumentState {
  doc: TextDocument;
  revision: number;
  language?: string;
  theme?: string;
}

export interface EditorViewState {
  selection: SelectionSet;
  mode: EditorMode;
  yankBuffer: string | null;
  yankKind: RegisterKind;
  lastDeletedFrom: number | null;
  insertSession: InsertSession | null;
}

function fallbackSelectionRange(): SelectionRange {
  return { anchor: 0, head: 0, preferredColumn: null };
}

export function createSelectionSet(ranges: readonly SelectionRange[], primaryIndex = 0): SelectionSet {
  const nextRanges = ranges.length > 0 ? ranges.map((range) => ({ ...range })) : [fallbackSelectionRange()];
  return {
    ranges: nextRanges,
    primaryIndex: Math.max(0, Math.min(primaryIndex, nextRanges.length - 1))
  };
}

export function createSelection(anchor = 0, head = anchor, preferredColumn: number | null = null): SelectionSet {
  return createSelectionSet([{ anchor, head, preferredColumn }]);
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
  return createSelectionSet(
    selection.ranges.map((range, index) =>
      index === selection.primaryIndex ? { anchor: cursor, head: cursor, preferredColumn } : range
    ),
    selection.primaryIndex
  );
}

export function getSelectionOffsetsForRange(
  state: Pick<EditorState, "doc" | "mode">,
  range: SelectionRange
): { from: number; to: number } {
  const { doc, mode } = state;

  if (mode === "insert" || doc.length === 0) {
    const offset = clampInsertionOffset(doc, range.head);
    return { from: offset, to: offset };
  }

  const from = clampCharacterOffset(doc, Math.min(range.anchor, range.head));
  const to = Math.min(doc.length, clampCharacterOffset(doc, Math.max(range.anchor, range.head)) + 1);
  return { from, to };
}

export function getSelectionOffsets(state: EditorState): { from: number; to: number } {
  return getSelectionOffsetsForRange(state, getPrimaryRange(state.selection));
}

export function getSelectionRanges(state: EditorState): Array<{ from: number; to: number }> {
  return state.selection.ranges.map((range) => getSelectionOffsetsForRange(state, range));
}

export function getActiveCharacterOffsetForRange(
  state: Pick<EditorState, "doc" | "mode">,
  range: SelectionRange
): number {
  if (state.doc.length === 0) {
    return 0;
  }

  if (state.mode === "insert") {
    const offset = clampInsertionOffset(state.doc, range.head);
    return clampCharacterOffset(state.doc, offset === state.doc.length ? offset - 1 : offset);
  }

  return clampCharacterOffset(state.doc, range.head);
}

export function getActiveCharacterOffset(state: EditorState): number {
  return getActiveCharacterOffsetForRange(state, getPrimaryRange(state.selection));
}

export function createEditorState(options: {
  value?: string;
  selection?: SelectionSet | { anchor: number; head: number; preferredColumn?: number | null };
  mode?: EditorMode;
  language?: string;
  theme?: string;
} = {}): EditorState {
  const doc = createTextDocument(options.value ?? "");
  const explicitSelection =
    options.selection && "ranges" in options.selection
      ? options.selection
      : options.selection
        ? createSelectionSet([
            {
              anchor: options.selection.anchor,
              head: options.selection.head,
              preferredColumn: options.selection.preferredColumn ?? null
            }
          ])
        : undefined;
  const defaultSelection =
    explicitSelection ??
    (options.mode === "insert" ? createSelection(0, 0) : createCharacterSelection(doc, 0));
  const mode = options.mode ?? "normal";

  return {
    doc,
    selection: normalizeSelection(doc, defaultSelection, mode),
    mode,
    revision: 0,
    yankBuffer: null,
    yankKind: "characterwise",
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

export function splitEditorState(state: EditorState): {
  buffer: EditorBufferDocumentState;
  view: EditorViewState;
} {
  return {
    buffer: {
      doc: state.doc,
      revision: state.revision,
      language: state.language,
      theme: state.theme
    },
    view: {
      selection: createSelectionSet(state.selection.ranges, state.selection.primaryIndex),
      mode: state.mode,
      yankBuffer: state.yankBuffer,
      yankKind: state.yankKind,
      lastDeletedFrom: state.lastDeletedFrom,
      insertSession: state.insertSession ? { ...state.insertSession } : null
    }
  };
}

export function combineEditorState(
  buffer: EditorBufferDocumentState,
  view: EditorViewState,
  viewport: EditorState["viewport"] = { fromLine: 0, toLine: 0 }
): EditorState {
  return {
    doc: buffer.doc,
    revision: buffer.revision,
    language: buffer.language,
    theme: buffer.theme,
    selection: normalizeSelection(buffer.doc, view.selection, view.mode),
    mode: view.mode,
    yankBuffer: view.yankBuffer,
    yankKind: view.yankKind,
    lastDeletedFrom: view.lastDeletedFrom,
    insertSession: view.mode === "insert" ? view.insertSession : null,
    viewport
  };
}

export function remapEditorViewState(
  view: EditorViewState,
  doc: TextDocument,
  changes: readonly TextChange[]
): EditorViewState {
  return {
    ...view,
    selection: normalizeSelection(doc, mapSelection(view.selection, changes), view.mode),
    insertSession: view.mode === "insert" ? mapInsertSession(view.insertSession, changes) : null
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
  const nextYankBuffer = transaction.yankBuffer !== undefined ? transaction.yankBuffer : state.yankBuffer;
  const nextYankKind =
    transaction.yankKind ??
    (transaction.yankBuffer !== undefined ? inferRegisterKind(transaction.yankBuffer) : state.yankKind);

  return {
    ...state,
    doc: nextDoc,
    selection: normalizeSelection(nextDoc, nextSelection, nextMode),
    mode: nextMode,
    yankBuffer: nextYankBuffer,
    yankKind: nextYankKind,
    lastDeletedFrom: transaction.lastDeletedFrom !== undefined ? transaction.lastDeletedFrom : state.lastDeletedFrom,
    insertSession: nextInsertSession,
    revision: state.revision + 1
  };
}

export function mapSelection(selection: SelectionSet, changes: readonly TextChange[]): SelectionSet {
  if (changes.length === 0) {
    return selection;
  }

  return createSelectionSet(
    selection.ranges.map((range) => ({
      anchor: mapOffsetThroughChanges(range.anchor, changes),
      head: mapOffsetThroughChanges(range.head, changes),
      preferredColumn: range.preferredColumn
    })),
    selection.primaryIndex
  );
}

function normalizeSelectionRange(doc: TextDocument, range: SelectionRange, mode: EditorMode): SelectionRange {
  const preferredColumn = range.preferredColumn ?? null;

  if (mode === "insert") {
    const offset = clampInsertionOffset(doc, range.head);
    return {
      anchor: offset,
      head: offset,
      preferredColumn
    };
  }

  if (doc.length === 0) {
    return {
      anchor: 0,
      head: 0,
      preferredColumn
    };
  }

  return {
    anchor: clampCharacterOffset(doc, range.anchor),
    head: clampCharacterOffset(doc, range.head),
    preferredColumn
  };
}

export function normalizeSelection(doc: TextDocument, selection: SelectionSet, mode: EditorMode): SelectionSet {
  const sourceRanges = selection.ranges.length > 0 ? selection.ranges : [fallbackSelectionRange()];
  const primarySourceIndex = Math.max(0, Math.min(selection.primaryIndex, sourceRanges.length - 1));
  const entries = sourceRanges
    .map((range, index) => {
      const normalizedRange = normalizeSelectionRange(doc, range, mode);
      const offsets = getSelectionOffsetsForRange({ doc, mode }, normalizedRange);
      return {
        range: normalizedRange,
        from: offsets.from,
        to: offsets.to,
        index,
        primary: index === primarySourceIndex
      };
    })
    .sort((left, right) => {
      if (left.from !== right.from) {
        return left.from - right.from;
      }

      if (left.to !== right.to) {
        return left.to - right.to;
      }

      if (left.range.anchor !== right.range.anchor) {
        return left.range.anchor - right.range.anchor;
      }

      if (left.range.head !== right.range.head) {
        return left.range.head - right.range.head;
      }

      return left.index - right.index;
    });
  const deduped: typeof entries = [];

  for (const entry of entries) {
    const previous = deduped[deduped.length - 1];
    const duplicate =
      !!previous &&
      (mode === "insert"
        ? previous.range.head === entry.range.head
        : previous.from === entry.from && previous.to === entry.to);

    if (!duplicate) {
      deduped.push(entry);
      continue;
    }

    if (entry.primary) {
      previous.range = entry.range;
      previous.primary = true;
    }
  }

  return createSelectionSet(
    deduped.map((entry) => entry.range),
    Math.max(
      0,
      deduped.findIndex((entry) => entry.primary)
    )
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
