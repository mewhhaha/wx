import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { enterInsertMode, enterNormalMode, insertText, moveRight } from "@wx/editor-core";
import type { EditorLanguageServices } from "@wx/editor-language";

import { createEditorController, normalizeLanguageServices } from "./index";

async function flushAsyncWork(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("editor controller", () => {
  it("keeps controller lifecycle and register/jump plumbing out of the root composition file", () => {
    const source = readFileSync(resolve(process.cwd(), "packages/editor-controller/src/index.ts"), "utf8");

    expect(source).not.toContain("const notify = (");
    expect(source).not.toContain("const applyRegisterValue = (");
    expect(source).not.toContain("const pushJumpEntry = (");
    expect(source).not.toContain("const rebuildViewportModel = (");
    expect(source).not.toContain("const refreshSearchMatchCache = (");
    expect(source).not.toContain("const applySearchState = (");
    expect(source).not.toContain("remapHighlights");
    expect(source).not.toContain('pendingAction?.kind === "flash"');
    expect(source).toContain("createControllerSurface(");
  });

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

  it("normalizes language service input through one canonical helper", () => {
    const first: EditorLanguageServices = {};
    const second: EditorLanguageServices = {};

    expect(normalizeLanguageServices(null)).toEqual([]);
    expect(normalizeLanguageServices(undefined)).toEqual([]);
    expect(normalizeLanguageServices(first)).toEqual([first]);
    expect(normalizeLanguageServices([first, second])).toEqual([first, second]);
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

  it("shows ? action help items and clears them after handling a choice", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    await controller.handleKeyInput({ key: "?" });
    expect(controller.getPresentationState().ui.commandCompletionItems.map((item) => item.label)).toEqual([
      "f",
      "F",
      "b",
      "d",
      "j"
    ]);

    await controller.handleKeyInput({ key: "b", text: "b" });
    expect(controller.getPresentationState().ui.commandCompletionItems).toEqual([]);
    expect(controller.getPresentationState().ui.picker.active).toBe(true);
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

  it("sets semantic hover state through controller-owned hover requests", async () => {
    const controller = createEditorController({ value: "alpha" });

    controller.setLanguageServices([
      {
        hover: {
          async hover() {
            return { source: "fake-lsp", content: "hover:0" };
          }
        }
      }
    ]);

    const shown = await controller.requestHoverAt(0, { pinned: true });

    expect(shown).toBe(true);
    expect(controller.getPresentationState().ui.hover).toEqual({
      active: true,
      pinned: true,
      offset: 0,
      content: "hover:0",
      source: "fake-lsp",
      tone: "info"
    });
  });

  it("clears semantic hover and flash state on document edits", async () => {
    const controller = createEditorController({ value: "alpha" });

    controller.showDiagnosticHover({ from: 0, to: 5, severity: "warning", message: "warn" }, { pinned: true });
    controller.beginFlashTarget();
    controller.handleFlashKey("a");
    controller.execute(enterInsertMode);
    controller.execute(insertText("x"));

    expect(controller.getPresentationState().ui.hover.active).toBe(false);
    expect(controller.getPresentationState().ui.flash.active).toBe(false);
  });

  it("updates bottom messages through controller APIs", () => {
    const controller = createEditorController({ value: "alpha" });

    controller.setBottomMessage({ tone: "info", text: "hello" });
    expect(controller.getPresentationState().ui.bottomMessage).toEqual({ tone: "info", text: "hello" });

    controller.clearBottomMessage();
    expect(controller.getPresentationState().ui.bottomMessage).toBeNull();
  });

  it("ignores stale hover responses after document edits", async () => {
    let resolveHover: ((value: { source: string; content: string }) => void) | null = null;
    const controller = createEditorController({ value: "alpha" });

    controller.setLanguageServices([
      {
        hover: {
          hover() {
            return new Promise((resolve) => {
              resolveHover = resolve;
            });
          }
        }
      }
    ]);

    const pending = controller.requestHoverAt(0, { pinned: true });
    controller.execute(enterInsertMode);
    controller.execute(insertText("x"));
    resolveHover?.({ source: "fake-lsp", content: "stale hover" });

    expect(await pending).toBe(false);
    expect(controller.getPresentationState().ui.hover.active).toBe(false);
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

  it("uses alt+/ for smart comment toggling", async () => {
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

    await controller.handleKeyInput({ key: "/", text: "/", alt: true });

    expect(toggleComments).toHaveBeenCalledTimes(1);
    expect(toggleLineComments).not.toHaveBeenCalled();
    expect(controller.getState().doc.text).toBe("/* value");
  });

  it("searches repo files through the engine and opens them as buffers", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    controller.setHostServices({
      async searchFiles(context) {
        return [
          { filePath: "src/current.ts" },
          { filePath: "src/beta.ts" },
          { filePath: "pkg/beta.ts" }
        ].filter((entry) => entry.filePath.toLowerCase().includes(context.query.toLowerCase()));
      },
      async readFile(context) {
        return { text: `opened:${context.filePath}` };
      }
    });

    await controller.handleKeyInput({ key: "?" });
    await controller.handleKeyInput({ key: "f", text: "f" });
    await flushAsyncWork();
    await controller.handleKeyInput({ key: "b", text: "b" });
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.picker.title).toBe("repo");
    expect(controller.getPresentationState().ui.picker.query).toBe("b");
    expect(controller.getPresentationState().ui.picker.items.map((entry) => entry.label)).toEqual([
      "src/beta.ts",
      "pkg/beta.ts"
    ]);

    await controller.handleKeyInput({ key: "Enter" });
    await flushAsyncWork();

    expect(controller.getState().doc.text).toBe("opened:src/beta.ts");
    expect(controller.getPresentationState().filePath).toBe("src/beta.ts");
    expect(controller.getBuffers().map((entry) => entry.filePath)).toEqual(["src/current.ts", "src/beta.ts"]);
  });

  it("keeps modal search results visible while a new query is loading", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    let resolveSearch: ((value: readonly { filePath: string }[]) => void) | null = null;

    controller.setHostServices({
      async searchFiles(context) {
        if (context.query === "b") {
          return await new Promise<readonly { filePath: string }[]>((resolve) => {
            resolveSearch = resolve;
          });
        }

        return [{ filePath: "src/alpha.ts" }, { filePath: "src/beta.ts" }];
      },
      async readFile(context) {
        return { text: `opened:${context.filePath}` };
      }
    });

    await controller.handleKeyInput({ key: "?" });
    await controller.handleKeyInput({ key: "f", text: "f" });
    await flushAsyncWork();
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.picker.items.map((entry) => entry.label)).toEqual([
      "src/alpha.ts",
      "src/beta.ts"
    ]);

    const pendingUpdate = controller.handleKeyInput({ key: "b", text: "b" });
    expect(controller.getPresentationState().ui.picker.query).toBe("b");
    expect(controller.getPresentationState().ui.picker.items.map((entry) => entry.label)).toEqual([
      "src/alpha.ts",
      "src/beta.ts"
    ]);

    resolveSearch?.([{ filePath: "src/beta.ts" }]);
    await pendingUpdate;
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.picker.items.map((entry) => entry.label)).toEqual(["src/beta.ts"]);
  });

  it("ignores stale modal search responses when a newer query finishes first", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    let resolveA: ((value: readonly { filePath: string }[]) => void) | null = null;
    let resolveAb: ((value: readonly { filePath: string }[]) => void) | null = null;

    controller.setHostServices({
      async searchFiles(context) {
        if (context.query === "a") {
          return await new Promise<readonly { filePath: string }[]>((resolve) => {
            resolveA = resolve;
          });
        }

        if (context.query === "ab") {
          return await new Promise<readonly { filePath: string }[]>((resolve) => {
            resolveAb = resolve;
          });
        }

        return [{ filePath: "src/seed.ts" }];
      }
    });

    await controller.handleKeyInput({ key: "?" });
    await controller.handleKeyInput({ key: "f", text: "f" });
    await flushAsyncWork();

    const firstQuery = controller.handleKeyInput({ key: "a", text: "a" });
    const secondQuery = controller.handleKeyInput({ key: "b", text: "b" });

    resolveAb?.([{ filePath: "src/ab.ts" }]);
    await secondQuery;
    await flushAsyncWork();

    resolveA?.([{ filePath: "src/a.ts" }]);
    await firstQuery;
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.picker.query).toBe("ab");
    expect(controller.getPresentationState().ui.picker.items.map((entry) => entry.label)).toEqual(["src/ab.ts"]);
  });

  it("ignores stale modal preview responses after the selection changes", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    let resolveFirstPreview: ((value: { text: string }) => void) | null = null;
    let resolveSecondPreview: ((value: { text: string }) => void) | null = null;

    controller.setHostServices({
      async searchFiles() {
        return [{ filePath: "src/alpha.ts" }, { filePath: "src/beta.ts" }];
      },
      async readFile(context) {
        if (context.filePath === "src/alpha.ts") {
          return await new Promise<{ text: string }>((resolve) => {
            resolveFirstPreview = resolve;
          });
        }

        return await new Promise<{ text: string }>((resolve) => {
          resolveSecondPreview = resolve;
        });
      }
    });

    await controller.handleKeyInput({ key: "?" });
    await controller.handleKeyInput({ key: "f", text: "f" });
    await flushAsyncWork();
    await controller.handleKeyInput({ key: "ArrowDown" });

    resolveSecondPreview?.({ text: "preview:beta" });
    await flushAsyncWork();

    resolveFirstPreview?.({ text: "preview:alpha" });
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.picker.selectedIndex).toBe(1);
    expect(controller.getPresentationState().ui.picker.previewTitle).toBe("src/beta.ts");
    expect(controller.getPresentationState().ui.picker.previewContent).toBe("preview:beta");
  });

  it("does no preview or presentation work for picker moves that stay on the same item", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    const readFile = vi.fn(async (context: { filePath: string }) => ({ text: `preview:${context.filePath}` }));
    let updateCount = 0;

    controller.subscribe(() => {
      updateCount += 1;
    });
    controller.setHostServices({
      async searchFiles() {
        return [{ filePath: "src/alpha.ts" }, { filePath: "src/beta.ts" }];
      },
      readFile
    });

    await controller.handleKeyInput({ key: "?" });
    await controller.handleKeyInput({ key: "f", text: "f" });
    await flushAsyncWork(8);

    const updatesBeforeNoopMove = updateCount;
    const readsBeforeNoopMove = readFile.mock.calls.length;

    await controller.handleKeyInput({ key: "ArrowUp" });
    await flushAsyncWork(8);

    expect(controller.getPresentationState().ui.picker.selectedIndex).toBe(0);
    expect(updateCount).toBe(updatesBeforeNoopMove);
    expect(readFile).toHaveBeenCalledTimes(readsBeforeNoopMove);
  });

  it("treats j and k as query text inside modal search pickers", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    controller.setHostServices({
      async searchFiles(context) {
        return [
          { filePath: "src/jump.ts" },
          { filePath: "src/kappa.ts" },
          { filePath: "src/other.ts" }
        ].filter((entry) => entry.filePath.toLowerCase().includes(context.query.toLowerCase()));
      }
    });

    await controller.handleKeyInput({ key: "?" });
    await controller.handleKeyInput({ key: "f", text: "f" });
    await flushAsyncWork();
    await controller.handleKeyInput({ key: "j", text: "j" });
    await flushAsyncWork();
    await controller.handleKeyInput({ key: "k", text: "k" });
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.picker.query).toBe("jk");
    expect(controller.getPresentationState().ui.picker.selectedIndex).toBe(0);
  });

  it("opens existing buffers through ?b without rereading host text", async () => {
    const readFile = vi.fn(async (context: { filePath: string }) => ({ text: `opened:${context.filePath}` }));
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    controller.setHostServices({
      async searchFiles() {
        return [{ filePath: "src/beta.ts" }];
      },
      readFile
    });

    await controller.openBuffer("src/beta.ts");
    expect(readFile).toHaveBeenCalledTimes(1);

    await controller.handleKeyInput({ key: "?" });
    await controller.handleKeyInput({ key: "b", text: "b" });
    await flushAsyncWork();
    await controller.handleKeyInput({ key: "c", text: "c" });
    await flushAsyncWork();
    await controller.handleKeyInput({ key: "Enter" });

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(controller.getPresentationState().filePath).toBe("src/current.ts");
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

  it("treats Ctrl-o on an empty jumplist as a handled no-op", async () => {
    const controller = createEditorController({ value: "alpha\nbeta" });
    const beforeState = controller.getState();

    const result = await controller.handleKeyInput({ key: "o", ctrl: true });

    expect(result).toEqual({ handled: true });
    expect(controller.getState()).toEqual(beforeState);
    expect(controller.getJumpList()).toEqual([]);
  });

  it("round-trips jump entries through Ctrl-o and Ctrl-i", async () => {
    const controller = createEditorController({ value: "one\ntwo\nthree" });

    await controller.handleKeyInput({ key: "l", text: "l" });
    await controller.handleKeyInput({ key: "s", ctrl: true });
    await controller.handleKeyInput({ key: "j", text: "j" });
    await controller.handleKeyInput({ key: "o", ctrl: true });

    expect(controller.getState().selection.ranges[0]?.head).toBe(1);

    await controller.handleKeyInput({ key: "i", ctrl: true });
    expect(controller.getState().selection.ranges[0]?.head).toBe(5);
  });
});
