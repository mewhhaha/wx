// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  appendInsertMode,
  createCharacterSelection,
  createEditorState,
  createSelection,
  enterInsertMode,
  moveRight
} from "@mewhhaha/wx-core";
import { createEditorController } from "@mewhhaha/wx-controller";
import { createEditor } from "@mewhhaha/wx-dom";
import { collectCrossPackageSrcLeaks } from "../../../test-utils/package-boundaries";

import { createAnsiEditorMirror, createNodeHostServices, parseAnsiInput, renderEditorAnsiFrame } from "./index";
import { createAnsiEditorTerminal } from "./index";
import { renderEditorAnsiWorkspaceFrame } from "./frame";
import { resolveGitAwareProjectRoot } from "./node-host";

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
    const configSource = readFileSync(resolve(process.cwd(), "packages/editor-view-ansi/tsup.config.ts"), "utf8");

    expect(source).toContain('@wx/editor-tree-sitter/node');
    expect(source).toContain('@mewhhaha/wx-theme');
    expect(source).not.toContain("apps/playground/src/phTheme");
    expect(configSource).not.toContain("../editor-tree-sitter/src/nodeWorker.ts");
    expect(source).not.toContain("treeSitter.worker");
    expect(source).not.toContain("worker_threads");
    expect(source).not.toContain("createNodeWorkerBridge");
  });

  it("ships a global wx bin entry for terminal install flow", () => {
    const packageSource = readFileSync(resolve(process.cwd(), "packages/editor-view-ansi/package.json"), "utf8");
    const configSource = readFileSync(resolve(process.cwd(), "packages/editor-view-ansi/tsup.config.ts"), "utf8");
    const cliSource = readFileSync(resolve(process.cwd(), "packages/editor-view-ansi/src/cli.ts"), "utf8");

    expect(packageSource).toContain('"wx": "./dist/wx.js"');
    expect(configSource).toContain('wx: "src/cli.ts"');
    expect(configSource).toContain("#!/usr/bin/env node");
    expect(cliSource).toContain("createAnsiEditorTerminal");
    expect(cliSource).toContain("createNodeHostServices");
  });

  it("routes ANSI runtime keyboard input through controller key APIs only", () => {
    const source = readFileSync(resolve(process.cwd(), "packages/editor-view-ansi/src/terminal.ts"), "utf8");
    const indexSource = readFileSync(resolve(process.cwd(), "packages/editor-view-ansi/src/index.ts"), "utf8");

    expect(indexSource).toContain('from "@mewhhaha/wx-controller"');
    expect(source).toContain("controller.handleKeyInput");
    expect(source).toContain("normalizeLanguageServices");
    expect(source).not.toContain("controller.openCommandLine(");
    expect(source).not.toContain("controller.handleCommandLineKey(");
    expect(source).not.toContain("controller.updatePresentationState(");
    expect(source).not.toContain("function normalizeLanguageServices(");
  });

  it("keeps ANSI runtime modules on public package surfaces only", () => {
    expect(collectCrossPackageSrcLeaks("packages/editor-view-ansi/src")).toEqual([]);
  });

  it("searches repo files through the default Node host helper", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "wx-ansi-host-"));
    await mkdir(resolve(cwd, "src", "nested"), { recursive: true });
    await mkdir(resolve(cwd, "pkg"), { recursive: true });
    await writeFile(resolve(cwd, "src", "main.ts"), "export const main = 1;\n");
    await writeFile(resolve(cwd, "src", "nested", "beta.ts"), "export const beta = 2;\n");
    await writeFile(resolve(cwd, "pkg", "gamma.ts"), "export const gamma = 3;\n");
    const host = createNodeHostServices({ cwd });

    const repoMatches = await host.searchFiles?.({
      filePath: "src/main.ts",
      query: "ta"
    });

    expect(repoMatches?.map((entry) => entry.filePath)).toEqual(["src/nested/beta.ts"]);
    await expect(host.readFile?.({ filePath: "pkg/gamma.ts" })).resolves.toEqual({
      text: "export const gamma = 3;\n"
    });
  });

  it("writes files through the default Node host helper", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "wx-ansi-write-host-"));
    const host = createNodeHostServices({ cwd });

    await host.writeFile?.({
      filePath: "src/new-file.ts",
      text: "export const saved = true;\n"
    });

    await expect(host.readFile?.({ filePath: "src/new-file.ts" })).resolves.toEqual({
      text: "export const saved = true;\n"
    });
  });

  it("uses git root for repo search and respects .gitignore entries", async () => {
    const repoRoot = await mkdtemp(resolve(tmpdir(), "wx-ansi-git-host-"));
    const nestedCwd = resolve(repoRoot, "apps", "demo");
    await mkdir(resolve(repoRoot, "src"), { recursive: true });
    await mkdir(resolve(nestedCwd), { recursive: true });
    await writeFile(resolve(repoRoot, ".gitignore"), "ignored.ts\n");
    await writeFile(resolve(repoRoot, "src", "current.ts"), "export const current = 1;\n");
    await writeFile(resolve(repoRoot, "src", "visible.ts"), "export const visible = 2;\n");
    await writeFile(resolve(repoRoot, "ignored.ts"), "ignored\n");
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });

    const projectRoot = await resolveGitAwareProjectRoot(nestedCwd);
    const host = createNodeHostServices({ cwd: nestedCwd, projectRoot });
    const repoMatches = await host.searchFiles?.({
      filePath: "src/current.ts",
      query: ""
    });

    expect(projectRoot).toBe(repoRoot);
    expect(repoMatches?.map((entry) => entry.filePath)).toContain("src/visible.ts");
    expect(repoMatches?.map((entry) => entry.filePath)).not.toContain("ignored.ts");
  });

  it("lists repo folders through the default Node host helper and respects ignored directories", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "wx-ansi-folder-host-"));
    await mkdir(resolve(cwd, "src", "nested"), { recursive: true });
    await mkdir(resolve(cwd, "node_modules", "hidden"), { recursive: true });
    await writeFile(resolve(cwd, "src", "main.ts"), "export const main = 1;\n");
    await writeFile(resolve(cwd, "src", "nested", "beta.ts"), "export const beta = 2;\n");
    await writeFile(resolve(cwd, "node_modules", "hidden", "ignored.ts"), "ignored\n");
    const host = createNodeHostServices({ cwd });

    await expect(host.listFolders?.({ filePath: "src/main.ts" })).resolves.toEqual([
      { folderPath: "." },
      { folderPath: "src" },
      { folderPath: "src/nested" }
    ]);
  });

  it("searches root files through Node host helper without adding a slash prefix", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "wx-ansi-folder-root-"));
    await mkdir(resolve(cwd, "src"), { recursive: true });
    await writeFile(resolve(cwd, "package.json"), '{ "name": "wx-test" }\n');
    await writeFile(resolve(cwd, "README.md"), "# readme\n");
    await writeFile(resolve(cwd, "src", "main.ts"), "export const main = 1;\n");
    const host = createNodeHostServices({ cwd });

    const matches = await host.searchFiles?.({
      filePath: "package.json",
      query: ""
    });

    expect(matches?.map((entry) => entry.filePath)).toContain("README.md");
    expect(matches?.map((entry) => entry.filePath)).toContain("src/main.ts");
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

  it("renders scratch title by default in ANSI frame output", () => {
    const controller = createEditorController({ value: "alpha" });
    controller.setViewportMetrics({
      visibleRowCapacity: 4,
      wrapColumns: 24,
      softWrap: true
    });

    const frame = stripAnsi(
      renderEditorAnsiFrame({
        state: controller.getState(),
        presentation: controller.getPresentationState(),
        cols: 30,
        rows: 6
      })
    );

    expect(frame).toContain("[scratch]");
  });

  it("renders split workspace panes with divider lines", () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.splitPane("vertical");

    const frame = stripAnsi(
      renderEditorAnsiWorkspaceFrame({
        workspace: controller.getWorkspacePresentationState(),
        cols: 80,
        rows: 12
      })
    );

    expect(frame).toContain("alpha");
    expect(frame).toContain("│");
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
    expect(frame).toContain("\u001b[?25l");
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

  it("renders modal picker search as popover with list and preview", () => {
    const { state, presentation } = createPresentation("alpha\nbeta");
    presentation.ui.picker = {
      active: true,
      loading: false,
      title: "repo",
      items: [
        { kind: "file", label: "src/main.ts", filePath: "src/main.ts", detail: "saved", selected: true },
        { kind: "file", label: "src/beta.ts", filePath: "src/beta.ts", detail: "saved", selected: false }
      ],
      selectedIndex: 0,
      error: null,
      query: "ma",
      variant: "modal",
      previewTitle: "src/main.ts",
      previewContent: "export const main = 1;\nexport const beta = 2;",
      previewLoading: false
    };

    const frame = stripAnsi(
      renderEditorAnsiFrame({
        state,
        presentation,
        cols: 90,
        rows: 14
      })
    );

    expect(frame).toContain("ma");
    expect(frame).not.toContain("repo>ma");
    expect(frame).toContain("main.ts");
    expect(frame).toContain("src/");
    expect(frame).toContain("export const m");
    expect(frame).toContain("│");
    expect(frame).not.toContain("src/main.ts");
    expect(frame).not.toContain("\u001b[?25h");
  });

  it("renders combo picker search as centered input with result list", () => {
    const { state, presentation } = createPresentation("alpha\nbeta");
    presentation.ui.picker = {
      active: true,
      loading: false,
      title: "repo",
      items: [
        { label: "src/main.ts", detail: "saved", selected: true },
        { label: "src/beta.ts", detail: "saved", selected: false }
      ],
      selectedIndex: 0,
      error: null,
      query: "ma",
      variant: "combo",
      previewTitle: "",
      previewContent: "",
      previewLoading: false
    };

    const frame = stripAnsi(
      renderEditorAnsiFrame({
        state,
        presentation,
        cols: 90,
        rows: 14
      })
    );

    expect(frame).toContain("ma");
    expect(frame).toContain("1/2");
    expect(frame).toContain("");
    expect(frame).toContain("main.ts");
    expect(frame).toContain("beta.ts");
    expect(frame).toContain("src/");
    expect(frame).not.toContain("# src/main.ts");
    expect(frame).not.toContain("export const m");
    expect(frame).not.toContain("src/main.ts");
    expect(frame).not.toContain("\u001b[?25h");
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
    input.emit("t");
    input.emit("\r");
    input.emit("\u001b[Z");
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

  it("uses Node host fallback so Ctrl+p populates file results in terminal mode", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "wx-ansi-terminal-"));
    await mkdir(resolve(cwd, "src"), { recursive: true });
    await writeFile(resolve(cwd, "src", "current.ts"), "export const current = 1;\n");
    await writeFile(resolve(cwd, "src", "beta.ts"), "export const beta = 2;\n");
    const controller = createEditorController({ value: "export const current = 1;\n", filePath: "src/current.ts" });
    const input = new FakeInput();
    const writes: string[] = [];
    const previousCwd = process.cwd();
    process.chdir(cwd);

    try {
      const terminal = createAnsiEditorTerminal({
        controller,
        input,
        cols: 80,
        rows: 12,
        write: (text) => {
          writes.push(text);
        },
        enterAltScreen: false
      });

      terminal.mount();
      await expect(controller.searchFiles("b")).resolves.toEqual([{ filePath: "src/beta.ts" }]);
      input.emit("\u0010");
      await flushAsyncWork(64);
      input.emit("b");
      await flushAsyncWork(64);

      expect(controller.getPresentationState().ui.picker.title).toBe("repo");
      expect(controller.getPresentationState().ui.picker.variant).toBe("combo");
      expect(controller.getPresentationState().ui.picker.items.map((entry) => entry.label)).toContain("src/beta.ts");
      terminal.destroy();
    } finally {
      process.chdir(previousCwd);
    }

    expect(writes.length).toBeGreaterThan(0);
  });

  it("keeps j and k as search characters in combo picker and uses arrows for movement", async () => {
    const controller = createEditorController({ value: "export const current = 1;\n", filePath: "src/current.ts" });
    controller.setHostServices({
      async searchFiles(context) {
        return [
          { filePath: "src/jk-alpha.ts" },
          { filePath: "src/jk-beta.ts" },
          { filePath: "src/other.ts" }
        ].filter((entry) => entry.filePath.toLowerCase().includes(context.query.toLowerCase()));
      }
    });
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 80,
      rows: 12,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit("\u0010");
    await flushAsyncWork();
    input.emit("j");
    await flushAsyncWork();
    input.emit("k");
    await flushAsyncWork();
    input.emit("\u001b[B");
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.picker.query).toBe("jk");
    expect(controller.getPresentationState().ui.picker.selectedIndex).toBe(1);
    terminal.destroy();
  });

  it("routes Shift+Tab through ANSI command completion cycling", async () => {
    const sunriseTheme = {
      name: "sunrise",
      colors: {
        background: "#20110f"
      }
    };
    const tideTheme = {
      name: "tide",
      colors: {
        background: "#042f3a"
      }
    };
    const controller = createEditorController({ value: "alpha" });
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 80,
      rows: 12,
      write: vi.fn(),
      enterAltScreen: false,
      theme: sunriseTheme,
      availableThemes: [sunriseTheme, tideTheme]
    });

    terminal.mount();
    input.emit(":");
    input.emit("t");
    input.emit("\r");
    await flushAsyncWork();

    input.emit("\t");
    await flushAsyncWork();
    expect(controller.getPresentationState().ui.previewTheme).toBe("wx-daybreak");

    input.emit("\u001b[Z");
    await flushAsyncWork();
    expect(controller.getPresentationState().ui.previewTheme).toBe("sunrise");

    input.emit("\u001b[Z");
    await flushAsyncWork();
    expect(controller.getPresentationState().ui.previewTheme).toBe("tide");
    terminal.destroy();
  });

  it("decodes Alt chords from ANSI escape-prefixed input", () => {
    expect(parseAnsiInput("\u001bg")).toEqual(["Alt+g"]);
    expect(parseAnsiInput("\u001bG")).toEqual(["Alt+G"]);
    expect(parseAnsiInput("\u001br")).toEqual(["Alt+r"]);
  });

  it("decodes Ctrl-w window chords from ANSI control input", () => {
    expect(parseAnsiInput("\u0017")).toEqual(["Ctrl+w"]);
    expect(parseAnsiInput("\u0013")).toEqual(["Ctrl+s"]);
    expect(parseAnsiInput("\u0010")).toEqual(["Ctrl+p"]);
    expect(parseAnsiInput("\u0011")).toEqual(["Ctrl+q"]);
    expect(parseAnsiInput("\u0008")).toEqual(["Ctrl+h"]);
    expect(parseAnsiInput("\u001bOQ")).toEqual(["F2"]);
    expect(parseAnsiInput("\u001b[12~")).toEqual(["F2"]);
  });

  it("routes Ctrl+Space through ANSI completion requests", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.setLanguageServices([
      {
        completion: {
          async complete() {
            return [{ label: "alphabet", detail: "value", sortText: "a" }];
          }
        }
      }
    ]);
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 80,
      rows: 12,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit("\0");
    await flushAsyncWork();

    expect(controller.getPresentationState().ui.completion.active).toBe(true);
    expect(controller.getPresentationState().ui.completion.items.map((item) => item.label)).toEqual(["alphabet"]);
    terminal.destroy();
  });

  it("routes Alt+g, Alt+Shift+g, and Alt+r through shared ANSI LSP commands", async () => {
    const controller = createEditorController({ value: "alpha beta alpha", filePath: "src/current.ts" });
    controller.setHostServices({
      async readFile({ filePath }) {
        return { text: `preview:${filePath}` };
      }
    });
    controller.setLanguageServices([
      {
        goto: {
          async definition() {
            return [{ from: 11, to: 16 }];
          },
          async references() {
            return [
              { filePath: "src/ref-a.ts", from: 0, to: 3 },
              { filePath: "src/ref-b.ts", from: 2, to: 5 }
            ];
          }
        }
      }
    ]);
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 80,
      rows: 12,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit("\u001bg");
    await flushAsyncWork();
    expect(controller.getState().selection.ranges[0]?.anchor).toBe(11);

    input.emit("\u001bG");
    await flushAsyncWork(64);
    expect(controller.getPresentationState().ui.picker.title).toBe("references");
    expect(controller.getPresentationState().ui.picker.items.map((item) => item.label)).toEqual([
      "src/ref-a.ts",
      "src/ref-b.ts"
    ]);

    input.emit("\u001b");
    await flushAsyncWork(64);
    input.emit("\u001br");
    await flushAsyncWork(64);
    expect(controller.getPresentationState().ui.commandLine.value).toBe("rename ");
    terminal.destroy();
  });

  it("routes Ctrl-w pane commands and g n/g p through shared ANSI input", async () => {
    const controller = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    controller.setHostServices({
      async readFile({ filePath }) {
        return { text: `opened:${filePath}` };
      }
    });
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 80,
      rows: 12,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit("\u0017");
    input.emit("v");
    await flushAsyncWork();
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(2);

    input.emit("\u0017");
    input.emit("n");
    await flushAsyncWork();
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(3);
    expect(controller.getPresentationState().bufferTitle).toBe("[scratch]");

    await controller.openBuffer("src/one.ts");
    await controller.openBuffer("src/two.ts");

    input.emit("g");
    input.emit("p");
    await flushAsyncWork();
    expect(controller.getPresentationState().filePath).toBe("src/one.ts");

    input.emit("g");
    input.emit("n");
    await flushAsyncWork();
    expect(controller.getPresentationState().filePath).toBe("src/two.ts");

    input.emit("\u0017");
    input.emit("o");
    await flushAsyncWork();
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(1);
    terminal.destroy();
  });

  it("routes Ctrl-w f/F and Ctrl-w H through shared ANSI input", async () => {
    const controller = createEditorController({
      value: 'import "./other.ts:2:3";',
      filePath: "src/current.ts",
      selection: createSelection(8, 22)
    });
    controller.setHostServices({
      async readFile({ filePath }) {
        return { text: `opened:${filePath}` };
      }
    });
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 80,
      rows: 12,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit("\u0017");
    input.emit("F");
    await flushAsyncWork();
    expect(controller.getWorkspacePresentationState().panes).toHaveLength(2);
    expect(controller.getPresentationState().filePath).toBe("src/other.ts");

    const beforeTree = controller.getWorkspacePresentationState().layoutTree;
    input.emit("\u0017");
    input.emit("H");
    await flushAsyncWork();
    expect(controller.getWorkspacePresentationState().layoutTree).not.toEqual(beforeTree);
    terminal.destroy();
  });

  it("keeps completion navigation parity between DOM and ANSI", async () => {
    const domController = createEditorController({ value: "al", selection: createSelection(0, 1) });
    const ansiController = createEditorController({ value: "al", selection: createSelection(0, 1) });
    const services = {
      completion: {
        async complete() {
          return [
            { label: "alpha", sortText: "b" },
            { label: "beta", insertText: "omega", sortText: "a" }
          ];
        }
      }
    };

    const container = document.createElement("div");
    document.body.append(container);
    createEditor(container, { controller: domController, languageServices: services });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller: ansiController,
      languageServices: services,
      input,
      cols: 80,
      rows: 12,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: " ", ctrlKey: true, bubbles: true }));
    input.emit("\0");
    await flushAsyncWork(64);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    input.emit("\t");
    await flushAsyncWork(64);

    expect(domController.getPresentationState().ui.completion.selectedIndex).toBe(
      ansiController.getPresentationState().ui.completion.selectedIndex
    );

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    input.emit("\u001b[Z");
    await flushAsyncWork(64);

    expect(domController.getPresentationState().ui.completion.selectedIndex).toBe(
      ansiController.getPresentationState().ui.completion.selectedIndex
    );

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.emit("\r");
    await flushAsyncWork(64);

    expect(domController.getState().doc.text).toBe("omega");
    expect(ansiController.getState().doc.text).toBe("omega");
    terminal.destroy();
  });

  it("keeps ? workspace-symbol and F2 rename parity between DOM and ANSI", async () => {
    const services = {
      goto: {
        async references() {
          return [{ filePath: "src/ref.ts", from: 0, to: 3 }];
        }
      },
      symbols: {
        async workspaceSymbols(query: string) {
          return query ? [{ name: `${query}Symbol`, from: 0, to: 2, filePath: "src/query.ts" }] : [];
        }
      }
    };
    const domController = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    const ansiController = createEditorController({ value: "alpha", filePath: "src/current.ts" });
    const container = document.createElement("div");
    document.body.append(container);
    createEditor(container, {
      controller: domController,
      languageServices: services
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller: ansiController,
      languageServices: services,
      input,
      cols: 80,
      rows: 12,
      write: vi.fn(),
      enterAltScreen: false
    });
    terminal.mount();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "S", bubbles: true }));
    input.emit("?");
    input.emit("S");
    await flushAsyncWork(64);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    input.emit("a");
    await flushAsyncWork(64);

    expect(domController.getPresentationState().ui.picker.title).toBe(ansiController.getPresentationState().ui.picker.title);
    expect(domController.getPresentationState().ui.picker.query).toBe(ansiController.getPresentationState().ui.picker.query);
    expect(domController.getPresentationState().ui.picker.items.map((item) => item.label)).toEqual(
      ansiController.getPresentationState().ui.picker.items.map((item) => item.label)
    );

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    input.emit("\u001b");
    await flushAsyncWork(64);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    input.emit("\u001bOQ");
    await flushAsyncWork(64);

    expect(domController.getPresentationState().ui.commandLine.value).toBe("rename ");
    expect(ansiController.getPresentationState().ui.commandLine.value).toBe("rename ");
    terminal.destroy();
  });

  it("keeps explicit controller host services instead of replacing them with Node fallback", async () => {
    const searchFiles = vi.fn(async () => [{ filePath: "src/explicit.ts" }]);
    const controller = createEditorController({ value: "export const current = 1;\n", filePath: "src/current.ts" });
    controller.setHostServices({ searchFiles });
    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 80,
      rows: 12,
      write: vi.fn(),
      enterAltScreen: false
    });

    terminal.mount();
    input.emit("\u0010");
    await flushAsyncWork(64);

    expect(searchFiles).toHaveBeenCalled();
    expect(controller.getPresentationState().ui.picker.items.map((entry) => entry.label)).toEqual(["src/explicit.ts"]);
    terminal.destroy();
  });

  it("keeps processing ANSI keys after one input handler failure", async () => {
    const controller = createEditorController({ value: "alpha" });
    const originalHandleKeyInput = controller.handleKeyInput.bind(controller);
    const handleKeyInput = vi.spyOn(controller, "handleKeyInput");
    handleKeyInput.mockImplementation(async (...args) => originalHandleKeyInput(...args));
    handleKeyInput.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
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
    input.emit("l");
    await flushAsyncWork(64);

    expect(controller.getState().selection.ranges[0]?.head).toBe(1);
    expect(handleKeyInput).toHaveBeenCalledTimes(2);
    terminal.destroy();
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
