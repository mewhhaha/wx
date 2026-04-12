// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendInsertMode,
  createCharacterSelection,
  createEditorState,
  createSelection,
  enterInsertMode,
  moveRight
} from "../../editor-core/src/index";
import { createEditorController } from "../../editor-controller/src/index";
import { createEditor } from "../../editor-view-dom/src/index";

import { createAnsiEditorMirror, renderEditorAnsiFrame } from "./index";
import { createAnsiEditorTerminal } from "./index";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

function readTerminalCursor(text: string): { row: number; col: number } | null {
  const matches = [...text.matchAll(/\u001b\[(\d+);(\d+)H/g)];
  const match = matches.at(-1);

  if (!match) {
    return null;
  }

  return {
    row: Number(match[1]),
    col: Number(match[2])
  };
}

function createPresentation(value: string) {
  const state = createEditorState({ value });
  const controller = createEditorController({ state });
  controller.setFilePath("examples/test.ts");
  controller.setViewportMetrics({
    visibleRowCapacity: 4,
    wrapColumns: 24,
    softWrap: true
  });
  return {
    state: controller.getState(),
    presentation: controller.getPresentationState()
  };
}

async function flushAsyncWork(times = 64): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

class FakeInput {
  isTTY = true;
  private readonly listeners = new Set<(chunk: Buffer | string) => void>();
  readonly rawModeCalls: boolean[] = [];

  on(_event: "data", listener: (chunk: Buffer | string) => void) {
    this.listeners.add(listener);
    return this;
  }

  off(_event: "data", listener: (chunk: Buffer | string) => void) {
    this.listeners.delete(listener);
    return this;
  }

  resume() {}
  pause() {}
  setEncoding(_encoding: BufferEncoding) {}
  setRawMode(mode: boolean) {
    this.rawModeCalls.push(mode);
  }

  emit(chunk: Buffer | string) {
    for (const listener of this.listeners) {
      listener(chunk);
    }
  }
}

class FakeOutput {
  columns = 30;
  rows = 6;
  private readonly listeners = new Set<() => void>();

  on(_event: "resize", listener: () => void) {
    this.listeners.add(listener);
    return this;
  }

  off(_event: "resize", listener: () => void) {
    this.listeners.delete(listener);
    return this;
  }

  emitResize() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

describe("@wx/editor-view-ansi", () => {
  it("keeps tree-sitter runtime ownership in the shared tree-sitter package", () => {
    const source = readFileSync(resolve(process.cwd(), "packages/editor-view-ansi/src/demo-runtime.ts"), "utf8");

    expect(source).toContain("../../editor-tree-sitter/src/node");
    expect(source).not.toContain("treeSitter.worker");
    expect(source).not.toContain("worker_threads");
    expect(source).not.toContain("createNodeWorkerBridge");
  });

  it("routes ANSI runtime keyboard input through controller key APIs only", () => {
    const source = readFileSync(resolve(process.cwd(), "packages/editor-view-ansi/src/terminal.ts"), "utf8");

    expect(source).toContain("controller.handleKeyInput");
    expect(source).not.toContain("controller.openCommandLine(");
    expect(source).not.toContain("controller.handleCommandLineKey(");
    expect(source).not.toContain("controller.updatePresentationState(");
  });

  it("renders plain text rows with gutters, status, and bottom rows", () => {
    const { state, presentation } = createPresentation("alpha\nbeta");

    const frame = stripAnsi(
      renderEditorAnsiFrame({
        state,
        presentation,
        cols: 30,
        rows: 6
      })
    );

    expect(frame).toContain("1  ");
    expect(frame).toContain("alpha");
    expect(frame).toContain("examples/test");
  });

  it("renders insert mode with a real beam cursor without replacing text", () => {
    const controller = createEditorController({ value: "alpha" });
    controller.execute(enterInsertMode);
    controller.setViewportMetrics({ visibleRowCapacity: 4, wrapColumns: 24, softWrap: true });

    const frame = renderEditorAnsiFrame({
      state: controller.getState(),
      presentation: controller.getPresentationState(),
      cols: 30,
      rows: 6
    });

    expect(stripAnsi(frame)).toContain("alpha");
    expect(frame).toContain("\u001b[6 q");
    expect(readTerminalCursor(frame)).toEqual({ row: 1, col: 7 });
  });

  it("places append-mode insert cursor one cell to the right of normal insert", () => {
    const insertController = createEditorController({ value: "alpha" });
    insertController.execute(enterInsertMode);
    insertController.setViewportMetrics({ visibleRowCapacity: 4, wrapColumns: 24, softWrap: true });

    const appendController = createEditorController({ value: "alpha" });
    appendController.execute(appendInsertMode);
    appendController.setViewportMetrics({ visibleRowCapacity: 4, wrapColumns: 24, softWrap: true });

    const insertFrame = renderEditorAnsiFrame({
      state: insertController.getState(),
      presentation: insertController.getPresentationState(),
      cols: 30,
      rows: 6
    });
    const appendFrame = renderEditorAnsiFrame({
      state: appendController.getState(),
      presentation: appendController.getPresentationState(),
      cols: 30,
      rows: 6
    });

    expect(readTerminalCursor(insertFrame)).toEqual({ row: 1, col: 7 });
    expect(readTerminalCursor(appendFrame)).toEqual({ row: 1, col: 8 });
  });

  it("renders current search highlights from the shared presentation state", () => {
    const controller = createEditorController({ value: "alpha beta alpha" });
    controller.setViewportMetrics({ visibleRowCapacity: 4, wrapColumns: 24, softWrap: true });
    controller.setSearchState({
      query: "beta",
      direction: "forward",
      lastMatch: { from: 6, to: 10 }
    });
    controller.dispatch({
      selection: createSelection(6, 9),
      mode: "normal"
    });

    const frame = renderEditorAnsiFrame({
      state: controller.getState(),
      presentation: controller.getPresentationState(),
      cols: 30,
      rows: 6
    });

    expect(frame).toContain("48;2;161;98;7m");
  });

  it("renders distinct flash-hint labels from layout overlays", () => {
    const controller = createEditorController({ value: "ta ta ta ta\nta ta ta ta" });
    controller.setViewportMetrics({ visibleRowCapacity: 6, wrapColumns: 80, softWrap: false });
    controller.beginFlashTarget();
    controller.handleFlashKey("t");

    const labels = controller.getPresentationState().ui.flash.hints.map((hint) => hint.label);
    expect(new Set(labels).size).toBeGreaterThan(3);

    const frame = stripAnsi(
      renderEditorAnsiFrame({
        state: controller.getState(),
        presentation: controller.getPresentationState(),
        cols: 40,
        rows: 8
      })
    );

    for (const label of labels.slice(0, 4)) {
      expect(frame).toContain(label);
    }
  });

  it("keeps DOM and ANSI key sequences on the same controller-visible state", async () => {
    const value = "alpha beta\nbeta alpha";
    const domContainer = document.createElement("div");
    document.body.append(domContainer);

    const domController = createEditorController({ value });
    const domEditor = createEditor(domContainer, { controller: domController });
    const textarea = domContainer.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    const ansiController = createEditorController({ value });
    const input = new FakeInput();
    const output = new FakeOutput();
    const terminal = createAnsiEditorTerminal({
      controller: ansiController,
      input,
      output,
      write() {},
      cols: 30,
      rows: 6
    });

    terminal.mount();

    for (const key of ["/", "b", "e"]) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      input.emit(key);
    }
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.emit("\r");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    input.emit("n");

    await flushAsyncWork();

    expect(domController.getState().selection).toEqual(ansiController.getState().selection);
    expect(domController.getPresentationState().ui.commandLine).toEqual(ansiController.getPresentationState().ui.commandLine);
    expect(domController.getSearchState()).toEqual(ansiController.getSearchState());

    terminal.destroy();
    domEditor.destroy();
  });

  it("renders diagnostics and diff gutter markers", () => {
    const controller = createEditorController({ value: "alpha\nbeta" });
    controller.setViewportMetrics({ visibleRowCapacity: 4, wrapColumns: 24, softWrap: true });
    controller.updatePresentationState((presentation) => {
      presentation.language.diagnostics = [
        { from: 0, to: 5, severity: "warning", message: "warn" }
      ];
      presentation.language.diagnosticsByLine = new Map([[0, presentation.language.diagnostics as any]]);
      presentation.language.lineChangesByLine = new Map([[1, { kind: "added", deleted: false }]]);
      presentation.language.visibleDiagnostics = presentation.language.diagnostics;
      presentation.language.visibleLineChanges = [{ line: 1, kind: "added" }];
    });

    const frame = stripAnsi(
      renderEditorAnsiFrame({
        state: controller.getState(),
        presentation: controller.getPresentationState(),
        cols: 30,
        rows: 6
      })
    );

    expect(frame).toContain("•");
    expect(frame).toContain("+");
  });

  it("shows the command line from presentation state", () => {
    const controller = createEditorController({ value: "alpha" });
    controller.setViewportMetrics({ visibleRowCapacity: 4, wrapColumns: 24, softWrap: true });
    controller.updatePresentationState((presentation) => {
      presentation.ui.commandLine = {
        active: true,
        value: "format",
        prompt: ":"
      };
    });

    const frame = stripAnsi(
      renderEditorAnsiFrame({
        state: controller.getState(),
        presentation: controller.getPresentationState(),
        cols: 30,
        rows: 6
      })
    );

    expect(frame).toContain(":format");
  });

  it("enters and exits alternate screen through the mirror adapter", () => {
    const writes: string[] = [];
    const mirror = createAnsiEditorMirror({
      value: "alpha",
      cols: 30,
      rows: 6,
      write: (text) => {
        writes.push(text);
      }
    });

    mirror.mount();
    mirror.destroy();

    expect(writes[0]).toContain("\u001b[?1049h");
    expect(writes[writes.length - 1]).toContain("\u001b[?1049l");
  });

  it("coalesces rapid controller updates into one render write", async () => {
    const controller = createEditorController({ value: "alpha" });
    const writes: string[] = [];
    const mirror = createAnsiEditorMirror({
      controller,
      cols: 30,
      rows: 6,
      write: (text) => {
        writes.push(text);
      }
    });

    mirror.mount();
    writes.length = 0;

    controller.execute(moveRight);
    controller.execute(moveRight);
    await Promise.resolve();

    expect(writes).toHaveLength(1);
    mirror.destroy();
  });

  it("resizes the mirror and updates controller viewport metrics", () => {
    const controller = createEditorController({ value: "alpha\nbeta\ngamma" });
    const mirror = createAnsiEditorMirror({
      controller,
      cols: 30,
      rows: 6,
      write: vi.fn()
    });

    mirror.mount();
    mirror.resize({ cols: 20, rows: 8 });

    expect(controller.getPresentationState().viewport.visibleRowCapacity).toBe(6);
    expect(controller.getPresentationState().viewport.wrapColumns).toBeGreaterThan(0);
    mirror.destroy();
  });

  it("applies provided language services through the controller session", async () => {
    const controller = createEditorController({ value: "const value = 1;" });
    const highlighter = {
      open: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      getHighlights: vi.fn(async () => [{ from: 0, to: 5, role: "keyword" as const }])
    };
    const mirror = createAnsiEditorMirror({
      controller,
      languageServices: { highlighter },
      cols: 30,
      rows: 6,
      write: vi.fn()
    });

    mirror.mount();
    await flushAsyncWork();

    expect(controller.getPresentationState().language.visibleHighlights).toEqual([
      { from: 0, to: 5, role: "keyword" }
    ]);

    mirror.destroy();
  });

  it("can mirror a controller selection into the frame", () => {
    const controller = createEditorController({ value: "alpha\nbeta" });
    controller.setViewportMetrics({ visibleRowCapacity: 4, wrapColumns: 24, softWrap: true });
    controller.replaceState(
      createEditorState({
        value: "alpha\nbeta",
        selection: createCharacterSelection(createEditorState({ value: "alpha\nbeta" }).doc, 6)
      })
    );

    const frame = stripAnsi(
      renderEditorAnsiFrame({
        state: controller.getState(),
        presentation: controller.getPresentationState(),
        cols: 30,
        rows: 6
      })
    );

    expect(frame).toContain("beta");
  });

  it("accepts interactive key input in the terminal frontend", async () => {
    const controller = createEditorController({ value: "alpha\nbeta\nalpha" });
    const input = new FakeInput();
    const output = new FakeOutput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      output,
      cols: 30,
      rows: 6,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit("j");
    input.emit("/");
    input.emit("beta");
    input.emit("\r");
    await flushAsyncWork();

    expect(controller.getState().doc.positionAt(controller.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 1,
      column: 3
    });
    expect(controller.getSearchState().query).toBe("beta");
    terminal.destroy();
    expect(input.rawModeCalls).toEqual([true, false]);
  });

  it("supports n/N search repetition in the terminal frontend", async () => {
    const controller = createEditorController({ value: "alpha beta alpha" });
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 40,
      rows: 6,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit("/");
    input.emit("alpha");
    input.emit("\r");
    await flushAsyncWork();
    input.emit("n");
    await flushAsyncWork();

    expect(controller.getSearchState().lastMatch).toEqual({ from: 11, to: 16 });

    input.emit("N");
    await flushAsyncWork();
    expect(controller.getSearchState().lastMatch).toEqual({ from: 0, to: 5 });
    terminal.destroy();
  });

  it("supports :q in the terminal frontend", async () => {
    const input = new FakeInput();
    const exit = vi.fn();
    const terminal = createAnsiEditorTerminal({
      value: "alpha",
      input,
      cols: 30,
      rows: 6,
      write: vi.fn(),
      enterAltScreen: false,
      exit
    });

    terminal.mount();
    input.emit(":");
    input.emit("q");
    input.emit("\r");
    await flushAsyncWork();

    expect(exit).toHaveBeenCalledWith(0);
  });

  it("supports :theme switching in the terminal frontend", async () => {
    const sunriseTheme = {
      name: "sunrise",
      colors: {
        background: "#1b1410",
        text: "#f6e7d8",
        keyword: "#ffb86c"
      }
    };
    const tideTheme = {
      name: "tide",
      colors: {
        background: "#0c1824",
        text: "#d9f0ff",
        keyword: "#7dd3fc"
      }
    };
    const controller = createEditorController({ value: "alpha" });
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 40,
      rows: 6,
      write: vi.fn(),
      enterAltScreen: false,
      theme: sunriseTheme,
      availableThemes: [sunriseTheme, tideTheme]
    });

    terminal.mount();
    input.emit(":");
    input.emit("theme tide");
    input.emit("\r");
    await flushAsyncWork();

    expect(controller.getPresentationState().themeName).toBe("tide");
    terminal.destroy();
  });

  it("supports flash-target input through the shared controller path", () => {
    const controller = createEditorController({ value: "alpha beta gamma" });
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 40,
      rows: 6,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit(" ");
    input.emit("a");
    return flushAsyncWork().then(() => {
      expect(controller.getPresentationState().ui.flash.active).toBe(true);
      expect(controller.getPresentationState().ui.flash.hints.length).toBeGreaterThan(0);
      terminal.destroy();
    });
  });

  it("supports Ctrl-o and terminal Ctrl-i jumplist navigation through the shared controller path", async () => {
    const controller = createEditorController({ value: "one\ntwo\nthree" });
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 40,
      rows: 6,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit("l");
    input.emit("\u0013");
    input.emit("j");
    input.emit("\u000f");
    await flushAsyncWork();

    expect(controller.getState().selection.ranges[0]?.head).toBe(1);

    input.emit("\t");
    await flushAsyncWork();
    expect(controller.getState().selection.ranges[0]?.head).toBe(5);
    terminal.destroy();
  });
});
