import { describe, expect, it, vi } from "vitest";

import { createSelection, createSelectionSet } from "@mewhhaha/wx-core";

import { createEditorController } from "./index";

const key = (controller: ReturnType<typeof createEditorController>, value: string, alt = false) =>
  controller.handleKeyInput({ key: value, alt });

describe("selection transformation runtime", () => {
  it("routes selection algebra through the default keymap", async () => {
    const controller = createEditorController({
      value: "one two three",
      selection: createSelectionSet([
        { anchor: 0, head: 2 },
        { anchor: 4, head: 6 },
        { anchor: 8, head: 12 }
      ], 1)
    });

    await key(controller, ")");
    expect(controller.getState().selection.primaryIndex).toBe(2);
    await key(controller, ";");
    expect(controller.getState().selection.ranges).toEqual([
      expect.objectContaining({ anchor: 2, head: 2 }),
      expect.objectContaining({ anchor: 6, head: 6 }),
      expect.objectContaining({ anchor: 12, head: 12 })
    ]);
    await key(controller, ",");
    expect(controller.getState().selection.ranges).toHaveLength(1);
  });

  it("captures replacement operands and applies one undoable transaction", async () => {
    const controller = createEditorController({ value: "abc def", selection: createSelection(0, 2) });
    await key(controller, "r");
    await key(controller, "X");
    expect(controller.getState().doc.text).toBe("XXX def");
    await key(controller, "u");
    expect(controller.getState().doc.text).toBe("abc def");
  });

  it("opens a regex prompt and handles zero-width and invalid expressions safely", async () => {
    const controller = createEditorController({ value: "ab", selection: createSelection(0, 1) });
    await key(controller, "S");
    expect(controller.getPresentationState().ui.commandLine).toMatchObject({ active: true, value: "split-regex " });
    await controller.handleTextInput("(?=b)");
    await key(controller, "Enter");
    expect(controller.getState().selection.ranges).toHaveLength(2);

    controller.dispatch({ selection: createSelection(0, 1) });
    await key(controller, "S");
    await controller.handleTextInput("[");
    await key(controller, "Enter");
    expect(controller.getPresentationState().ui.bottomMessage).toMatchObject({ tone: "warning" });
  });

  it("uses the shared indent unit and formats every selection atomically", async () => {
    const formatter = vi.fn(async ({ selection }: { selection: { from: number; to: number } }) => [
      { from: selection.from, to: selection.to, insert: "X" }
    ]);
    const controller = createEditorController({
      value: "a\nb",
      selection: createSelectionSet([{ anchor: 0, head: 0 }, { anchor: 2, head: 2 }], 0)
    });
    await key(controller, ">");
    expect(controller.getState().doc.text).toBe("  a\n  b");
    await key(controller, "u");

    controller.setLanguageServices({ formatter: { format: formatter } });
    await key(controller, "=");
    expect(formatter).toHaveBeenCalledTimes(2);
    expect(controller.getState().doc.text).toBe("X\nX");
    await key(controller, "u");
    expect(controller.getState().doc.text).toBe("a\nb");
  });

  it("degrades formatting safely without a formatter", async () => {
    const controller = createEditorController({ value: "a" });
    const revision = controller.getState().revision;
    await key(controller, "=");
    expect(controller.getState().revision).toBe(revision);
    expect(controller.getState().doc.text).toBe("a");
  });
});
