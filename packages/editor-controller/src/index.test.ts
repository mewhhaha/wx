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
    const lines = [
      { from: 0, to: 5, role: "keyword" as const },
      { from: 6, to: 10, role: "keyword" as const }
    ];
    const highlighter = {
      open: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      getHighlights: vi.fn(async (viewport: { fromLine: number; toLine: number }) => {
        return lines.slice(viewport.fromLine, viewport.toLine + 1);
      })
    };
    const controller = createEditorController({ value: "alpha\nbeta" });

    controller.setLanguageServices([{ highlighter }]);
    controller.setViewportMetrics({ visibleRowCapacity: 1, wrapColumns: 80, softWrap: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getPresentationState().language.visibleHighlights).toEqual([
      { from: 0, to: 5, role: "keyword" }
    ]);

    controller.scrollViewportBy(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getPresentationState().language.visibleHighlights).toEqual([
      { from: 6, to: 10, role: "keyword" }
    ]);
    expect(highlighter.open).toHaveBeenCalledTimes(1);
    expect(highlighter.update).not.toHaveBeenCalled();
    expect(highlighter.getHighlights).toHaveBeenCalledTimes(1);
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

  it("handles shared command-line search preview in the controller", async () => {
    const controller = createEditorController({ value: "alpha\nbeta\nalpha" });
    controller.setViewportMetrics({ visibleRowCapacity: 3, wrapColumns: 40, softWrap: true });

    controller.openCommandLine("/");
    await controller.handleCommandLineKey("b");
    await controller.handleCommandLineKey("e");
    await controller.handleCommandLineKey("t");
    await controller.handleCommandLineKey("a");

    expect(controller.getPresentationState().ui.commandLine.value).toBe("beta");
    expect(controller.getState().doc.positionAt(controller.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 1,
      column: 3
    });

    await controller.handleCommandLineKey("Enter");
    expect(controller.getSearchState().query).toBe("beta");
    expect(controller.getPresentationState().ui.commandLine.active).toBe(false);
  });

  it("handles flash-target state in the controller", () => {
    const controller = createEditorController({ value: "alpha beta gamma" });
    controller.setViewportMetrics({ visibleRowCapacity: 3, wrapColumns: 40, softWrap: true });

    controller.beginFlashTarget();
    expect(controller.getPresentationState().ui.pendingAction).toEqual({ kind: "flash-target" });

    const handled = controller.handleFlashKey("a");
    expect(handled).toBe(true);
    expect(controller.getPresentationState().ui.flash.active).toBe(true);
    expect(controller.getPresentationState().ui.flash.hints.length).toBeGreaterThan(0);
  });

  it("assigns distinct first-pass labels to visible flash targets", () => {
    const controller = createEditorController({ value: "ta ta ta ta\nta ta ta ta" });
    controller.setViewportMetrics({ visibleRowCapacity: 6, wrapColumns: 80, softWrap: false });

    controller.beginFlashTarget();
    controller.handleFlashKey("t");

    const labels = controller.getPresentationState().ui.flash.hints.map((hint) => hint.label);

    expect(labels.length).toBeGreaterThan(3);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps command completion candidates in controller presentation state", async () => {
    const controller = createEditorController({ value: "alpha" });
    const themeNames = ["sunrise", "tide"];

    await controller.handleKeyInput({ key: ":", text: ":" }, { themeNames });
    expect(controller.getPresentationState().ui.commandCompletionItems.map((item) => item.label)).toContain("theme");

    await controller.handleKeyInput({ key: "t", text: "t" }, { themeNames });
    expect(controller.getPresentationState().ui.commandCompletionItems.map((item) => item.label)).toEqual(["theme"]);

    await controller.handleKeyInput({ key: "Enter" }, { themeNames });
    expect(controller.getPresentationState().ui.commandLine.value).toBe("theme ");

    await controller.handleKeyInput({ key: "Tab" }, { themeNames });
    expect(controller.getPresentationState().ui.previewTheme).toBe("tide");

    const result = await controller.handleKeyInput({ key: "Enter" }, { themeNames });
    expect(result.themeName).toBe("tide");
    expect(controller.getPresentationState().themeName).toBe("tide");
  });

  it("keeps compatibility command-line wrappers on the shared key-input session state", async () => {
    const wrapped = createEditorController({ value: "alpha\nbeta\nalpha" });
    const keyed = createEditorController({ value: "alpha\nbeta\nalpha" });

    wrapped.setViewportMetrics({ visibleRowCapacity: 3, wrapColumns: 40, softWrap: true });
    keyed.setViewportMetrics({ visibleRowCapacity: 3, wrapColumns: 40, softWrap: true });

    wrapped.openCommandLine("/");
    await wrapped.handleCommandLineKey("b");
    await wrapped.handleCommandLineKey("e");

    await keyed.handleKeyInput({ key: "/", text: "/" });
    await keyed.handleKeyInput({ key: "b", text: "b" });
    await keyed.handleKeyInput({ key: "e", text: "e" });

    expect(wrapped.getPresentationState().ui.commandLine).toEqual(keyed.getPresentationState().ui.commandLine);
    expect(wrapped.getState().selection).toEqual(keyed.getState().selection);
  });

  it("uses space+c for smart comment toggling", async () => {
    const toggleComments = vi.fn(async () => [{ from: 0, to: 0, insert: "/* " }]);
    const toggleLineComments = vi.fn(async () => [{ from: 0, to: 0, insert: "// " }]);
    const controller = createEditorController({ value: "value" });

    controller.setLanguageServices([
      {
        comments: {
          toggleComments,
          toggleLineComments
        }
      }
    ]);

    await controller.handleKeyInput({ key: " ", text: " " });
    await controller.handleKeyInput({ key: "c", text: "c" });

    expect(toggleComments).toHaveBeenCalledTimes(1);
    expect(toggleLineComments).not.toHaveBeenCalled();
    expect(controller.getState().doc.text).toBe("/* value");
  });

  it("does not sync the language document during rapid engine-backed movement keys", async () => {
    const highlighter = {
      open: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      getHighlights: vi.fn(async () => [{ from: 0, to: 5, role: "keyword" as const }])
    };
    const controller = createEditorController({
      value: Array.from({ length: 8 }, (_, index) => `line ${index} alpha beta`).join("\n")
    });

    controller.setLanguageServices([{ highlighter }]);
    controller.setViewportMetrics({ visibleRowCapacity: 20, wrapColumns: 80, softWrap: false });
    await controller.refreshLanguage({
      forceDocumentSync: true,
      highlightViewport: { fromLine: 0, toLine: 7 },
      refreshDiagnostics: false,
      refreshLineChanges: false
    });

    highlighter.open.mockClear();
    highlighter.update.mockClear();

    for (const key of ["j", "j", "l", "l", "h", "k", "j", "l", "h", "k"]) {
      await controller.handleKeyInput({ key, text: key });
    }

    expect(highlighter.open).not.toHaveBeenCalled();
    expect(highlighter.update).not.toHaveBeenCalled();
  });

  it("reveals selection from controller-owned viewport metrics during key input", async () => {
    const controller = createEditorController({
      value: Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n")
    });
    controller.setViewportMetrics({ visibleRowCapacity: 9, wrapColumns: 80, softWrap: false });

    for (let index = 0; index < 6; index += 1) {
      await controller.handleKeyInput({ key: "j", text: "j" });
    }

    expect(controller.getPresentationState().viewport.topVisualRow).toBe(1);
  });
});
