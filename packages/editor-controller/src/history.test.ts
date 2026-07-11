import { describe, expect, it } from "vitest";

import {
  applyTransaction,
  createEditorState,
  enterInsertMode,
  enterNormalMode,
  getDocumentStorageStats,
  insertText,
  moveRight,
  type EditorState,
  type TextChange
} from "@mewhhaha/wx-core";

import { restoreEditorState, createSnapshotHistory } from "./history";
import { createEditorController } from "./index";
import type { EditorUpdate, HistoryEntry, HistoryPlugin } from "./types";

function recordChange(history: HistoryPlugin, state: EditorState, change: TextChange): EditorState {
  const nextState = applyTransaction(state, { changes: [change] });
  const update: EditorUpdate = {
    prevState: state,
    nextState,
    transaction: { changes: [change] },
    docChanged: state.doc !== nextState.doc,
    selectionChanged: false,
    modeChanged: false
  };
  history.record(update);
  return nextState;
}

function applyEntry(state: EditorState, entry: HistoryEntry | null): EditorState {
  if (!entry) {
    return state;
  }
  return restoreEditorState(state, entry);
}

describe("snapshot history limits", () => {
  it("bounds undo and redo snapshots together by maxEntries", () => {
    const history = createSnapshotHistory({ maxEntries: 2, maxRetainedBytes: 1024 * 1024 });
    let state = createEditorState({ value: "", mode: "normal" });
    for (const insert of ["a", "b", "c", "d"]) {
      state = recordChange(history, state, { from: state.doc.length, to: state.doc.length, insert });
    }

    expect(history.getStats?.()).toMatchObject({ undoEntries: 2, redoEntries: 0, totalEntries: 2 });
    state = applyEntry(state, history.undo(state));
    expect(state.doc.text).toBe("abc");
    state = applyEntry(state, history.undo(state));
    expect(state.doc.text).toBe("ab");
    expect(history.undo(state)).toBeNull();

    state = applyEntry(state, history.redo(state));
    expect(state.doc.text).toBe("abc");
    state = applyEntry(state, history.redo(state));
    expect(state.doc.text).toBe("abcd");
    expect(history.redo(state)).toBeNull();
  });

  it("enforces an estimated unique retained-byte budget", () => {
    const maxRetainedBytes = 5_000;
    const history = createSnapshotHistory({ maxEntries: 100, maxRetainedBytes });
    let state = createEditorState({ value: "z".repeat(500), mode: "normal" });
    for (let index = 0; index < 20; index += 1) {
      state = recordChange(history, state, {
        from: state.doc.length,
        to: state.doc.length,
        insert: String(index % 10)
      });
      expect(history.getStats?.().retainedBytes).toBeLessThanOrEqual(maxRetainedBytes);
    }

    const stats = history.getStats?.();
    expect(stats?.totalEntries).toBeGreaterThan(0);
    expect(stats?.totalEntries).toBeLessThan(20);
    expect(stats).toMatchObject({ maxEntries: 100, maxRetainedBytes });
  });

  it("allows zero-sized budgets without retaining a pending insert group", () => {
    const history = createSnapshotHistory({ maxEntries: 0, maxRetainedBytes: 0 });
    const state = createEditorState({ value: "abc", mode: "insert" });
    const nextState = recordChange(history, state, { from: 0, to: 0, insert: "x" });

    expect(history.getStats?.()).toMatchObject({ totalEntries: 0, pendingInsertGroup: false, retainedBytes: 0 });
    expect(history.undo(nextState)).toBeNull();
  });

  it("drops derived whole-text caches from inactive revisions", () => {
    const history = createSnapshotHistory();
    const state = createEditorState({ value: "line\n".repeat(1_000), mode: "normal" });
    void state.doc.text;
    expect(getDocumentStorageStats(state.doc).textMaterialized).toBe(true);

    recordChange(history, state, { from: state.doc.length, to: state.doc.length, insert: "x" });

    expect(getDocumentStorageStats(state.doc).textMaterialized).toBe(false);
  });

  it("keeps a sustained 20,000-line workload within both default hard limits", () => {
    const history = createSnapshotHistory();
    const text = Array.from({ length: 20_000 }, (_, index) => `const value${index} = ${index};`).join("\n");
    let state = createEditorState({ value: text, mode: "normal" });
    for (let index = 0; index < 250; index += 1) {
      state = recordChange(history, state, { from: state.doc.length, to: state.doc.length, insert: "x" });
    }

    const stats = history.getStats?.();
    expect(stats?.totalEntries).toBe(200);
    expect(stats?.retainedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
});

describe("controller history integration", () => {
  it("preserves grouped insertion and the before/after selections through undo and redo", () => {
    const controller = createEditorController({ value: "abc" });
    const before = controller.getState().selection;

    controller.execute(enterInsertMode);
    controller.execute(insertText("x"));
    controller.execute(insertText("y"));
    controller.execute(enterNormalMode);
    const after = controller.getState().selection;
    expect(controller.getState().doc.text).toBe("xyabc");

    controller.execute((_state, _dispatch, context) => context.history?.undo() ?? false);
    expect(controller.getState().doc.text).toBe("abc");
    expect(controller.getState().selection).toEqual(before);

    controller.execute((_state, _dispatch, context) => context.history?.redo() ?? false);
    expect(controller.getState().doc.text).toBe("xyabc");
    expect(controller.getState().selection).toEqual(after);
  });

  it("does not materialize document text for cursor-only lifecycle updates", () => {
    const controller = createEditorController({ value: "alpha\nbeta" });
    const doc = controller.getState().doc;
    expect(getDocumentStorageStats(doc).textMaterialized).toBe(false);

    controller.execute(moveRight);

    expect(controller.getState().doc).toBe(doc);
    expect(getDocumentStorageStats(doc).textMaterialized).toBe(false);
  });

  it("passes historyOptions to the default controller history", () => {
    const controller = createEditorController({
      value: "abc",
      mode: "insert",
      historyOptions: { maxEntries: 0 }
    });
    controller.execute(insertText("x"));
    controller.execute((_state, _dispatch, context) => context.history?.undo() ?? false);

    expect(controller.getState().doc.text).toBe("xabc");
  });
});
