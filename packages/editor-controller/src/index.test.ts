import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSelectionSet, enterInsertMode, enterNormalMode, insertText, moveRight } from "@wx/editor-core";
import type { EditorLanguageServices } from "@wx/editor-language";

import { createEditorController, normalizeLanguageServices } from "./index";
import type { EditorPaneTreeNode } from "./types";

async function flushAsyncWork(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function collectPaneIds(node: EditorPaneTreeNode): string[] {
  return node.kind === "pane" ? [node.paneId] : [...collectPaneIds(node.first), ...collectPaneIds(node.second)];
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
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

  it("adds next occurrences without collapsing prior selections", () => {
    const controller = createEditorController({
      value: "alpha beta alpha beta",
      selection: createSelectionSet([{ anchor: 0, head: 4, preferredColumn: null }])
    });

    expect(controller.selectNextOccurrence()).toBe(true);
    expect(controller.getState().selection.ranges.map((range) => [range.anchor, range.head])).toEqual([
      [0, 4],
      [11, 15]
    ]);

    expect(controller.selectAllOccurrences()).toBe(true);
    expect(controller.getState().selection.ranges.map((range) => [range.anchor, range.head])).toEqual([
      [0, 4],
      [11, 15]
    ]);
  });

  it("splits multi-line selections and collapses back to primary", () => {
    const controller = createEditorController({
      value: "alpha\nbeta\ngamma",
      selection: createSelectionSet([{ anchor: 0, head: 15, preferredColumn: null }])
    });

    expect(controller.splitSelectionsByLine()).toBe(true);
    expect(controller.getState().selection.ranges).toHaveLength(3);
    expect(controller.removePrimarySelection()).toBe(true);
    expect(controller.getState().selection.ranges).toHaveLength(2);
    expect(controller.collapseSelections()).toBe(true);
    expect(controller.getState().selection.ranges).toHaveLength(1);
  });

  it("runs multi-selection controller commands from command line", async () => {
    const controller = createEditorController({
      value: "alpha beta alpha",
      selection: createSelectionSet([{ anchor: 0, head: 4, preferredColumn: null }])
    });

    controller.openCommandLine(":");
    for (const key of "select-next") {
      await controller.handleCommandLineKey(key);
    }
    await controller.handleCommandLineKey("Enter");

    expect(controller.getState().selection.ranges.map((range) => [range.anchor, range.head])).toEqual([
      [0, 4],
      [11, 15]
    ]);
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
      "B",
      "d",
      "j",
      "p",
      "s",
      "S",
      "r",
      "n"
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

  it("requests explicit completion and applies selected text through controller state", async () => {
    const controller = createEditorController({
      value: "al",
      selection: createSelectionSet([{ anchor: 0, head: 1, preferredColumn: null }])
    });
    controller.setLanguageServices([
      {
        completion: {
          async complete() {
            return [
              { label: "alpha", detail: "keyword" },
              { label: "alias", detail: "value" }
            ];
          }
        }
      }
    ]);

    await controller.requestCompletion();
    expect(controller.getPresentationState().ui.completion.active).toBe(true);
    expect(controller.getPresentationState().ui.completion.items.map((item) => item.label)).toEqual(["alias", "alpha"]);

    controller.moveCompletion(1);
    await controller.acceptCompletion();

    expect(controller.getState().doc.text).toBe("alpha");
    expect(controller.getPresentationState().ui.completion.active).toBe(false);
  });

  it("ignores stale completion responses when a newer explicit request finishes first", async () => {
    const first = createDeferred<readonly { label: string }[]>();
    const second = createDeferred<readonly { label: string }[]>();
    const controller = createEditorController({
      value: "al",
      selection: createSelectionSet([{ anchor: 0, head: 1, preferredColumn: null }])
    });
    let callCount = 0;

    controller.setLanguageServices([
      {
        completion: {
          async complete() {
            callCount += 1;
            return callCount === 1 ? await first.promise : await second.promise;
          }
        }
      }
    ]);

    const firstRequest = controller.requestCompletion();
    const secondRequest = controller.requestCompletion();

    second.resolve([{ label: "second" }]);
    await secondRequest;
    await flushAsyncWork();

    first.resolve([{ label: "first" }]);
    await firstRequest;
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.completion.items.map((item) => item.label)).toEqual(["second"]);
  });

  it("does no work for completion moves clamped at bounds and clears completion on dismiss", async () => {
    const controller = createEditorController({
      value: "al",
      selection: createSelectionSet([{ anchor: 0, head: 1, preferredColumn: null }])
    });
    let updateCount = 0;
    controller.subscribe(() => {
      updateCount += 1;
    });
    controller.setLanguageServices([
      {
        completion: {
          async complete() {
            return [{ label: "alpha" }, { label: "alias" }];
          }
        }
      }
    ]);

    await controller.requestCompletion();
    updateCount = 0;

    expect(controller.moveCompletion(-1)).toBe(false);
    expect(updateCount).toBe(0);

    expect(controller.dismissCompletion()).toBe(true);
    expect(controller.getPresentationState().ui.completion.active).toBe(false);
    expect(controller.dismissCompletion()).toBe(false);
  });

  it("uses insertText when accepting a completion item by explicit index", async () => {
    const controller = createEditorController({
      value: "al",
      selection: createSelectionSet([{ anchor: 0, head: 1, preferredColumn: null }])
    });

    controller.setLanguageServices([
      {
        completion: {
          async complete() {
            return [
              { label: "alpha", insertText: "omega" },
              { label: "alias" }
            ];
          }
        }
      }
    ]);

    await controller.requestCompletion();
    await controller.acceptCompletion(1);
    expect(controller.getState().doc.text).toBe("omega");
  });

  it("shows a warning when goto returns no results", async () => {
    const controller = createEditorController({ value: "alpha" });
    controller.setLanguageServices([
      {
        goto: {
          async definition() {
            return [];
          }
        }
      }
    ]);

    const jumped = await controller.gotoTarget("definition");

    expect(jumped).toBe(false);
    expect(controller.getPresentationState().ui.bottomMessage?.text).toBe("No definition results");
  });

  it("jumps directly to single goto targets in current file", async () => {
    const controller = createEditorController({ value: "alpha beta alpha" });
    controller.setLanguageServices([
      {
        goto: {
          async definition() {
            return [{ from: 11, to: 16 }];
          }
        }
      }
    ]);

    const jumped = await controller.gotoTarget("definition");

    expect(jumped).toBe(true);
    expect(controller.getState().selection.ranges[0]).toEqual({
      anchor: 11,
      head: 15,
      preferredColumn: null
    });
  });

  it("opens another buffer for single cross-file goto targets", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.setHostServices({
      async readFile({ filePath }) {
        return { text: filePath === "src/other.ts" ? "beta gamma" : "" };
      }
    });
    controller.setLanguageServices([
      {
        goto: {
          async definition() {
            return [{ filePath: "src/other.ts", from: 5, to: 10 }];
          }
        }
      }
    ]);

    const jumped = await controller.gotoTarget("definition");

    expect(jumped).toBe(true);
    expect(controller.getPresentationState().filePath).toBe("src/other.ts");
    expect(controller.getState().doc.text).toBe("beta gamma");
    expect(controller.getState().selection.ranges[0]).toEqual({
      anchor: 5,
      head: 9,
      preferredColumn: null
    });
  });

  it("opens modal picker previews for many goto targets and references", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.setHostServices({
      async readFile({ filePath }) {
        return { text: `preview:${filePath}` };
      }
    });
    controller.setLanguageServices([
      {
        goto: {
          async implementation() {
            return [
              { filePath: "src/one.ts", from: 0, to: 3, detail: "one" },
              { filePath: "src/two.ts", from: 2, to: 5, detail: "two" }
            ];
          },
          async references() {
            return [
              { filePath: "src/ref-one.ts", from: 0, to: 3, detail: "ref one" },
              { filePath: "src/ref-two.ts", from: 2, to: 5, detail: "ref two" }
            ];
          }
        }
      }
    ]);

    const openedMany = await controller.gotoTarget("implementation");
    await flushAsyncWork();

    expect(openedMany).toBe(true);
    expect(controller.getPresentationState().ui.picker.active).toBe(true);
    expect(controller.getPresentationState().ui.picker.variant).toBe("modal");
    expect(controller.getPresentationState().ui.picker.items.map((item) => item.label)).toEqual(["src/one.ts", "src/two.ts"]);
    expect(controller.getPresentationState().ui.picker.previewContent).toBe("preview:src/one.ts");

    controller.clearBottomMessage();
    const referencesOpened = await controller.gotoTarget("references");
    await flushAsyncWork();

    expect(referencesOpened).toBe(true);
    expect(controller.getPresentationState().ui.picker.title).toBe("references");
    expect(controller.getPresentationState().ui.picker.items.map((item) => item.label)).toEqual([
      "src/ref-one.ts",
      "src/ref-two.ts"
    ]);
  });

  it("ignores stale navigation responses when a newer request resolves first", async () => {
    const first = createDeferred<readonly { filePath: string; from: number; to: number }[]>();
    const second = createDeferred<readonly { filePath: string; from: number; to: number }[]>();
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    let callCount = 0;

    controller.setLanguageServices([
      {
        goto: {
          async references() {
            callCount += 1;
            return callCount === 1 ? await first.promise : await second.promise;
          }
        }
      }
    ]);

    const firstRequest = controller.gotoTarget("references");
    const secondRequest = controller.gotoTarget("references");

    second.resolve([{ filePath: "src/new.ts", from: 0, to: 3 }]);
    await secondRequest;
    await flushAsyncWork();

    first.resolve([{ filePath: "src/old.ts", from: 0, to: 3 }]);
    await firstRequest;
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.picker.items.map((item) => item.label)).toEqual(["src/new.ts"]);
  });

  it("opens modal pickers for document symbols and keeps newest workspace symbol query only", async () => {
    const current = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    current.setHostServices({
      async readFile({ filePath }) {
        return { text: `preview:${filePath}` };
      }
    });
    current.setLanguageServices([
      {
        symbols: {
          async documentSymbols() {
            return [{ name: "alpha", from: 0, to: 5, detail: "fn" }];
          }
        }
      }
    ]);

    const openedDocument = await current.openSymbols("document");
    await flushAsyncWork();

    expect(openedDocument).toBe(true);
    expect(current.getPresentationState().ui.picker.title).toBe("document symbols");
    expect(current.getPresentationState().ui.picker.items.map((item) => item.label)).toEqual(["alpha"]);

    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    const first = createDeferred<readonly { name: string; from: number; to: number; filePath: string }[]>();
    const second = createDeferred<readonly { name: string; from: number; to: number; filePath: string }[]>();

    controller.setLanguageServices([
      {
        symbols: {
          async workspaceSymbols(query) {
            if (query === "a") {
              return await first.promise;
            }

            if (query === "ab") {
              return await second.promise;
            }

            return [];
          }
        }
      }
    ]);

    await controller.openSymbols("workspace");
    const firstQuery = controller.handleKeyInput({ key: "a", text: "a" });
    const secondQuery = controller.handleKeyInput({ key: "b", text: "b" });

    second.resolve([{ name: "abSymbol", from: 0, to: 2, filePath: "src/ab.ts" }]);
    await secondQuery;
    await flushAsyncWork();

    first.resolve([{ name: "aSymbol", from: 0, to: 1, filePath: "src/a.ts" }]);
    await firstQuery;
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.picker.title).toBe("workspace symbols");
    expect(controller.getPresentationState().ui.picker.query).toBe("ab");
    expect(controller.getPresentationState().ui.picker.items.map((item) => item.label)).toEqual(["abSymbol"]);
  });

  it("applies cross-file rename edits through host IO and open buffers", async () => {
    const writes: Array<{ filePath: string; text: string }> = [];
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.setHostServices({
      async readFile({ filePath }) {
        if (filePath === "src/other.ts") {
          return "alpha beta";
        }

        return "";
      },
      async writeFile(payload) {
        writes.push(payload);
      }
    });
    controller.setLanguageServices([
      {
        rename: {
          async rename() {
            return [
              {
                changes: [{ from: 0, to: 5, insert: "omega" }]
              },
              {
                filePath: "src/other.ts",
                changes: [{ from: 0, to: 5, insert: "omega" }]
              }
            ];
          }
        }
      }
    ]);

    const renamed = await controller.renameSymbol("omega");

    expect(renamed).toBe(true);
    expect(controller.getState().doc.text).toBe("omega");
    expect(writes).toEqual([{ filePath: "src/other.ts", text: "omega beta" }]);
  });

  it("updates already-open buffers and keeps active selection on same-file rename", async () => {
    const controller = createEditorController({
      value: "alpha",
      filePath: "src/current.ts",
      selection: createSelectionSet([{ anchor: 0, head: 4, preferredColumn: null }])
    });
    controller.setHostServices({
      async readFile({ filePath }) {
        return { text: filePath === "src/other.ts" ? "alpha other" : "" };
      },
      async writeFile() {}
    });
    await controller.openBuffer("src/other.ts");
    const currentBuffer = controller.getBuffers().find((entry) => entry.filePath === "src/current.ts");
    controller.switchBuffer(currentBuffer!.id);
    controller.setLanguageServices([
      {
        rename: {
          async rename() {
            return [
              { changes: [{ from: 0, to: 5, insert: "omega" }] },
              { filePath: "src/other.ts", changes: [{ from: 0, to: 5, insert: "omega" }] }
            ];
          }
        }
      }
    ]);

    const renamed = await controller.renameSymbol("omega");

    expect(renamed).toBe(true);
    expect(controller.getState().doc.text).toBe("omega");
    expect(controller.getState().selection.ranges[0]).toEqual({
      anchor: 0,
      head: 4,
      preferredColumn: null
    });

    const otherBuffer = controller.getBuffers().find((entry) => entry.filePath === "src/other.ts");
    controller.switchBuffer(otherBuffer!.id);
    expect(controller.getState().doc.text).toBe("omega other");
  });

  it("fails rename safely before partial apply when cross-file IO is unavailable", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.setLanguageServices([
      {
        rename: {
          async rename() {
            return [
              { changes: [{ from: 0, to: 5, insert: "omega" }] },
              { filePath: "src/other.ts", changes: [{ from: 0, to: 5, insert: "omega" }] }
            ];
          }
        }
      }
    ]);

    const renamed = await controller.renameSymbol("omega");

    expect(renamed).toBe(false);
    expect(controller.getState().doc.text).toBe("alpha");
    expect(controller.getPresentationState().ui.bottomMessage?.text).toBe("Cross-file rename needs host file IO");
  });

  it("ignores stale rename responses after document revision changes", async () => {
    const renameDeferred = createDeferred<readonly { changes: readonly { from: number; to: number; insert: string }[] }[] | null>();
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.setLanguageServices([
      {
        rename: {
          async rename() {
            return await renameDeferred.promise;
          }
        }
      }
    ]);

    const pendingRename = controller.renameSymbol("omega");
    controller.dispatch({ changes: [{ from: 0, to: 0, insert: "z" }] });
    renameDeferred.resolve([{ changes: [{ from: 1, to: 6, insert: "omega" }] }]);

    await pendingRename;
    await flushAsyncWork();

    expect(controller.getState().doc.text).toBe("zalpha");
    expect(controller.getPresentationState().ui.rename.active).toBe(true);
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

  it("splits panes on shared buffers and keeps edits synchronized", () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    expect(controller.splitPane("vertical")).toBe(true);

    const workspace = controller.getWorkspacePresentationState();
    expect(workspace.panes).toHaveLength(2);
    expect(workspace.panes.every((pane) => pane.bufferId === workspace.activeBufferId)).toBe(true);

    const inactivePane = workspace.panes.find((pane) => !pane.active)!;
    controller.setActivePane(inactivePane.paneId);
    controller.execute(enterInsertMode);
    controller.execute(insertText("x"));
    controller.execute(enterNormalMode);

    const nextWorkspace = controller.getWorkspacePresentationState();
    expect(nextWorkspace.panes.map((pane) => pane.state.doc.text)).toEqual(["xalpha", "xalpha"]);
  });

  it("switches buffers on the active pane only", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.setHostServices({
      async readFile({ filePath }) {
        return { text: `opened:${filePath}` };
      }
    });

    expect(controller.splitPane("horizontal")).toBe(true);
    const originalActivePaneId = controller.getWorkspacePresentationState().activePaneId;

    await controller.openBuffer("src/other.ts");

    const workspace = controller.getWorkspacePresentationState();
    const activePane = workspace.panes.find((pane) => pane.paneId === workspace.activePaneId)!;
    const siblingPane = workspace.panes.find((pane) => pane.paneId !== workspace.activePaneId)!;

    expect(workspace.activePaneId).toBe(originalActivePaneId);
    expect(activePane.filePath).toBe("src/other.ts");
    expect(activePane.state.doc.text).toBe("opened:src/other.ts");
    expect(siblingPane.filePath).toBe("src/current.ts");
    expect(siblingPane.state.doc.text).toBe("alpha");
  });

  it("focuses and closes panes through workspace APIs", () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    controller.splitPane("vertical");
    const workspace = controller.getWorkspacePresentationState();
    const originalActive = workspace.activePaneId;
    const sibling = workspace.panes.find((pane) => pane.paneId !== originalActive)!;

    expect(controller.focusPane("left")).toBe(true);
    expect(controller.getWorkspacePresentationState().activePaneId).toBe(sibling.paneId);
    expect(controller.closePane()).toBe(true);
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(1);
    expect(controller.closePane()).toBe(false);
    expect(controller.getPresentationState().ui.bottomMessage?.text).toBe("Cannot close the last pane");
  });

  it("cycles buffers through g n and g p on the active pane only", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.setHostServices({
      async readFile({ filePath }) {
        return { text: `opened:${filePath}` };
      }
    });

    controller.splitPane("vertical");
    const siblingPaneId = controller.getWorkspacePresentationState().panes.find((pane) => !pane.active)!.paneId;

    await controller.openBuffer("src/one.ts");
    await controller.openBuffer("src/two.ts");
    expect(controller.getPresentationState().filePath).toBe("src/two.ts");

    await controller.handleKeyInput({ key: "g" });
    await controller.handleKeyInput({ key: "p" });
    expect(controller.getPresentationState().filePath).toBe("src/one.ts");

    await controller.handleKeyInput({ key: "g" });
    await controller.handleKeyInput({ key: "n" });
    expect(controller.getPresentationState().filePath).toBe("src/two.ts");

    const workspace = controller.getWorkspacePresentationState();
    expect(workspace.activePaneId).not.toBe(siblingPaneId);
    expect(workspace.panes.find((pane) => pane.paneId === siblingPaneId)?.filePath).toBe("src/current.ts");
  });

  it("focuses next pane and keeps only active pane through workspace helpers", () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    controller.splitPane("vertical");
    controller.splitPane("horizontal");
    const initialActivePaneId = controller.getWorkspacePresentationState().activePaneId;

    expect(controller.focusNextPane()).toBe(true);
    expect(controller.getWorkspacePresentationState().activePaneId).not.toBe(initialActivePaneId);
    expect(controller.onlyPane()).toBe(true);
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(1);
    expect(controller.onlyPane()).toBe(false);
  });

  it("routes Ctrl-w pane commands through controller key input", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "v" });
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(2);

    const activePaneId = controller.getWorkspacePresentationState().activePaneId;
    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "h" });
    expect(controller.getWorkspacePresentationState().activePaneId).not.toBe(activePaneId);

    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "w" });
    expect(controller.getWorkspacePresentationState().activePaneId).toBe(activePaneId);

    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "o" });
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(1);
  });

  it("cancels Ctrl-w mode on Escape and keeps plain Ctrl-s/Ctrl-o jumplist behavior", async () => {
    const controller = createEditorController({ value: "one\ntwo\nthree" });

    await controller.handleKeyInput({ key: "l" });
    await controller.handleKeyInput({ key: "s", ctrl: true });
    await controller.handleKeyInput({ key: "j" });
    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "Escape" });
    await controller.handleKeyInput({ key: "o", ctrl: true });

    expect(controller.getState().selection.ranges[0]?.head).toBe(1);
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(1);
  });

  it("uses Ctrl-w Ctrl-s and Ctrl-w Ctrl-o for pane actions instead of jumplist actions", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "s", ctrl: true });
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(2);

    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "o", ctrl: true });
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(1);
  });

  it("opens selected file paths into horizontal and vertical splits with Ctrl-w f/F", async () => {
    const controller = createEditorController({
      value: 'import "./other.ts:2:3";',
      filePath: "src/current.ts",
      selection: createSelectionSet([{ anchor: 8, head: 22, preferredColumn: null }])
    });
    controller.setHostServices({
      async readFile({ filePath }) {
        return { text: `opened:${filePath}\nsecond line` };
      }
    });

    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "f" });
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(2);
    expect(controller.getPresentationState().filePath).toBe("src/other.ts");
    expect(controller.getState().doc.text).toBe("opened:src/other.ts\nsecond line");
    expect(controller.getState().doc.positionAt(controller.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 1,
      column: 2
    });

    const verticalController = createEditorController({
      value: 'import "./other.ts";',
      filePath: "src/current.ts",
      selection: createSelectionSet([{ anchor: 8, head: 18, preferredColumn: null }])
    });
    verticalController.setHostServices({
      async readFile({ filePath }) {
        return { text: `opened:${filePath}` };
      }
    });

    await verticalController.handleKeyInput({ key: "w", ctrl: true });
    await verticalController.handleKeyInput({ key: "F", shift: true });
    expect(verticalController.getWorkspacePresentationState().panes).toHaveLength(2);
    expect(verticalController.getPresentationState().filePath).toBe("src/other.ts");
  });

  it("swaps pane positions through Ctrl-w H/L", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });

    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "v" });
    const before = collectPaneIds(controller.getWorkspacePresentationState().layoutTree);
    expect(before).toHaveLength(2);

    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "H", shift: true });
    const afterLeftSwap = collectPaneIds(controller.getWorkspacePresentationState().layoutTree);
    expect(afterLeftSwap).toEqual([before[1]!, before[0]!]);

    await controller.handleKeyInput({ key: "w", ctrl: true });
    await controller.handleKeyInput({ key: "L", shift: true });
    const afterRightSwap = collectPaneIds(controller.getWorkspacePresentationState().layoutTree);
    expect(afterRightSwap).toEqual(before);
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
