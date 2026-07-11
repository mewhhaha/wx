import {
  clampCharacterOffset,
  clampInsertionOffset,
  createCharacterSelection,
  getCursorOffset,
  getDocumentRetentionStats,
  inferRegisterKind,
  normalizeSelection,
  releaseDocumentTextCache,
  type EditorState
} from "@mewhhaha/wx-core";
import type {
  HistoryEntry,
  HistoryPlugin,
  SnapshotHistoryOptions,
  SnapshotHistoryStats
} from "./types";

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_RETAINED_BYTES = 8 * 1024 * 1024;
const HISTORY_ENTRY_BASE_BYTES = 160;
const SELECTION_RANGE_BYTES = 32;

interface StoredHistoryEntry {
  readonly entry: HistoryEntry;
  readonly sequence: number;
}

function createHistoryEntry(state: EditorState): HistoryEntry {
  // `text` is a derived compatibility view. Keeping it on inactive revisions would
  // turn otherwise shared history back into whole-document snapshots.
  releaseDocumentTextCache(state.doc);
  return {
    doc: state.doc,
    selection: state.selection,
    mode: state.mode,
    insertSession: state.insertSession,
    yankBuffer: state.yankBuffer,
    yankKind: state.yankKind,
    lastDeletedFrom: state.lastDeletedFrom
  };
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function entryRetainedBytes(entry: HistoryEntry): number {
  return (
    HISTORY_ENTRY_BASE_BYTES +
    entry.selection.ranges.length * SELECTION_RANGE_BYTES +
    (entry.yankBuffer?.length ?? 0) * 2
  );
}

function normalizeHistoryRestoreEntry(entry: HistoryEntry): HistoryEntry {
  if (entry.mode !== "insert") {
    return entry;
  }

  const cursor = clampInsertionOffset(entry.doc, getCursorOffset(entry.selection));
  const position = entry.doc.positionAt(cursor);
  const previousCharacter = cursor > 0 ? entry.doc.charAt(cursor - 1) : undefined;
  const nextCursor =
    entry.doc.length === 0
      ? 0
      : clampCharacterOffset(
          entry.doc,
          cursor > 0 && position.column > 0 && previousCharacter !== "\n" ? cursor - 1 : cursor
        );

  return {
    ...entry,
    mode: "normal",
    selection: createCharacterSelection(entry.doc, nextCursor),
    insertSession: null
  };
}

export function restoreEditorState(state: EditorState, entry: HistoryEntry): EditorState {
  const normalized = normalizeHistoryRestoreEntry(entry);

  return {
    ...state,
    doc: normalized.doc,
    selection: normalizeSelection(normalized.doc, normalized.selection, normalized.mode),
    mode: normalized.mode,
    yankBuffer: normalized.yankBuffer,
    yankKind: normalized.yankKind ?? inferRegisterKind(normalized.yankBuffer),
    lastDeletedFrom: normalized.lastDeletedFrom,
    insertSession: normalized.mode === "insert" ? normalized.insertSession : null,
    revision: state.revision + 1
  };
}

export function createSnapshotHistory(options: SnapshotHistoryOptions = {}): HistoryPlugin {
  const maxEntries = normalizeLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxRetainedBytes = normalizeLimit(options.maxRetainedBytes, DEFAULT_MAX_RETAINED_BYTES);
  const undoStack: StoredHistoryEntry[] = [];
  const redoStack: StoredHistoryEntry[] = [];
  let pendingInsertGroup: StoredHistoryEntry | null = null;
  let nextSequence = 0;

  const store = (entry: HistoryEntry): StoredHistoryEntry => ({ entry, sequence: nextSequence++ });

  const retainedEntries = (): StoredHistoryEntry[] => [
    ...undoStack,
    ...redoStack,
    ...(pendingInsertGroup ? [pendingInsertGroup] : [])
  ];

  const retainedBytes = (): number => {
    const entries = retainedEntries();
    const documents = getDocumentRetentionStats(entries.map((item) => item.entry.doc));
    return documents.totalBytes + entries.reduce((total, item) => total + entryRetainedBytes(item.entry), 0);
  };

  const totalEntries = (): number => undoStack.length + redoStack.length + (pendingInsertGroup ? 1 : 0);

  const removeOldest = (): boolean => {
    const candidates = [
      undoStack[0] ? { source: "undo" as const, sequence: undoStack[0].sequence } : null,
      redoStack[0] ? { source: "redo" as const, sequence: redoStack[0].sequence } : null,
      pendingInsertGroup ? { source: "pending" as const, sequence: pendingInsertGroup.sequence } : null
    ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
    candidates.sort((left, right) => left.sequence - right.sequence);
    const oldest = candidates[0];
    if (!oldest) {
      return false;
    }

    if (oldest.source === "undo") {
      undoStack.shift();
    } else if (oldest.source === "redo") {
      redoStack.shift();
    } else {
      pendingInsertGroup = null;
    }
    return true;
  };

  const enforceLimits = (): void => {
    while (totalEntries() > maxEntries || retainedBytes() > maxRetainedBytes) {
      if (!removeOldest()) {
        break;
      }
    }
  };

  const pushUndo = (item: StoredHistoryEntry): void => {
    undoStack.push(item);
    enforceLimits();
  };

  const pushRedo = (item: StoredHistoryEntry): void => {
    redoStack.push(item);
    enforceLimits();
  };

  const flushPendingInsertGroup = (): boolean => {
    if (!pendingInsertGroup) {
      return false;
    }

    const pending = pendingInsertGroup;
    pendingInsertGroup = null;
    pushUndo(pending);
    return true;
  };

  const getStats = (): SnapshotHistoryStats => ({
    undoEntries: undoStack.length,
    redoEntries: redoStack.length,
    pendingInsertGroup: pendingInsertGroup !== null,
    totalEntries: totalEntries(),
    retainedBytes: retainedBytes(),
    maxEntries,
    maxRetainedBytes
  });

  return {
    record(update, recordOptions = {}) {
      if (recordOptions.checkpoint) {
        flushPendingInsertGroup();
      }

      if (!update.docChanged) {
        return;
      }

      if (update.nextState.mode === "insert") {
        pendingInsertGroup ??= store(createHistoryEntry(update.prevState));
        redoStack.length = 0;
        enforceLimits();
        return;
      }

      // A new non-insert edit starts a branch; release redo documents before
      // evaluating the new branch against the shared retained-byte budget.
      redoStack.length = 0;
      flushPendingInsertGroup();
      pushUndo(store(createHistoryEntry(update.prevState)));
      enforceLimits();
    },
    undo(currentState) {
      flushPendingInsertGroup();
      const previous = undoStack.pop() ?? null;
      if (!previous) {
        return null;
      }

      pushRedo(store(createHistoryEntry(currentState)));
      return previous.entry;
    },
    redo(currentState) {
      flushPendingInsertGroup();
      const next = redoStack.pop() ?? null;
      if (!next) {
        return null;
      }

      pushUndo(store(createHistoryEntry(currentState)));
      return next.entry;
    },
    checkpoint() {
      return flushPendingInsertGroup();
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      pendingInsertGroup = null;
    },
    getStats
  };
}
