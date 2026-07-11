import { describe, expect, it, vi } from "vitest";

import { createSelection, createSelectionSet } from "@mewhhaha/wx-core";

import { createEditorController } from "./index";

const key = async (
  controller: ReturnType<typeof createEditorController>,
  value: string,
  options: Parameters<ReturnType<typeof createEditorController>["handleKeyInput"]>[1] = {}
) => controller.handleKeyInput({ key: value }, options);

const select = (
  controller: ReturnType<typeof createEditorController>,
  anchor: number,
  head = anchor
) => controller.dispatch({ selection: createSelection(anchor, head), mode: "normal" });

describe("semantic edit repeat", () => {
  it("adds register-shape metadata without changing string-valued presentation fields", () => {
    const controller = createEditorController();
    controller.setRegister("a", "line", "linewise");

    expect(controller.getRegister("a")).toBe("line");
    expect(controller.getRegisterKind("a")).toBe("linewise");
    expect(controller.getPresentationState().registers.named.a).toBe("line");
    expect(controller.getPresentationState().registers.namedKinds.a).toBe("linewise");
  });

  it("stores geometry-derived yank shape in a selected named register", async () => {
    const controller = createEditorController({ value: "one\ntwo", selection: createSelection(0, 3) });
    await key(controller, '"');
    await key(controller, "a");

    await key(controller, "y");

    expect(controller.getRegister("a")).toBe("one\n");
    expect(controller.getRegisterKind("a")).toBe("linewise");
  });

  it("replays insert at a new selection and keeps each replay in one undo group", async () => {
    const controller = createEditorController({ value: "one\ntwo" });
    await key(controller, "i");
    await controller.handleTextInput("X");
    await key(controller, "Escape");
    expect(controller.getState().doc.text).toBe("Xone\ntwo");

    select(controller, 5);
    await key(controller, ".");
    expect(controller.getState().doc.text).toBe("Xone\nXtwo");
    await key(controller, "u");
    expect(controller.getState().doc.text).toBe("Xone\ntwo");
    expect(controller.getPresentationState().ui.lastRepeatableEdit).toMatchObject({
      kind: "insert",
      entry: "insert",
      text: "X"
    });
  });

  it.each([
    ["I", "insert-line-start", "  one\n  two", 2, 8, "  Xone\n  Xtwo"],
    ["A", "append-line-end", "one\ntwo", 0, 4, "oneX\ntwoX"]
  ] as const)("captures and repeats %s semantics", async (entryKey, entry, value, first, second, expected) => {
    const controller = createEditorController({ value, selection: createSelection(first) });
    await key(controller, entryKey);
    await controller.handleTextInput("X");
    await key(controller, "Escape");
    select(controller, second + 1);

    await key(controller, ".");

    expect(controller.getState().doc.text).toBe(expected);
    expect(controller.getPresentationState().ui.lastRepeatableEdit).toMatchObject({ kind: "insert", entry, text: "X" });
  });

  it("replays change against the new selection", async () => {
    const controller = createEditorController({ value: "cat dog", selection: createSelection(0, 2) });
    await key(controller, "c");
    await controller.handleTextInput("fox");
    await key(controller, "Escape");
    select(controller, 4, 6);

    await key(controller, ".");

    expect(controller.getState().doc.text).toBe("fox fox");
    await key(controller, "u");
    expect(controller.getState().doc.text).toBe("fox dog");
  });

  it("replays open-line insertion without recording input events", async () => {
    const controller = createEditorController({ value: "one\ntwo" });
    await key(controller, "o");
    await controller.handleTextInput("x");
    await key(controller, "Escape");
    select(controller, controller.getState().doc.text.indexOf("two"));

    await key(controller, ".");

    expect(controller.getState().doc.text).toBe("one\nx\ntwo\nx");
    expect(controller.getPresentationState().ui.lastRepeatableEdit).toMatchObject({
      kind: "insert",
      entry: "open-below",
      text: "x"
    });
  });

  it("preserves named-register shape for P and repeats captured paste content", async () => {
    const controller = createEditorController({ value: "one\ntwo", selection: createSelection(5) });
    controller.setRegister("a", "X", "linewise");
    await key(controller, '"');
    await key(controller, "a");
    await key(controller, "P");
    expect(controller.getState().doc.text).toBe("one\nX\ntwo");

    controller.setRegister("a", "changed", "characterwise");
    select(controller, controller.getState().doc.text.indexOf("two"));
    await key(controller, ".");

    expect(controller.getState().doc.text).toBe("one\nX\nX\ntwo");
    expect(controller.getPresentationState().ui.lastRepeatableEdit).toMatchObject({
      kind: "paste",
      position: "before",
      text: "X",
      registerKind: "linewise"
    });
  });

  it("infers clipboard line shape once and dot repeat does not read the clipboard again", async () => {
    const controller = createEditorController({ value: "one\ntwo", selection: createSelection(5) });
    const readClipboardText = vi.fn(async () => "C\n");
    await key(controller, '"');
    await key(controller, "+");
    await key(controller, "P", { readClipboardText });
    select(controller, controller.getState().doc.text.indexOf("two"));

    await key(controller, ".");

    expect(readClipboardText).toHaveBeenCalledTimes(1);
    expect(controller.getState().doc.text).toBe("one\nC\nC\ntwo");
  });

  it("applies counted paste as one transaction and repeats the captured count", async () => {
    const controller = createEditorController({ value: "ab", selection: createSelection(0) });
    controller.setRegister("a", "X", "characterwise");
    await key(controller, "2");
    await key(controller, '"');
    await key(controller, "a");
    await key(controller, "p");
    expect(controller.getState().doc.text).toBe("aXXb");
    await key(controller, "u");
    expect(controller.getState().doc.text).toBe("ab");
    await key(controller, "U");
    select(controller, 3);

    await key(controller, ".");

    expect(controller.getState().doc.text).toBe("aXXbXX");
    await key(controller, "u");
    expect(controller.getState().doc.text).toBe("aXXb");
  });

  it("uses a dot prefix as a replay multiplier with one undo group per iteration", async () => {
    const controller = createEditorController({ value: "ab", selection: createSelection(0) });
    controller.setRegister("a", "X", "characterwise");
    await key(controller, '"');
    await key(controller, "a");
    await key(controller, "p");
    select(controller, 2);
    await key(controller, "2");

    await key(controller, ".");

    expect(controller.getState().doc.text).toBe("aXbXX");
    await key(controller, "u");
    expect(controller.getState().doc.text).toBe("aXbX");
    await key(controller, "u");
    expect(controller.getState().doc.text).toBe("aXb");
  });

  it("deduplicates overlapping insertion points and preserves the primary selection", async () => {
    const controller = createEditorController({ value: "ab\ncd" });
    controller.dispatch({
      selection: createSelectionSet(
        [
          { anchor: 0, head: 1, preferredColumn: null },
          { anchor: 1, head: 0, preferredColumn: null },
          { anchor: 3, head: 3, preferredColumn: null }
        ],
        2
      )
    });
    await key(controller, "i");
    await controller.handleTextInput("X");
    await key(controller, "Escape");
    expect(controller.getState().doc.text).toBe("Xab\nXcd");
    expect(controller.getState().selection.primaryIndex).toBe(1);

    controller.dispatch({
      selection: createSelectionSet(
        [
          { anchor: 1, head: 1, preferredColumn: null },
          { anchor: 5, head: 5, preferredColumn: null }
        ],
        1
      )
    });
    await key(controller, ".");
    expect(controller.getState().doc.text).toBe("XXab\nXXcd");
    expect(controller.getState().selection.primaryIndex).toBe(1);
  });

  it("retains the last completed recipe after an unsafe moved insert and undo", async () => {
    const controller = createEditorController({ value: "abc" });
    await key(controller, "i");
    await controller.handleTextInput("X");
    await key(controller, "Escape");
    const completed = controller.getPresentationState().ui.lastRepeatableEdit;

    select(controller, 1);
    await key(controller, "i");
    await key(controller, "ArrowRight");
    await controller.handleTextInput("Y");
    await key(controller, "Escape");
    expect(controller.getPresentationState().ui.lastRepeatableEdit).toEqual(completed);
    await key(controller, "u");
    expect(controller.getPresentationState().ui.lastRepeatableEdit).toEqual(completed);
  });

  it("retains a completed recipe across buffers and cancels the in-flight capture", async () => {
    const controller = createEditorController({ value: "abc" });
    await key(controller, "i");
    await controller.handleTextInput("X");
    await key(controller, "Escape");
    const completed = controller.getPresentationState().ui.lastRepeatableEdit;
    await key(controller, "i");
    await controller.handleTextInput("Y");

    expect(controller.newScratchBuffer()).toBe(true);
    await key(controller, "Escape");
    expect(controller.getPresentationState().ui.lastRepeatableEdit).toEqual(completed);
    await key(controller, ".");
    expect(controller.getState().doc.text).toBe("X");
  });

  it("does not replace the completed recipe when an async clipboard paste fails", async () => {
    const controller = createEditorController({ value: "abc" });
    await key(controller, "i");
    await controller.handleTextInput("X");
    await key(controller, "Escape");
    const completed = controller.getPresentationState().ui.lastRepeatableEdit;
    await key(controller, '"');
    await key(controller, "+");

    await expect(key(controller, "P", { readClipboardText: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(controller.getPresentationState().ui.lastRepeatableEdit).toEqual(completed);
    expect(controller.getSelectedRegister()).toBeNull();
    expect(controller.getState().doc.text).toBe("Xabc");
  });
});
