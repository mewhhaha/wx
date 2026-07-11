import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createEditorController, KeymapConfigurationError } from "./index";
import { commandCatalogById } from "./command-catalog";
import { getCommandCompletionItems } from "./command-line";
import { defaultKeymap } from "./default-keymap";
import { createRuntimeCommandRegistry } from "./key-command-registry";
import { compileKeymap, parseKeySequence, resolveKeymap } from "./keymap-compiler";
import type { KeyRuntimeContext } from "./key-runtime-types";

describe("compiled keymap runtime", () => {
  it("rejects invalid and conflicting startup configurations with every issue", () => {
    let error: unknown;
    try { createEditorController({ keymap: { version: 1, bindings: [{ keys: "x", command: "missing.command", modes: ["normal"] }, { keys: "x", command: "motion.left", modes: ["normal"] }] } }); } catch (next) { error = next; }
    expect(error).toBeInstanceOf(KeymapConfigurationError);
    expect((error as KeymapConfigurationError).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["invalid-command", "duplicate"]));
    expect((error as Error).message).toContain("Invalid keymap configuration");
  });

  it("applies an explicit unbind/remap without mutating config and isolates controllers", async () => {
    const keymap = { version: 1 as const, unbind: [{ keys: "x", modes: ["normal" as const] }], bindings: [{ keys: "x", command: "mode.insert", modes: ["normal" as const] }] }; const snapshot = structuredClone(keymap);
    const remapped = createEditorController({ value: "abc", keymap }); const defaults = createEditorController({ value: "abc" });
    await remapped.handleKeyInput({ key: "x" }); await defaults.handleKeyInput({ key: "x" });
    expect(remapped.getState().mode).toBe("insert"); expect(defaults.getState().mode).toBe("normal"); expect(keymap).toEqual(snapshot);
  });

  it("resolves a two-child custom sequence and publishes deterministic pending help", async () => {
    const controller = createEditorController({ value: "abc", keymap: { version: 1, bindings: [{ keys: "q h", command: "motion.left", modes: ["normal"] }, { keys: "q l", command: "motion.right", modes: ["normal"] }] } });
    await controller.handleKeyInput({ key: "q" });
    expect(controller.getPresentationState().ui.commandCompletionItems.map((entry) => entry.label)).toEqual(["h", "l"]);
    await controller.handleKeyInput({ key: "l" });
    expect(controller.getState().selection.ranges[0]?.head).toBe(1); expect(controller.getPresentationState().ui.commandCompletionItems).toEqual([]);
  });

  it("accepts a single complete custom multi-key sequence", async () => {
    const controller = createEditorController({
      value: "abc",
      keymap: { version: 1, bindings: [{ keys: "q l", command: "motion.right", modes: ["normal"] }] }
    });
    await controller.handleKeyInput({ key: "q" });
    expect(controller.getPresentationState().ui.commandCompletionItems.map((entry) => entry.label)).toEqual(["l"]);
    await controller.handleKeyInput({ key: "l" });
    expect(controller.getState().selection.ranges[0]?.head).toBe(1);
  });

  it("captures catalog operands generically for find and registers", async () => {
    const controller = createEditorController({ value: "abca" });
    await controller.handleKeyInput({ key: "f" }); expect(controller.getPresentationState().ui.pendingAction).toMatchObject({ kind: "command-operand", command: "find.next-char", operands: [] });
    await controller.handleKeyInput({ key: "a" }); expect(controller.getState().selection.ranges[0]?.head).toBe(3);
    controller.setRegister("a", "Z"); await controller.handleKeyInput({ key: "i" }); await controller.handleKeyInput({ key: "r", ctrl: true }); expect(controller.getPresentationState().ui.pendingAction).toMatchObject({ kind: "command-operand", command: "register.insert" }); await controller.handleKeyInput({ key: "a" }); expect(controller.getState().doc.text).toContain("Z");
  });

  it("preserves the sticky-view overlay handoff and cancellation policy", async () => {
    const controller = createEditorController({ value: "one\ntwo\nthree\nfour" });
    await controller.handleKeyInput({ key: "Z" });
    expect(controller.getPresentationState().ui).toMatchObject({ stickyViewMode: true, pendingAction: { kind: "z", sticky: true } });
    await controller.handleKeyInput({ key: "j" });
    expect(controller.getPresentationState().ui).toMatchObject({ stickyViewMode: true, pendingAction: { kind: "z", sticky: true } });
    await controller.handleKeyInput({ key: "Escape" });
    expect(controller.getPresentationState().ui).toMatchObject({ stickyViewMode: false, pendingAction: { kind: "z", sticky: true } });
    await controller.handleKeyInput({ key: "j" });
    expect(controller.getPresentationState().ui).toMatchObject({ stickyViewMode: false, pendingAction: null });

    await controller.handleKeyInput({ key: "Z" });
    await controller.handleKeyInput({ key: "f", ctrl: true });
    expect(controller.getPresentationState().ui).toMatchObject({ stickyViewMode: true, pendingAction: null });
    expect((await controller.handleKeyInput({ key: "f", ctrl: true })).handled).toBe(true);
    await controller.handleKeyInput({ key: "i" });
    expect(controller.getState().mode).toBe("insert");
    expect((await controller.handleKeyInput({ key: "f", ctrl: true })).handled).toBe(true);
    expect(controller.getPresentationState().ui.stickyViewMode).toBe(true);
  });

  it("clears counts on question help like the legacy entrypoint", async () => {
    const controller = createEditorController();
    await controller.handleKeyInput({ key: "2" });
    expect(controller.getPresentationState().ui.pendingCount).toBe("2");
    await controller.handleKeyInput({ key: "?" });
    expect(controller.getPresentationState().ui.pendingCount).toBe("");
    expect(controller.getPresentationState().ui.commandCompletionItems.length).toBeGreaterThan(0);
  });

  it("keeps the active entrypoint free of legacy static dispatch imports", () => {
    const source = readFileSync(resolve(process.cwd(), "packages/editor-controller/src/key-input.ts"), "utf8");
    for (const legacy of ["key-direct", "key-prefix", "keymap", "key-picker"]) expect(source).not.toMatch(new RegExp(`from ["']\\./${legacy}["']`));
    expect(source).toContain("resolveContextKeymap"); expect(source).toContain("registry.dispatch");
  });

  it("registers every built-in and derives palette aliases from the catalog", () => {
    expect(() => createEditorController()).not.toThrow();
    const palette = getCommandCompletionItems({ active: true, prompt: ":", value: "" }).map((entry) => entry.label);
    for (const entry of commandCatalogById.values()) if (entry.palette) for (const label of [entry.id, ...(entry.aliases ?? [])]) expect(palette).toContain(label);
  });

  it("enforces catalog async metadata at handler registration", () => {
    const syncMarkedAsync = new Map(commandCatalogById);
    syncMarkedAsync.set("motion.left", { ...syncMarkedAsync.get("motion.left")!, async: true });
    expect(() => createRuntimeCommandRegistry({} as KeyRuntimeContext, syncMarkedAsync)).toThrow(/declared async/);

    const asyncMarkedSync = new Map(commandCatalogById);
    asyncMarkedSync.set("ui.hover", { ...asyncMarkedSync.get("ui.hover")!, async: false });
    expect(() => createRuntimeCommandRegistry({} as KeyRuntimeContext, asyncMarkedSync)).toThrow(/not declared async/);
  });

  it("dispatches a catalog palette alias through the same registry", async () => {
    const controller = createEditorController();
    await controller.handleKeyInput({ key: ":" });
    await controller.handleTextInput("search-backward");
    expect((await controller.handleKeyInput({ key: "Enter" })).handled).toBe(true);
    expect(controller.getPresentationState().ui.commandLine).toMatchObject({ active: true, prompt: "?" });
  });

  it("applies synchronous key side effects before returning the result promise", async () => {
    const motion = createEditorController({ value: "one\ntwo" });
    const motionResult = motion.handleKeyInput({ key: "j" });
    expect(motion.getState().doc.positionAt(motion.getState().selection.ranges[0]!.head).line).toBe(1);

    const insert = createEditorController({ value: "one" });
    const insertResult = insert.handleKeyInput({ key: "i" });
    expect(insert.getState().mode).toBe("insert");

    const prefix = createEditorController({ value: "one" });
    const prefixResult = prefix.handleKeyInput({ key: "g" });
    expect(prefix.getPresentationState().ui.pendingAction).toEqual({ kind: "g" });
    expect(prefix.getPresentationState().ui.commandCompletionItems.length).toBeGreaterThan(0);

    const flash = createEditorController({ value: "one" });
    const flashResult = flash.handleKeyInput({ key: " " });
    expect(flash.getPresentationState().ui.pendingAction).toEqual({ kind: "flash-target" });

    const commandLine = createEditorController({ value: "one" });
    const commandLineResult = commandLine.handleKeyInput({ key: ":" });
    expect(commandLine.getPresentationState().ui.commandLine).toMatchObject({ active: true, prompt: ":" });

    const operand = createEditorController({ value: "one" });
    const operandResult = operand.handleKeyInput({ key: "f" });
    expect(operand.getPresentationState().ui.pendingAction).toMatchObject({
      kind: "command-operand",
      command: "find.next-char",
      operands: []
    });

    await Promise.all([motionResult, insertResult, prefixResult, flashResult, commandLineResult, operandResult]);
  });

  it("resolves every independent inventory row to a registered handler", () => {
    type Inventory = { staticGroups: { context: string; modes: string[]; entries: [string, string, Record<string, unknown>?][] }[] };
    const inventory = JSON.parse(readFileSync(resolve(process.cwd(), "packages/editor-controller/testdata/legacy-keymap-inventory.json"), "utf8")) as Inventory;
    const compiled = compileKeymap(defaultKeymap);
    const registry = createRuntimeCommandRegistry({} as KeyRuntimeContext);
    for (const group of inventory.staticGroups) for (const mode of group.modes) for (const [keys, command] of group.entries) {
      const resolution = resolveKeymap(compiled.tries.get(`${group.context}:${mode}`), parseKeySequence(keys)!);
      expect(resolution).toMatchObject({ kind: "command", command });
      expect(registry.handlers.has(command), `${group.context}/${mode} ${keys} -> ${command}`).toBe(true);
    }
  });
});
