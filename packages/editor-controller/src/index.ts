import {
  applyTransaction,
  clampCharacterOffset,
  clampInsertionOffset,
  createCharacterSelection,
  createEditorState,
  getCursorOffset,
  getSelectionOffsets,
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

export interface EditorSearchState {
  query: string;
  direction: "forward" | "backward";
  lastMatch: { from: number; to: number } | null;
}

export interface EditorJumpEntry {
  selection: SelectionSet;
  mode: EditorState["mode"];
}

export interface EditorRegisterState {
  unnamed: string | null;
  search: string | null;
  named: Record<string, string>;
  selected: string | null;
}

export type EditorUpdateListener = (update: EditorUpdate) => void;

export interface HistoryPlugin {
  record(update: EditorUpdate, options?: { checkpoint?: boolean }): void;
  undo(currentState: EditorState): HistoryEntry | null;
  redo(currentState: EditorState): HistoryEntry | null;
  checkpoint(): boolean;
  clear(): void;
}

export interface EditorController {
  getState(): EditorState;
  dispatch(transaction: Transaction): void;
  replaceState(nextState: EditorState, transaction?: Transaction): void;
  execute(command: Command, context?: Omit<CommandContext, "history">): boolean;
  subscribe(listener: EditorUpdateListener): () => void;
  getSearchState(): EditorSearchState;
  setSearchState(next: Partial<EditorSearchState>): void;
  clearSearchState(): void;
  pushJump(): boolean;
  jumpBackward(): EditorJumpEntry | null;
  jumpForward(): EditorJumpEntry | null;
  getJumpList(): readonly EditorJumpEntry[];
  getRegister(name?: string | null): string | null;
  setRegister(name: string | null, value: string | null): void;
  selectRegister(name: string | null): void;
  getSelectedRegister(): string | null;
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

function jumpEntryEquals(left: EditorJumpEntry, right: EditorJumpEntry): boolean {
  return left.mode === right.mode && selectionEquals(left.selection, right.selection);
}

function createJumpEntry(state: EditorState): EditorJumpEntry {
  return {
    selection: state.selection,
    mode: state.mode
  };
}

function normalizeRegisterName(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }

  return name.toLowerCase();
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
  let pendingInsertGroup: HistoryEntry | null = null;

  const flushPendingInsertGroup = (): boolean => {
    if (!pendingInsertGroup) {
      return false;
    }

    undoStack.push(pendingInsertGroup);
    pendingInsertGroup = null;
    return true;
  };

  return {
    record(update, options = {}) {
      if (options.checkpoint) {
        flushPendingInsertGroup();
      }

      if (!update.docChanged) {
        return;
      }

      if (update.nextState.mode === "insert") {
        pendingInsertGroup ??= createHistoryEntry(update.prevState);
        redoStack.length = 0;
        return;
      }

      flushPendingInsertGroup();
      undoStack.push(createHistoryEntry(update.prevState));
      redoStack.length = 0;
    },
    undo(currentState) {
      flushPendingInsertGroup();
      const previous = undoStack.pop() ?? null;

      if (!previous) {
        return null;
      }

      redoStack.push(createHistoryEntry(currentState));
      return previous;
    },
    redo(currentState) {
      flushPendingInsertGroup();
      const next = redoStack.pop() ?? null;

      if (!next) {
        return null;
      }

      undoStack.push(createHistoryEntry(currentState));
      return next;
    },
    checkpoint() {
      return flushPendingInsertGroup();
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      pendingInsertGroup = null;
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
  let searchState: EditorSearchState = {
    query: "",
    direction: "forward",
    lastMatch: null
  };
  const jumpList: EditorJumpEntry[] = [];
  let jumpCursor = 0;
  const registers: EditorRegisterState = {
    unnamed: null,
    search: null,
    named: {},
    selected: null
  };

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

    const shouldCheckpointHistory = prevState.mode === "insert" && nextState.mode !== "insert";

    if (options.recordHistory !== false && (update.docChanged || shouldCheckpointHistory)) {
      history?.record(update, { checkpoint: shouldCheckpointHistory });
    }

    if (update.nextState.yankBuffer !== update.prevState.yankBuffer) {
      registers.unnamed = update.nextState.yankBuffer;
      const selected = normalizeRegisterName(registers.selected);

      if (selected && selected !== "/") {
        if (registers.unnamed === null) {
          delete registers.named[selected];
        } else {
          registers.named[selected] = registers.unnamed;
        }
      }
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
    redo: () => applyHistoryEntry(history?.redo(state) ?? null, "history.redo"),
    checkpoint: () => history?.checkpoint() ?? false
  };

  const trimJumpTail = () => {
    if (jumpCursor < jumpList.length) {
      jumpList.splice(jumpCursor);
    }
  };

  const pushJumpEntry = (entry: EditorJumpEntry): boolean => {
    trimJumpTail();
    const previous = jumpList[jumpList.length - 1];

    if (previous && jumpEntryEquals(previous, entry)) {
      jumpCursor = jumpList.length;
      return false;
    }

    jumpList.push(entry);
    if (jumpList.length > 100) {
      jumpList.shift();
    }
    jumpCursor = jumpList.length;
    return true;
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
    },
    getSearchState() {
      return searchState;
    },
    setSearchState(next) {
      searchState = {
        ...searchState,
        ...next
      };
      if (typeof next.query === "string") {
        registers.search = next.query;
      }
    },
    clearSearchState() {
      searchState = {
        query: "",
        direction: "forward",
        lastMatch: null
      };
    },
    pushJump() {
      return pushJumpEntry(createJumpEntry(state));
    },
    jumpBackward() {
      if (jumpList.length === 0) {
        return null;
      }

      if (jumpCursor === jumpList.length) {
        pushJumpEntry(createJumpEntry(state));
      }

      if (jumpCursor <= 1) {
        return null;
      }

      jumpCursor -= 2;
      const target = jumpList[jumpCursor] ?? null;
      jumpCursor += 1;
      return target;
    },
    jumpForward() {
      if (jumpCursor >= jumpList.length) {
        return null;
      }

      const target = jumpList[jumpCursor] ?? null;
      if (!target) {
        return null;
      }

      jumpCursor += 1;
      return target;
    },
    getJumpList() {
      return [...jumpList];
    },
    getRegister(name = null) {
      const normalized = normalizeRegisterName(name ?? registers.selected);
      if (!normalized || normalized === "\"") {
        return registers.unnamed;
      }
      if (normalized === "/") {
        return registers.search;
      }
      return registers.named[normalized] ?? null;
    },
    setRegister(name, value) {
      const normalized = normalizeRegisterName(name);
      if (!normalized || normalized === "\"") {
        registers.unnamed = value;
        return;
      }
      if (normalized === "/") {
        registers.search = value;
        return;
      }
      if (value === null) {
        delete registers.named[normalized];
      } else {
        registers.named[normalized] = value;
      }
    },
    selectRegister(name) {
      registers.selected = normalizeRegisterName(name);
    },
    getSelectedRegister() {
      return registers.selected;
    }
  };
}
