import { describe, expect, it, vi } from "vitest";

import { createSelection } from "@mewhhaha/wx-core";

import { createEditorController } from "./index";

const key = (controller: ReturnType<typeof createEditorController>, value: string, alt = false) =>
  controller.handleKeyInput({ key: value, alt, shift: value !== value.toLowerCase() });

describe("counted and language goto", () => {
  it("supports count-G and count-gg with clamping and visual extension", async () => {
    const controller = createEditorController({ value: "zero\none\ntwo\nthree", selection: createSelection(1) });
    await key(controller, "3");
    await key(controller, "G");
    expect(controller.getState().doc.positionAt(controller.getState().selection.ranges[0]!.head).line).toBe(2);

    await key(controller, "9");
    await key(controller, "g");
    await key(controller, "g");
    expect(controller.getState().doc.positionAt(controller.getState().selection.ranges[0]!.head).line).toBe(3);

    controller.dispatch({ selection: createSelection(5), mode: "visual" });
    await key(controller, "1");
    await key(controller, "G");
    expect(controller.getState().selection.ranges[0]).toMatchObject({ anchor: 5, head: 0 });
  });

  it("keeps uncounted G and gg endpoint behavior", async () => {
    const controller = createEditorController({ value: "zero\none\ntwo" });
    await key(controller, "G");
    expect(controller.getState().doc.positionAt(controller.getState().selection.ranges[0]!.head).line).toBe(2);
    await key(controller, "g");
    await key(controller, "g");
    expect(controller.getState().selection.ranges[0]!.head).toBe(0);
  });

  it.each([
    ["d", "definition"], ["D", "declaration"], ["y", "typeDefinition"], ["i", "implementation"], ["r", "references"]
  ] as const)("routes g%s to %s", async (chord, method) => {
    const request = vi.fn(async () => [{ from: 2, to: 3 }]);
    const controller = createEditorController({ value: "abcd" });
    controller.setLanguageServices({ goto: { [method]: request } });
    await key(controller, "g");
    await key(controller, chord);
    expect(request).toHaveBeenCalledOnce();
    expect(controller.getState().selection.ranges[0]).toMatchObject({ anchor: 2, head: 2 });
  });

  it("preserves Alt-g and Alt-G compatibility aliases", async () => {
    const definition = vi.fn(async () => [{ from: 1, to: 2 }]);
    const references = vi.fn(async () => [{ from: 2, to: 3 }]);
    const controller = createEditorController({ value: "abc" });
    controller.setLanguageServices({ goto: { definition, references } });
    await key(controller, "g", true);
    await key(controller, "G", true);
    expect(definition).toHaveBeenCalledOnce();
    expect(references).toHaveBeenCalledOnce();
  });

  it("round-trips exact cross-file targets through Ctrl-o and Ctrl-i", async () => {
    const controller = createEditorController({ value: "origin", filePath: "src/origin.ts", selection: createSelection(3) });
    controller.setHostServices({ async readFile({ filePath }) { return { text: filePath.endsWith("target.ts") ? "0123456789" : "origin" }; } });
    controller.setLanguageServices({ goto: { async definition() { return [{ filePath: "src/target.ts", from: 4, to: 7 }]; } } });

    await key(controller, "g");
    await key(controller, "d");
    expect(controller.getPresentationState().filePath).toBe("src/target.ts");
    expect(controller.getState().selection.ranges[0]).toMatchObject({ anchor: 4, head: 6 });

    await controller.handleKeyInput({ key: "o", ctrl: true });
    expect(controller.getPresentationState().filePath).toBe("src/origin.ts");
    expect(controller.getState().selection.ranges[0]!.head).toBe(3);
    await controller.handleKeyInput({ key: "i", ctrl: true });
    expect(controller.getPresentationState().filePath).toBe("src/target.ts");
    expect(controller.getState().selection.ranges[0]).toMatchObject({ anchor: 4, head: 6 });
  });

  it("does not record a jump when a cross-file target cannot be opened", async () => {
    const controller = createEditorController({ value: "origin", filePath: "src/origin.ts", selection: createSelection(3) });
    controller.setHostServices({ async readFile() { throw new Error("missing"); } });
    controller.setLanguageServices({ goto: { async definition() { return [{ filePath: "src/missing.ts", from: 0, to: 1 }]; } } });

    expect(await controller.gotoTarget("definition")).toBe(false);
    expect(controller.getJumpList()).toEqual([]);
    expect(controller.getPresentationState().filePath).toBe("src/origin.ts");
  });
});
