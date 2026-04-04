import {
  applyTransaction,
  clampCharacterOffset,
  clampInsertionOffset,
  createCharacterSelection,
  createEditorState,
  getCursorOffset,
  normalizeSelection,
  type Command,
  type CommandContext,
  type EditorState,
  type InsertSession,
  type SelectionSet,
  type Transaction
} from "@wx/editor-core";

export interface HistoryEntry {
  doc: EditorState["doc"];
  selection: SelectionSet;
  mode: EditorState["mode"];
  insertSession: InsertSession | null;
  yankBuffer: string | null;
  lastDeletedFrom: number | null;
}

export interface EditorUpdate {
  prevState: EditorState;
  nextState: EditorState;
  transaction: Transaction;
  docChanged: boolean;
  selectionChanged: boolean;
  modeChanged: boolean;
}

export type EditorUpdateListener = (update: EditorUpdate) => void;

export interface HistoryPlugin {
  record(update: EditorUpdate): void;
  undo(currentState: EditorState): HistoryEntry | null;
  redo(currentState: EditorState): HistoryEntry | null;
  clear(): void;
}

export interface EditorController {
  getState(): EditorState;
  dispatch(transaction: Transaction): void;
  replaceState(nextState: EditorState, transaction?: Transaction): void;
  execute(command: Command, context?: Omit<CommandContext, "history">): boolean;
  subscribe(listener: EditorUpdateListener): () => void;
}

export interface CreateEditorControllerOptions {
  state?: EditorState;
  value?: string;
  selection?: SelectionSet;
  mode?: EditorState["mode"];
  language?: string;
  theme?: string;
  history?: HistoryPlugin | false;
}

function createHistoryEntry(state: EditorState): HistoryEntry {
  return {
    doc: state.doc,
    selection: state.selection,
    mode: state.mode,
    insertSession: state.insertSession,
    yankBuffer: state.yankBuffer,
    lastDeletedFrom: state.lastDeletedFrom
  };
}

function selectionEquals(left: SelectionSet, right: SelectionSet): boolean {
  if (left.primaryIndex !== right.primaryIndex || left.ranges.length !== right.ranges.length) {
    return false;
  }

  return left.ranges.every((range, index) => {
    const other = right.ranges[index];
    return (
      !!other &&
      range.anchor === other.anchor &&
      range.head === other.head &&
      range.preferredColumn === other.preferredColumn
    );
  });
}

function normalizeHistoryRestoreEntry(entry: HistoryEntry): HistoryEntry {
  if (entry.mode !== "insert") {
    return entry;
  }

  const cursor = clampInsertionOffset(entry.doc, getCursorOffset(entry.selection));
  const position = entry.doc.positionAt(cursor);
  const previousCharacter = cursor > 0 ? entry.doc.text[cursor - 1] : undefined;
  const nextCursor =
    entry.doc.length === 0
      ? 0
      : clampCharacterOffset(entry.doc, cursor > 0 && position.column > 0 && previousCharacter !== "\n" ? cursor - 1 : cursor);

  return {
    ...entry,
    mode: "normal",
    selection: createCharacterSelection(entry.doc, nextCursor),
    insertSession: null
  };
}

function restoreEditorState(state: EditorState, entry: HistoryEntry): EditorState {
  const normalized = normalizeHistoryRestoreEntry(entry);

  return {
    ...state,
    doc: normalized.doc,
    selection: normalizeSelection(normalized.doc, normalized.selection, normalized.mode),
    mode: normalized.mode,
    yankBuffer: normalized.yankBuffer,
    lastDeletedFrom: normalized.lastDeletedFrom,
    insertSession: normalized.mode === "insert" ? normalized.insertSession : null,
    revision: state.revision + 1
  };
}

export function createSnapshotHistory(): HistoryPlugin {
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];

  return {
    record(update) {
      if (!update.docChanged) {
        return;
      }

      undoStack.push(createHistoryEntry(update.prevState));
      redoStack.length = 0;
    },
    undo(currentState) {
      const previous = undoStack.pop() ?? null;

      if (!previous) {
        return null;
      }

      redoStack.push(createHistoryEntry(currentState));
      return previous;
    },
    redo(currentState) {
      const next = redoStack.pop() ?? null;

      if (!next) {
        return null;
      }

      undoStack.push(createHistoryEntry(currentState));
      return next;
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    }
  };
}

export function createEditorController(options: CreateEditorControllerOptions = {}): EditorController {
  let state =
    options.state ??
    createEditorState({
      value: options.value,
      selection: options.selection,
      mode: options.mode,
      language: options.language,
      theme: options.theme
    });
  const listeners = new Set<EditorUpdateListener>();
  const history = options.history === false ? null : options.history ?? createSnapshotHistory();

  const notify = (
    prevState: EditorState,
    nextState: EditorState,
    transaction: Transaction,
    options: { recordHistory?: boolean } = {}
  ) => {
    const update: EditorUpdate = {
      prevState,
      nextState,
      transaction,
      docChanged: prevState.doc.text !== nextState.doc.text,
      selectionChanged: !selectionEquals(prevState.selection, nextState.selection),
      modeChanged: prevState.mode !== nextState.mode
    };

    if (options.recordHistory !== false && update.docChanged) {
      history?.record(update);
    }

    for (const listener of listeners) {
      listener(update);
    }
  };

  const dispatch = (transaction: Transaction) => {
    const prevState = state;
    state = applyTransaction(state, transaction);
    notify(prevState, state, transaction);
  };

  const applyHistoryEntry = (entry: HistoryEntry | null, effectType: string) => {
    if (!entry) {
      return false;
    }

    const prevState = state;
    state = restoreEditorState(state, entry);
    notify(prevState, state, {
      effects: [{ type: effectType }]
    }, { recordHistory: false });
    return true;
  };

  const historyControls: NonNullable<CommandContext["history"]> = {
    undo: () => applyHistoryEntry(history?.undo(state) ?? null, "history.undo"),
    redo: () => applyHistoryEntry(history?.redo(state) ?? null, "history.redo")
  };

  return {
    getState() {
      return state;
    },
    dispatch,
    replaceState(nextState, transaction = { effects: [{ type: "controller.replace-state" }] }) {
      const prevState = state;
      state = {
        ...nextState,
        revision: prevState.revision + 1
      };
      history?.clear();
      notify(prevState, state, transaction, { recordHistory: false });
    },
    execute(command, context = {}) {
      return command(state, dispatch, {
        ...context,
        history: historyControls
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
