import { describe, expect, it, vi } from "vitest";

import {
  createEditorState,
  createSelection,
  enterInsertMode,
  moveRight
} from "@mewhhaha/wx-core";
import { createEditorController } from "@mewhhaha/wx-controller";
import { graphiteTheme } from "@mewhhaha/wx-theme";

import { terminalTextWidth } from "./cell-width";
import { createAnsiFramePatch, serializeAnsiFrameSnapshot } from "./damage";
import { createEditorAnsiFrameSnapshot, createEditorAnsiWorkspaceFrameSnapshot } from "./frame";
import { createAnsiEditorMirror, createAnsiEditorTerminal } from "./terminal";
import type { AnsiFrameSnapshot } from "./terminal-types";
import { VirtualAnsiTerminal } from "./virtual-terminal";

function replay(previous: AnsiFrameSnapshot, next: AnsiFrameSnapshot, forceFull = false) {
  for (const snapshot of [previous, next]) {
    for (const row of snapshot.serializedRows) {
      expect(terminalTextWidth(row.replace(/\u001b\[[0-9;? ]*[A-Za-z]/g, ""))).toBe(snapshot.cols);
    }
  }
  const patch = createAnsiFramePatch(previous, next, { forceFull });
  const patched = new VirtualAnsiTerminal(next.cols, next.rows);
  patched.write(serializeAnsiFrameSnapshot(previous));
  patched.write(patch.text);
  const oracle = new VirtualAnsiTerminal(next.cols, next.rows);
  oracle.write(serializeAnsiFrameSnapshot(next));
  expect(patched.snapshot()).toEqual(oracle.snapshot());
  return patch;
}

function snapshotFor(controller: ReturnType<typeof createEditorController>, cols = 100, rows = 30) {
  controller.setViewportMetrics({
    visibleRowCapacity: Math.max(1, rows - 2),
    wrapColumns: Math.max(1, cols - 6),
    softWrap: true
  });
  return createEditorAnsiFrameSnapshot({
    state: controller.getState(),
    presentation: controller.getPresentationState(),
    cols,
    rows
  });
}

class FakeInput {
  private readonly listeners = new Set<(chunk: Uint8Array | string) => void>();
  readonly rawModes: boolean[] = [];
  pauses = 0;
  resumes = 0;

  on(_event: "data", listener: (chunk: Uint8Array | string) => void) {
    this.listeners.add(listener);
  }
  off(_event: "data", listener: (chunk: Uint8Array | string) => void) {
    this.listeners.delete(listener);
  }
  emit(chunk: Uint8Array | string) {
    for (const listener of this.listeners) listener(chunk);
  }
  pause() {
    this.pauses += 1;
  }
  resume() {
    this.resumes += 1;
  }
  setRawMode(value: boolean) {
    this.rawModes.push(value);
  }
}

function deferredWriter() {
  const writes: string[] = [];
  const resolvers: Array<() => void> = [];
  return {
    writes,
    write(text: string) {
      writes.push(text);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    },
    resolveNext() {
      const resolve = resolvers.shift();
      if (!resolve) throw new Error("No pending terminal write");
      resolve();
    },
    get pending() {
      return resolvers.length;
    }
  };
}

describe("ANSI retained damage rendering", () => {
  it("keeps stable 100x30 cursor motion below 1KB and addresses only damaged rows", () => {
    const value = Array.from({ length: 40 }, (_, index) => `line ${index} ${"x".repeat(50)}`).join("\n");
    const controller = createEditorController({ value });
    controller.execute(enterInsertMode);
    const before = snapshotFor(controller);
    controller.execute(moveRight);
    const after = snapshotFor(controller);
    const patch = replay(before, after);

    expect(patch.bytes).toBeLessThanOrEqual(1024);
    expect(patch.kind === "cursor" || patch.kind === "rows").toBe(true);
    for (let row = 0; row < before.rows; row += 1) {
      if (!patch.damagedRows.includes(row)) {
        expect(patch.text).not.toContain(`\u001b[${row + 1};1H`);
      }
    }
  });

  it("does not serialize unchanged rows for a one-line edit", () => {
    const beforeController = createEditorController({ value: "alpha\nbeta\ngamma\ndelta" });
    const afterController = createEditorController({ value: "alpha\nbeta!\ngamma\ndelta" });
    const before = snapshotFor(beforeController, 80, 12);
    const after = snapshotFor(afterController, 80, 12);
    const patch = replay(before, after);

    expect(patch.kind).toBe("rows");
    expect(patch.damagedRows.length).toBeLessThan(before.rows);
    for (let row = 0; row < before.rows; row += 1) {
      if (before.serializedRows[row] === after.serializedRows[row]) {
        expect(patch.damagedRows).not.toContain(row);
        expect(patch.text).not.toContain(`\u001b[${row + 1};1H`);
      }
    }
  });

  it("replays Unicode, tabs, wrapping, selections, diagnostics, pickers, and split panes to the full oracle", () => {
    const unicodeController = createEditorController({ value: "界 e\u0301\talpha beta gamma delta epsilon\nsecond" });
    unicodeController.setViewportMetrics({ visibleRowCapacity: 8, wrapColumns: 12, softWrap: true });
    const unicodeBefore = createEditorAnsiFrameSnapshot({
      state: unicodeController.getState(),
      presentation: unicodeController.getPresentationState(),
      cols: 28,
      rows: 10
    });
    unicodeController.replaceState(
      createEditorState({
        value: "界 e\u0301\talpha beta gamma delta epsilon\nsecond",
        selection: createSelection(2, 18),
        mode: "visual"
      })
    );
    const unicodeAfter = createEditorAnsiFrameSnapshot({
      state: unicodeController.getState(),
      presentation: unicodeController.getPresentationState(),
      cols: 28,
      rows: 10
    });
    expect(replay(unicodeBefore, unicodeAfter).kind).toBe("rows");

    const diagnosticBefore = unicodeAfter;
    unicodeController.updatePresentationState((presentation) => {
      const diagnostic = { from: 0, to: 1, severity: "warning" as const, message: "wide warning" };
      presentation.language.diagnostics = [diagnostic];
      presentation.language.diagnosticsByLine = new Map([[0, [diagnostic]]]);
      presentation.language.visibleDiagnostics = [diagnostic];
    });
    const diagnosticAfter = createEditorAnsiFrameSnapshot({
      state: unicodeController.getState(),
      presentation: unicodeController.getPresentationState(),
      cols: 28,
      rows: 10
    });
    replay(diagnosticBefore, diagnosticAfter);

    const pickerBefore = createEditorAnsiFrameSnapshot({
      state: unicodeController.getState(),
      presentation: unicodeController.getPresentationState(),
      cols: 90,
      rows: 14
    });
    unicodeController.getPresentationState().ui.picker = {
      active: true,
      loading: false,
      title: "files",
      items: [
        { kind: "file", label: "src/界.ts", filePath: "src/界.ts", detail: "saved", selected: true },
        { kind: "file", label: "src/e\u0301.ts", filePath: "src/e\u0301.ts", detail: "saved", selected: false }
      ],
      selectedIndex: 0,
      error: null,
      query: "界",
      variant: "modal",
      previewTitle: "src/界.ts",
      previewContent: "export const wide = '界';",
      previewLoading: false
    };
    const pickerAfter = createEditorAnsiFrameSnapshot({
      state: unicodeController.getState(),
      presentation: unicodeController.getPresentationState(),
      cols: 90,
      rows: 14
    });
    expect(replay(pickerBefore, pickerAfter).kind).toBe("rows");
    const pickerOracle = new VirtualAnsiTerminal(90, 14);
    pickerOracle.write(serializeAnsiFrameSnapshot(pickerAfter));
    expect(pickerOracle.textRows().join("\n")).toContain("界");

    const splitController = createEditorController({ value: "left 界\nright e\u0301", filePath: "src/main.ts" });
    const single = snapshotFor(splitController, 80, 12);
    splitController.splitPane("vertical");
    const workspace = splitController.getWorkspacePresentationState();
    const split = createEditorAnsiWorkspaceFrameSnapshot({ workspace, cols: 80, rows: 12 });
    replay(single, split);
  });

  it("forces exact full repaints on resize, theme, redraw, resume, desync, and Ctrl-l", async () => {
    const writes: string[] = [];
    const controller = createEditorController({ value: "alpha\nbeta" });
    const mirror = createAnsiEditorMirror({
      controller,
      cols: 40,
      rows: 8,
      enterAltScreen: false,
      write: (text) => writes.push(text)
    });
    mirror.mount();
    await mirror.whenIdle();
    const initialFullCount = mirror.getMetrics().fullRepaints;

    mirror.resize({ cols: 52, rows: 10 });
    await mirror.whenIdle();
    mirror.setTheme(graphiteTheme);
    await mirror.whenIdle();
    mirror.renderNow();
    mirror.resume();
    mirror.markDesynchronized();
    await mirror.whenIdle();

    expect(mirror.getMetrics().fullRepaints - initialFullCount).toBe(5);
    expect(writes.slice(-5).every((write) => write.includes("\u001b[2J"))).toBe(true);
    const expected = createEditorAnsiFrameSnapshot({
      state: controller.getState(),
      presentation: controller.getPresentationState(),
      theme: graphiteTheme,
      cols: 52,
      rows: 10
    });
    const restored = new VirtualAnsiTerminal(52, 10);
    restored.write(writes.at(-1)!);
    const oracle = new VirtualAnsiTerminal(52, 10);
    oracle.write(serializeAnsiFrameSnapshot(expected));
    expect(restored.snapshot()).toEqual(oracle.snapshot());
    mirror.destroy();

    const input = new FakeInput();
    const terminal = createAnsiEditorTerminal({
      value: "alpha",
      input,
      cols: 40,
      rows: 8,
      enterAltScreen: false,
      write: vi.fn()
    });
    terminal.mount();
    await terminal.whenIdle();
    const beforeCtrlL = terminal.getMetrics().fullRepaints;
    input.emit("\u000c");
    await terminal.whenIdle();
    expect(terminal.getMetrics().fullRepaints).toBe(beforeCtrlL + 1);
    terminal.destroy();
  });

  it("coalesces slow async output to one pending frame and reports accepted bytes and age", async () => {
    let clock = 0;
    const writer = deferredWriter();
    const controller = createEditorController({ value: "abcdefghijklmnopqrstuvwxyz" });
    const mirror = createAnsiEditorMirror({
      controller,
      cols: 100,
      rows: 30,
      enterAltScreen: false,
      now: () => clock,
      write: writer.write
    });
    mirror.mount();
    expect(writer.pending).toBe(1);

    controller.execute(enterInsertMode);
    for (let index = 0; index < 30; index += 1) {
      controller.execute(moveRight);
      clock += 2;
      await Promise.resolve();
    }
    expect(mirror.getMetrics().outputQueueDepth).toBe(2);
    expect(mirror.getMetrics().maxOutputQueueDepth).toBe(2);

    writer.resolveNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(writer.pending).toBe(1);
    clock += 20;
    writer.resolveNext();
    await mirror.whenIdle();

    const metrics = mirror.getMetrics();
    const acceptedBytes = writer.writes.reduce((sum, write) => sum + new TextEncoder().encode(write).byteLength, 0);
    expect(metrics.bytesWritten).toBe(acceptedBytes);
    expect(metrics.maxOutputQueueAgeMs).toBeGreaterThan(0);
    expect(metrics.outputQueueDepth).toBe(0);
    expect(metrics.skippedFrames).toBeGreaterThan(0);
    mirror.destroy();
    writer.resolveNext();
    await mirror.whenIdle();
  });

  it("bounds rapid input parsing, preserves command order, and reports queue age", async () => {
    let clock = 0;
    const input = new FakeInput();
    const controller = createEditorController({ value: "tail" });
    const terminal = createAnsiEditorTerminal({
      controller,
      input,
      cols: 60,
      rows: 10,
      inputQueueLimit: 4,
      enterAltScreen: false,
      now: () => clock++,
      write: vi.fn()
    });
    terminal.mount();
    input.emit("iordered-edit");
    await terminal.whenIdle();

    expect(controller.getState().doc.text).toBe("ordered-edittail");
    expect(terminal.getMetrics().inputCommands).toBe("iordered-edit".length);
    expect(terminal.getMetrics().maxInputQueueDepth).toBeLessThanOrEqual(4);
    expect(terminal.getMetrics().maxInputQueueAgeMs).toBeGreaterThan(0);
    expect(terminal.getMetrics().inputPausedCount).toBeGreaterThan(0);
    expect(input.pauses).toBeGreaterThan(0);
    terminal.destroy();
    expect(input.rawModes).toEqual([true, false]);
  });

  it("retains split CSI and SS3 input until it is complete, while timing out a bare Escape", async () => {
    vi.useFakeTimers();
    try {
      const input = new FakeInput();
      const controller = createEditorController({ value: "abc" });
      const terminal = createAnsiEditorTerminal({
        controller,
        input,
        cols: 60,
        rows: 10,
        enterAltScreen: false,
        escapeSequenceTimeoutMs: 20,
        write: vi.fn()
      });
      terminal.mount();

      input.emit("\u001b");
      input.emit("[");
      input.emit("C");
      await terminal.whenIdle();
      expect(controller.getState().selection.ranges[0]?.anchor).toBe(1);

      input.emit("\u001bO");
      input.emit("H");
      await terminal.whenIdle();
      expect(controller.getState().selection.ranges[0]?.anchor).toBe(0);

      input.emit("\u001b");
      await vi.advanceTimersByTimeAsync(20);
      await terminal.whenIdle();
      expect(controller.getState().selection.ranges[0]?.anchor).toBe(0);

      input.emit("\u001b");
      terminal.destroy();
      await vi.advanceTimersByTimeAsync(20);
      expect(terminal.getMetrics().inputCommands).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [100, 30],
    [200, 60],
    [240, 80]
  ])("keeps 40-sample damage p95 and bytes bounded at %ix%i", (cols, rows) => {
    const value = Array.from({ length: 5_000 }, (_, index) => `${String(index).padStart(5, "0")} ${"x".repeat(90)}`).join("\n");
    const controller = createEditorController({ value });
    controller.execute(enterInsertMode);
    let previous = snapshotFor(controller, cols, rows);
    const durations: number[] = [];
    const bytes: number[] = [];
    for (let sample = 0; sample < 40; sample += 1) {
      controller.execute(moveRight);
      const started = performance.now();
      const next = snapshotFor(controller, cols, rows);
      const patch = createAnsiFramePatch(previous, next);
      durations.push(performance.now() - started);
      bytes.push(patch.bytes);
      previous = next;
    }
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.floor(durations.length * 0.95)]!;
    expect(p95).toBeLessThan(100);
    expect(Math.max(...bytes)).toBeLessThan(2_048);
  });
});
