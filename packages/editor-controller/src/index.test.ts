import { describe, expect, it, vi } from "vitest";

import { enterInsertMode, enterNormalMode, insertText, moveRight } from "@wx/editor-core";

import { createEditorController } from "./index";

describe("editor controller", () => {
  it("emits deterministic updates for command execution", () => {
    const controller = createEditorController({ value: "abc" });
    const updates: string[] = [];

    controller.subscribe((update) => {
      if (update.docChanged) {
        updates.push("doc");
      } else if (update.selectionChanged) {
        updates.push("selection");
      } else if (update.modeChanged) {
        updates.push("mode");
      }
    });

    controller.execute(moveRight);
    controller.execute(enterInsertMode);
    controller.execute(insertText("x"));

    expect(updates).toEqual(["selection", "mode", "doc"]);
  });

  it("supports undo and redo through command context history", () => {
    const controller = createEditorController({ value: "abc", mode: "insert" });

    controller.execute(insertText("d"));
    expect(controller.getState().doc.text).toBe("dabc");

    controller.execute((_state, _dispatch, context) => context.history?.undo() ?? false);
    expect(controller.getState().doc.text).toBe("abc");

    controller.execute((_state, _dispatch, context) => context.history?.redo() ?? false);
    expect(controller.getState().doc.text).toBe("dabc");
  });

  it("groups insert mode edits into one undo step after leaving insert mode", () => {
    const controller = createEditorController({ value: "abc" });

    controller.execute(enterInsertMode);
    controller.execute(insertText("x"));
    controller.execute(insertText("y"));
    controller.execute(enterNormalMode);

    expect(controller.getState().doc.text).toBe("xyabc");

    controller.execute((_state, _dispatch, context) => context.history?.undo() ?? false);
    expect(controller.getState().doc.text).toBe("abc");

    controller.execute((_state, _dispatch, context) => context.history?.redo() ?? false);
    expect(controller.getState().doc.text).toBe("xyabc");
  });

  it("supports manual undo checkpoints inside insert mode", () => {
    const controller = createEditorController({ value: "abc" });

    controller.execute(enterInsertMode);
    controller.execute(insertText("x"));
    controller.execute((_state, _dispatch, context) => context.history?.checkpoint?.() ?? false);
    controller.execute(insertText("y"));
    controller.execute(enterNormalMode);

    expect(controller.getState().doc.text).toBe("xyabc");

    controller.execute((_state, _dispatch, context) => context.history?.undo() ?? false);
    expect(controller.getState().doc.text).toBe("xabc");

    controller.execute((_state, _dispatch, context) => context.history?.undo() ?? false);
    expect(controller.getState().doc.text).toBe("abc");
  });

  it("clears history when state is replaced externally", () => {
    const controller = createEditorController({ value: "abc", mode: "insert" });

    controller.execute(insertText("d"));
    expect(controller.getState().doc.text).toBe("dabc");

    controller.replaceState(createEditorController({ value: "xyz" }).getState());
    controller.execute((_state, _dispatch, context) => context.history?.undo() ?? false);

    expect(controller.getState().doc.text).toBe("xyz");
  });

  it("stores search state, registers, and jump snapshots outside editor state", () => {
    const controller = createEditorController({ value: "alpha\nbeta" });

    controller.setSearchState({ query: "beta", direction: "forward", lastMatch: { from: 6, to: 10 } });
    controller.setRegister("a", "alpha");
    controller.pushJump();
    controller.execute(moveRight);

    expect(controller.getSearchState().query).toBe("beta");
    expect(controller.getRegister("a")).toBe("alpha");
    expect(controller.getJumpList()).toHaveLength(1);
    expect(controller.jumpBackward()?.selection.ranges[0]?.head).toBe(0);
  });

  it("stores visible highlight slices in the controller presentation state", async () => {
    const highlighter = {
      open: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      getHighlights: vi.fn(async (viewport: { fromLine: number; toLine: number }) => {
        if (viewport.fromLine === 0) {
          return [{ from: 0, to: 5, role: "keyword" as const }];
        }

        return [{ from: 6, to: 10, role: "keyword" as const }];
      })
    };
    const controller = createEditorController({ value: "alpha\nbeta" });

    controller.setLanguageServices([{ highlighter }]);
    controller.setViewportMetrics({ visibleRowCapacity: 1, wrapColumns: 80, softWrap: false });
    await controller.refreshLanguage({
      forceDocumentSync: true,
      highlightViewport: { fromLine: 0, toLine: 0 },
      refreshDiagnostics: false,
      refreshLineChanges: false
    });

    expect(controller.getPresentationState().language.visibleHighlights).toEqual([
      { from: 0, to: 5, role: "keyword" }
    ]);

    controller.scrollViewportBy(1);
    expect(controller.getPresentationState().language.visibleHighlights).toEqual([]);

    await controller.refreshLanguage({
      highlightViewport: { fromLine: 1, toLine: 1 },
      refreshDiagnostics: false,
      refreshLineChanges: false
    });

    expect(controller.getPresentationState().language.visibleHighlights).toEqual([
      { from: 6, to: 10, role: "keyword" }
    ]);
    expect(highlighter.open).toHaveBeenCalledTimes(1);
    expect(highlighter.update).not.toHaveBeenCalled();
  });

  it("does not resync the language document for cursor-only movement", async () => {
    const highlighter = {
      open: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      getHighlights: vi.fn(async () => [{ from: 0, to: 5, role: "keyword" as const }])
    };
    const controller = createEditorController({ value: "alpha" });

    controller.setLanguageServices([{ highlighter }]);
    controller.setViewportMetrics({ visibleRowCapacity: 1, wrapColumns: 80, softWrap: false });
    await controller.refreshLanguage({
      forceDocumentSync: true,
      highlightViewport: { fromLine: 0, toLine: 0 },
      refreshDiagnostics: false,
      refreshLineChanges: false
    });

    highlighter.open.mockClear();
    highlighter.update.mockClear();

    controller.execute(moveRight);
    await controller.refreshLanguage({
      highlightViewport: { fromLine: 0, toLine: 0 },
      refreshDiagnostics: false,
      refreshLineChanges: false
    });

    expect(highlighter.open).not.toHaveBeenCalled();
    expect(highlighter.update).not.toHaveBeenCalled();
  });
});
