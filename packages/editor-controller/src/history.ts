import {
  clampCharacterOffset,
  clampInsertionOffset,
  createCharacterSelection,
  getCursorOffset,
  normalizeSelection,
  type EditorState
} from "@wx/editor-core";
import type { HistoryEntry, HistoryPlugin } from "./types";

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

export function restoreEditorState(state: EditorState, entry: HistoryEntry): EditorState {
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
