import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commandCatalogById, completeCommandCatalog, type CommandMetadata } from "./command-catalog";
import { defaultKeymap } from "./default-keymap";
import { renderCommandKeyGolden, renderCommandKeyReference } from "./command-key-reference";
import { compileKeymap, contextAfterInput, eventToContextKeyStroke, getKeymapHelp, parseKeySequence, parseKeyStroke, resolveContextKeymap, resolveKeymap } from "./keymap-compiler";
import { eventToKeyStroke } from "./keymap-compiler";
import { decodeKeymapConfig } from "./keymap-schema";

const issues = (config: Parameters<typeof compileKeymap>[1], defaults: readonly import("./keymap-schema").KeymapBinding[] = [], catalog = commandCatalogById) => compileKeymap(defaults, config, catalog).issues.map((entry) => entry.code);
describe("keymap compiler", () => {
  it("keeps generated golden and reference documentation byte-for-byte current", () => {
    expect(readFileSync(resolve(process.cwd(), "packages/editor-controller/testdata/keymap-v1-default.golden.json"), "utf8")).toBe(renderCommandKeyGolden());
    expect(readFileSync(resolve(process.cwd(), "docs/command-key-reference.md"), "utf8")).toBe(renderCommandKeyReference());
  });
  it("canonicalizes browser/Deno strokes without lowercasing printable scalars", () => {
    expect(parseKeyStroke("Alt+Ctrl+w")).toBe("Ctrl+Alt+w");
    expect(parseKeyStroke("+")).toBe("+");
    expect(parseKeyStroke("Ctrl++")).toBe("Ctrl++");
    expect(parseKeyStroke("Alt+Ctrl++")).toBe("Ctrl+Alt++");
    for (const malformed of ["Ctrl+", "++", "Ctrl+++", "+Ctrl", "Ctrl+Alt+"]) expect(parseKeyStroke(malformed)).toBeNull();
    expect(parseKeySequence("Space Ctrl+w Shift+Tab ArrowLeft Ż")).toEqual(["Space", "Ctrl+w", "Shift+Tab", "ArrowLeft", "Ż"]);
    expect(parseKeySequence("Shift+Space Ctrl+Shift+Space Ctrl+Shift+W Alt+Shift+g")).toEqual(["Space", "Ctrl+Space", "Ctrl+W", "Alt+G"]);
    expect(parseKeyStroke("ctrl+w")).toBeNull();
    const event = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers } as KeyboardEvent);
    expect(eventToKeyStroke(event("G", { altKey: true, shiftKey: true }))).toBe("Alt+G");
    expect(eventToKeyStroke(event(" "))).toBe("Space");
    expect(eventToKeyStroke(event(" ", { ctrlKey: true }))).toBe("Ctrl+Space");
    expect(eventToKeyStroke(event("%", { shiftKey: true }))).toBe("%");
    expect(eventToKeyStroke(event("W", { shiftKey: true }))).toBe("W");
    expect(eventToKeyStroke(event("?", { shiftKey: true }))).toBe("?");
    expect(eventToKeyStroke(event("W", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+W");
    expect(eventToKeyStroke(event(" ", { shiftKey: true }))).toBe("Space");
    expect(eventToKeyStroke(event(" ", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Space");
    expect(eventToKeyStroke(event("G", { altKey: true }))).toBe("Alt+g");
    expect(eventToKeyStroke(event("g", { altKey: true, shiftKey: true }))).toBe("Alt+G");
    const trie = compileKeymap(defaultKeymap).tries.get("editor:normal");
    for (const [input, command] of [[event(" ", { shiftKey: true }), "jump.flash"], [event(" ", { ctrlKey: true, shiftKey: true }), "ui.completion"], [event("%", { shiftKey: true }), "edit.select-all"], [event("W", { shiftKey: true }), "motion.W-start"], [event("?", { shiftKey: true }), "prefix.question"], [event("G", { altKey: true }), "goto.definition"], [event("g", { altKey: true, shiftKey: true }), "goto.references"], [event("K", { altKey: true, shiftKey: true }), "ui.hover"], [event("R", { altKey: true, shiftKey: true }), "ui.rename"]] as const) expect(resolveKeymap(trie, [eventToKeyStroke(input)!])).toMatchObject({ kind: "command", command });
    expect(resolveKeymap(trie, [eventToKeyStroke(event("P", { ctrlKey: true, shiftKey: true }))!])).toEqual({ kind: "cancelled" });
    expect(resolveKeymap(trie, [eventToKeyStroke(event("W", { ctrlKey: true, shiftKey: true }))!])).toEqual({ kind: "cancelled" });
    expect(resolveKeymap(trie, [eventToKeyStroke(event("p", { ctrlKey: true }))!])).toMatchObject({ kind: "command", command: "ui.file-picker" });
    expect(resolveKeymap(trie, [eventToKeyStroke(event("w", { ctrlKey: true }))!])).toMatchObject({ kind: "command", command: "prefix.ctrl-w" });
    for (const [dom, ansi, command] of [[event("G", { altKey: true, shiftKey: true }), "Alt+Shift+g", "goto.references"], [event("g", { altKey: true }), "Alt+g", "goto.definition"]] as const) {
      expect(resolveKeymap(trie, [eventToKeyStroke(dom)!])).toMatchObject({ kind: "command", command });
      expect(resolveKeymap(trie, [parseKeyStroke(ansi)!])).toMatchObject({ kind: "command", command });
    }
    const plus = compileKeymap([{ keys: "+", command: "motion.left", modes: ["normal"] }, { keys: "Ctrl++", command: "motion.right", modes: ["normal"] }, { keys: "Alt++", command: "motion.up", modes: ["normal"] }]);
    expect(parseKeyStroke("Alt++")).toBe("Alt++");
    expect(resolveKeymap(plus.tries.get("editor:normal"), [eventToKeyStroke(event("+"))!])).toMatchObject({ kind: "command", command: "motion.left" });
    expect(eventToKeyStroke(event("+", { ctrlKey: true }))).toBe("Ctrl++");
    expect(resolveKeymap(plus.tries.get("editor:normal"), [eventToKeyStroke(event("+", { ctrlKey: true }))!])).toMatchObject({ kind: "command", command: "motion.right" });
    expect(resolveKeymap(plus.tries.get("editor:normal"), [parseKeyStroke("Ctrl++")!])).toMatchObject({ kind: "command", command: "motion.right" });
    expect(resolveKeymap(plus.tries.get("editor:normal"), [eventToKeyStroke(event("+", { altKey: true }))!])).toMatchObject({ kind: "command", command: "motion.up" });
    const ctrlW = compileKeymap(defaultKeymap).tries.get("ctrl-w:normal");
    for (const [dom, ansi, command] of [[event("F", { ctrlKey: true, shiftKey: true }), "Ctrl+F", "workspace.open-selection-vertical"], [event("f", { ctrlKey: true }), "Ctrl+f", "workspace.open-selection-horizontal"], [event("H", { shiftKey: true }), "H", "workspace.swap-left"], [event("h"), "h", "workspace.focus-left"]] as const) {
      expect(resolveKeymap(ctrlW, [eventToKeyStroke(dom)!])).toMatchObject({ kind: "command", command });
      expect(resolveKeymap(ctrlW, [parseKeyStroke(ansi)!])).toMatchObject({ kind: "command", command });
    }
  });
  it("decodes hostile JSON without throwing and compiles aliases to canonical IDs", () => {
    const decoded = decodeKeymapConfig({ version: 2, bindings: [{ keys: 4, command: true }, { keys: "x", command: "rename", modes: ["wat"] }], unbind: "no" });
    expect(decoded.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["unsupported-version", "invalid-config"]));
    expect(() => compileKeymap([], { bindings: "nope" } as unknown)).not.toThrow();
    const compiled = compileKeymap([], { version: 1, bindings: [{ keys: "x", command: "rename", modes: ["normal"] }] });
    expect(resolveKeymap(compiled.tries.get("editor:normal"), ["x"])).toEqual({ kind: "command", command: "ui.rename" });
  });
  it("matches the complete normalized legacy inventory exactly, including active UI contexts", () => {
    const compiled = compileKeymap(defaultKeymap, { version: 1 });
    type Oracle = { sources: string[]; contextPolicies: unknown[]; staticGroups: { context: string; modes: string[]; entries: [string, string, Record<string, unknown>?][] }[]; dynamicGrammar: { id: string; source: string; reason: string }[]; shadowedBranches: { context: string; keys: string; command: string; shadowedBy: string; source: string }[]; metadata: { count: string[]; repeat: string[] } };
    const inventoryText = readFileSync(resolve(process.cwd(), "packages/editor-controller/testdata/legacy-keymap-inventory.json"), "utf8");
    const inventory = JSON.parse(inventoryText) as Oracle;
    expect(inventory.sources).toEqual(["src/key-input.ts", "src/key-direct.ts", "src/key-prefix.ts", "src/key-picker.ts", "src/key-flash.ts", "src/keymap.ts", "src/commands.ts"]);
    expect(inventoryText).not.toBe(readFileSync(resolve(process.cwd(), "packages/editor-controller/testdata/keymap-v1-default.golden.json"), "utf8"));
    const expected = inventory.staticGroups.flatMap((group) => group.modes.flatMap((mode) => group.entries.map(([keys, command, args]) => JSON.stringify({ context: group.context, mode, keys, command, ...(args ? { args } : {}) })))).sort();
    const actual = compiled.bindings.map((entry) => JSON.stringify({ context: entry.context, mode: entry.mode, keys: entry.keys.join(" "), command: entry.command, ...(entry.args ? { args: entry.args } : {}) })).sort();
    expect(actual).toEqual(expected);
    expect(actual.join("\n")).toContain(JSON.stringify({ context: "completion", mode: "normal", keys: "ArrowDown", command: "completion.next" }));
    expect(actual.join("\n")).toContain(JSON.stringify({ context: "completion", mode: "insert", keys: "Tab", command: "completion.next" }));
    expect(actual.join("\n")).toContain(JSON.stringify({ context: "picker", mode: "normal", keys: "Enter", command: "picker.accept" }));
    expect(actual.join("\n")).toContain(JSON.stringify({ context: "picker", mode: "insert", keys: "Backspace", command: "picker.delete-backward" }));
    expect(actual.join("\n")).toContain(JSON.stringify({ context: "hover", mode: "normal", keys: "Escape", command: "hover.dismiss" }));
    expect(inventory.dynamicGrammar.map((entry) => entry.id)).toEqual(["counts", "insert-text", "flash-operands", "picker-query", "picker-numeric-acceptance", "modal-cancellation", "register-capture", "operator-capture", "command-line-input"]);
    expect(inventory.dynamicGrammar.every((entry) => inventory.sources.includes(entry.source))).toBe(true);
    expect(inventory.dynamicGrammar.find((entry) => entry.id === "modal-cancellation")?.reason).toContain("retains its fallback prefix");
    expect(inventory.shadowedBranches).toEqual([{ context: "goto", keys: "c", command: "goto.window-center", shadowedBy: "comment.toggle", source: "src/keymap.ts" }]);
    expect(JSON.parse(JSON.stringify(compiled.contextPolicies))).toEqual(inventory.contextPolicies);
  });
  it("applies serializable raw-key policies for modal contexts", () => {
    const compiled = compileKeymap(defaultKeymap);
    const event = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers } as KeyboardEvent);
    const resolveEvent = (context: Parameters<typeof eventToContextKeyStroke>[0], mode: string, input: KeyboardEvent) => resolveKeymap(compiled.tries.get(`${context}:${mode}`), [eventToContextKeyStroke(context, input, compiled.contextPolicies)!]);
    expect(resolveEvent("completion", "insert", event("ArrowDown", { ctrlKey: true }))).toMatchObject({ kind: "command", command: "completion.next" });
    expect(resolveEvent("completion", "insert", event("Tab", { ctrlKey: true, shiftKey: true }))).toMatchObject({ kind: "command", command: "completion.previous" });
    expect(resolveEvent("picker", "normal", event("Backspace", { ctrlKey: true }))).toMatchObject({ kind: "command", command: "picker.delete-backward" });
    expect(resolveEvent("hover", "normal", event("Escape", { ctrlKey: true }))).toMatchObject({ kind: "command", command: "hover.dismiss" });
    expect(resolveEvent("goto", "normal", event("n", { ctrlKey: true }))).toMatchObject({ kind: "command", command: "workspace.next-buffer" });
  });
  it("separates the modifier-insensitive Z prefix from persistent sticky view", () => {
    const compiled = compileKeymap(defaultKeymap); const event = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers } as KeyboardEvent);
    const prefixPolicy = compiled.contextPolicies.find((entry) => entry.context === "sticky-view-prefix"); const overlayPolicy = compiled.contextPolicies.find((entry) => entry.context === "sticky-view-overlay");
    expect(prefixPolicy).toEqual({ context: "sticky-view-prefix", modifiers: "ignore", unmatched: "consume", afterInput: { kind: "sticky-state", whenActive: "sticky-view", whenInactive: "editor" } });
    expect(overlayPolicy).toMatchObject({ unmatched: "delegate", overlay: { fallbackContext: "sticky-view-prefix", retainFallbackOnMatch: true } });
    const probe = (key: string, modifiers: Partial<KeyboardEvent> = {}) => {
      const resolved = resolveContextKeymap(compiled, "sticky-view-overlay", "normal", event(key, modifiers)); const overlayMatch = resolved.context === "sticky-view-overlay" && resolved.resolution.kind === "command"; const stickyAfter = overlayMatch && resolved.resolution.command === "view.exit-sticky" ? false : true; const retainsPending = overlayMatch && overlayPolicy?.overlay?.retainFallbackOnMatch === true; const nextContext = retainsPending ? stickyAfter ? "sticky-view-overlay" : overlayPolicy?.overlay?.fallbackContext : contextAfterInput(resolved.policy, { sticky: stickyAfter });
      return { context: resolved.context, resolution: resolved.resolution, stickyAfter, retainsPending, nextContext };
    };
    for (const input of [event("Escape"), event("Escape", { ctrlKey: true })]) expect(probe(input.key, input)).toMatchObject({ context: "sticky-view-overlay", resolution: { kind: "command", command: "view.exit-sticky" }, stickyAfter: false, retainsPending: true, nextContext: "sticky-view-prefix" });
    expect(probe("j")).toMatchObject({ context: "sticky-view-overlay", resolution: { kind: "command", command: "view.scroll-down" }, stickyAfter: true, retainsPending: true, nextContext: "sticky-view-overlay" });
    expect(probe("ArrowDown", { altKey: true })).toMatchObject({ context: "sticky-view-overlay", resolution: { kind: "command", command: "view.scroll-down" }, stickyAfter: true, retainsPending: true, nextContext: "sticky-view-overlay" });
    expect(probe("b", { ctrlKey: true })).toMatchObject({ context: "sticky-view-prefix", resolution: { kind: "command", command: "view.bottom", args: { alignment: "bottom", sticky: true } }, stickyAfter: true, retainsPending: false, nextContext: "sticky-view" });
    for (const key of ["f", "u", "d"]) expect(probe(key, { ctrlKey: true })).toMatchObject({ context: "sticky-view-prefix", resolution: { kind: "cancelled" }, stickyAfter: true, retainsPending: false, nextContext: "sticky-view" });
    const afterEscape = resolveContextKeymap(compiled, "sticky-view-prefix", "normal", event("j", { ctrlKey: true }));
    expect(afterEscape).toMatchObject({ context: "sticky-view-prefix", resolution: { kind: "command", command: "view.scroll-down" } });
    expect(contextAfterInput(afterEscape.policy, { sticky: false })).toBe("editor");
    expect(resolveContextKeymap(compiled, "sticky-view", "normal", event("f", { ctrlKey: true })).resolution).toMatchObject({ kind: "command", command: "view.page-down" });
    expect(resolveContextKeymap(compiled, "sticky-view", "normal", event("Escape", { ctrlKey: true })).resolution).toMatchObject({ kind: "command", command: "view.exit-sticky" });
  });
  it("projects ctrl-w modifiers like the legacy prefix while preserving Ctrl and raw case", () => {
    const compiled = compileKeymap(defaultKeymap); const event = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers } as KeyboardEvent);
    for (const [input, stroke, command] of [[event("v", { altKey: true }), "v", "workspace.split-vertical"], [event("v", { metaKey: true }), "v", "workspace.split-vertical"], [event("v", { ctrlKey: true, altKey: true }), "Ctrl+v", "workspace.split-vertical"], [event("H", { altKey: true, shiftKey: true }), "H", "workspace.swap-left"], [event("ArrowLeft", { altKey: true }), "ArrowLeft", "workspace.focus-left"]] as const) {
      const resolved = resolveContextKeymap(compiled, "ctrl-w", "normal", input); expect(resolved.stroke).toBe(stroke); expect(resolved.resolution).toMatchObject({ kind: "command", command });
    }
    expect(resolveContextKeymap(compiled, "ctrl-w", "normal", event("h", { altKey: true })).resolution).toMatchObject({ kind: "command", command: "workspace.focus-left" });
    const arrows = [["ArrowLeft", "workspace.focus-left"], ["ArrowRight", "workspace.focus-right"], ["ArrowUp", "workspace.focus-up"], ["ArrowDown", "workspace.focus-down"]] as const;
    const modifierCases = [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true, altKey: true, metaKey: true, shiftKey: true }] as const;
    for (const [key, command] of arrows) for (const modifiers of modifierCases) { const resolved = resolveContextKeymap(compiled, "ctrl-w", "normal", event(key, modifiers)); expect(resolved.stroke).toBe(key); expect(resolved.resolution).toMatchObject({ kind: "command", command }); }
    expect(resolveContextKeymap(compiled, "ctrl-w", "normal", event("x", { altKey: true })).resolution).toEqual({ kind: "cancelled" });
  });
  it("remaps only after an explicit unbind", () => {
    const defaults = [{ keys: "x", command: "motion.left", modes: ["normal"] as const }];
    expect(issues({ version: 1, bindings: [{ keys: "x", command: "motion.right", modes: ["normal"] }] }, defaults)).toContain("duplicate");
    const compiled = compileKeymap(defaults, { version: 1, unbind: [{ keys: "x", modes: ["normal"] }], bindings: [{ keys: "x", command: "motion.right", modes: ["normal"] }] });
    expect(resolveKeymap(compiled.tries.get("editor:normal"), ["x"])).toEqual({ kind: "command", command: "motion.right" });
  });
  it("prunes a removed leaf and supports explicit subtree replacement without harming siblings", () => {
    const defaults = [{ keys: "g h", command: "goto.line-start", modes: ["normal"] as const }, { keys: "g l", command: "goto.line-end", modes: ["normal"] as const }];
    const leaf = compileKeymap(defaults, { version: 1, unbind: [{ keys: "g h", modes: ["normal"] }] });
    expect(resolveKeymap(leaf.tries.get("editor:normal"), ["g", "l"])).toEqual({ kind: "command", command: "goto.line-end" });
    const replaced = compileKeymap(defaults, { version: 1, unbind: [{ keys: "g", modes: ["normal"], subtree: true }], bindings: [{ keys: "g", command: "motion.left", modes: ["normal"] }] });
    expect(resolveKeymap(replaced.tries.get("editor:normal"), ["g"])).toEqual({ kind: "command", command: "motion.left" });
  });
  it("resolves multi-key bindings and reports deterministic help", () => {
    const compiled = compileKeymap([{ context: "goto", keys: "z", command: "goto.file-start", modes: ["normal"] }, { context: "goto", keys: "h", command: "goto.line-start", modes: ["normal"] }], { version: 1 });
    const trie = compiled.tries.get("goto:normal");
    expect(resolveKeymap(trie, ["z"])).toEqual({ kind: "command", command: "goto.file-start" });
    expect(resolveKeymap(trie, ["x"])).toEqual({ kind: "cancelled" });
    expect(getKeymapHelp(trie)).toEqual([{ keys: ["h"], command: "goto.line-start", description: "Go to line start" }, { keys: ["z"], command: "goto.file-start", description: "Go to file start" }]);
  });
  it("validates invalid IDs, duplicates, both shadowing directions and mode/operand constraints", () => {
    expect(issues({ version: 1, bindings: [{ keys: "x", command: "nope", modes: ["normal"] }] })).toContain("invalid-command");
    expect(issues({ version: 1, bindings: [{ keys: "x", command: "motion.left", modes: ["normal"] }, { keys: "x", command: "motion.right", modes: ["normal"] }] })).toContain("duplicate");
    expect(issues({ version: 1, bindings: [{ keys: "g", command: "motion.left", modes: ["normal"] }, { keys: "g h", command: "motion.right", modes: ["normal"] }] })).toContain("shadowed-prefix");
    expect(issues({ version: 1, bindings: [{ keys: "g h", command: "motion.right", modes: ["normal"] }, { keys: "g", command: "motion.left", modes: ["normal"] }] })).toContain("shadowed-leaf");
    expect(issues({ version: 1, bindings: [{ keys: "x", command: "mode.insert", modes: ["insert"] }, { keys: "f", command: "find.next-char", modes: ["normal"] }, { keys: "f x", command: "motion.left", modes: ["normal"] }] })).toEqual(expect.arrayContaining(["unreachable-mode", "after-operand"]));
  });
  it("does not mistake a valid one-leaf root for an incomplete prefix and detects catalog alias collisions", () => {
    expect(issues({ version: 1, bindings: [{ keys: "h", command: "motion.left", modes: ["normal"] }] })).not.toContain("incomplete-prefix");
    const colliding = new Map<string, CommandMetadata>([...commandCatalogById, ["test.alias-one", { id: "test.alias-one", description: "a", modes: ["normal"], aliases: ["same"] }], ["test.alias-two", { id: "test.alias-two", description: "b", modes: ["normal"], aliases: ["same"] }]]);
    expect(issues({ version: 1 }, [], colliding)).toContain("alias-collision");
  });
  it("publishes deeply immutable default registry inputs", () => {
    expect(Object.isFrozen(defaultKeymap)).toBe(true);
    expect(Object.isFrozen(defaultKeymap[0])).toBe(true);
    expect(Object.isFrozen(defaultKeymap[0]?.modes)).toBe(true);
    expect(Object.isFrozen(completeCommandCatalog)).toBe(true);
    expect(Object.isFrozen(completeCommandCatalog[0])).toBe(true);
    expect(Object.isFrozen(completeCommandCatalog[0]?.availability)).toBe(true);
    expect((commandCatalogById as unknown as { set?: unknown }).set).toBeUndefined();
    expect(() => { (defaultKeymap[0] as { command: string }).command = "missing.command"; }).toThrow(TypeError);
    expect(() => { (completeCommandCatalog[0] as { description: string }).description = "poisoned"; }).toThrow(TypeError);
    expect(compileKeymap(defaultKeymap).issues).toEqual([]);
  });
  it("rejects malformed key arrays, unbind records, contexts, modes, and non-primitive args without throwing", () => {
    const hostile = { version: 1, bindings: [{ keys: [1], command: "motion.left" }, { keys: ["x"], command: "motion.left", context: "wat" }, { keys: "x", command: "motion.left", modes: ["wat"] }, { keys: "x", command: "motion.left", args: { nested: {} } }], unbind: [{ keys: [1], modes: ["wat"], context: "wat", subtree: "yes" }] };
    expect(() => compileKeymap([], hostile)).not.toThrow();
    expect(decodeKeymapConfig(hostile).issues.filter((issue) => issue.code === "invalid-config")).toHaveLength(5);
    expect(() => compileKeymap([], JSON.parse("{\"bindings\":[{\"keys\":[1]}]}"))).not.toThrow();
  });
  it("enforces per-command argument contracts and returns immutable argument copies", () => {
    expect(issues({ version: 1, bindings: [{ keys: "a", command: "textobject.select", context: "match", modes: ["normal"] }] })).toContain("invalid-args");
    expect(issues({ version: 1, bindings: [{ keys: "a", command: "textobject.select", context: "match", modes: ["normal"], args: { scope: "inside", extra: true } }] })).toContain("invalid-args");
    const compiled = compileKeymap([], { version: 1, bindings: [{ keys: "a", command: "textobject.select", context: "match", modes: ["normal"], args: { scope: "inside" } }] });
    const result = resolveKeymap(compiled.tries.get("match:normal"), ["a"]);
    expect(result).toEqual({ kind: "command", command: "textobject.select", args: { scope: "inside" } });
    if (result.kind === "command" && result.args) expect(Object.isFrozen(result.args)).toBe(true);
    const malformed = [
      { keys: "a", command: "textobject.select", context: "match", args: { scope: "sideways" } },
      { keys: "f", command: "syntax.next", context: "bracket-next", args: { target: "Z" } },
      { keys: "d", command: "diagnostic.next", context: "bracket-next", args: { extreme: "false" } },
      { keys: "p", command: "goto.next-paragraph", context: "bracket-next", args: { direction: "previous" } },
      { keys: "z", command: "view.center", context: "view", args: { alignment: "top", sticky: false } },
      { keys: "h", command: "picker.previous", context: "picker", args: { variant: "modal" } }
    ];
    for (const binding of malformed) expect(issues({ version: 1, bindings: [{ ...binding, modes: ["normal"] }] })).toContain("invalid-args");
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(decodeKeymapConfig({ version: 1, bindings: [{ keys: "x", command: "motion.left", args: { value } }] }).issues.map((issue) => issue.code)).toContain("invalid-config");
  });
  it("models context/mode pairs and accepts complete one-branch multi-key sequences", () => {
    expect(issues({ version: 1, bindings: [{ keys: "j", command: "motion.down", context: "goto", modes: ["insert"] }] })).toContain("unreachable-mode");
    expect(issues({ version: 1, bindings: [{ keys: "f", command: "syntax.next", context: "bracket-prev", modes: ["normal"], args: { target: "f" } }] })).toContain("unreachable-context");
    expect(issues({ version: 1, bindings: [{ keys: "q h", command: "goto.line-start", modes: ["normal"] }] })).not.toContain("incomplete-prefix");
    const afterUnbind = compileKeymap([{ keys: "g h", command: "goto.line-start", modes: ["normal"] }, { keys: "g l", command: "goto.line-end", modes: ["normal"] }], { version: 1, unbind: [{ keys: "g h", modes: ["normal"] }] });
    expect(afterUnbind.issues).toEqual([]);
    expect(resolveKeymap(afterUnbind.tries.get("editor:normal"), ["g", "l"])).toMatchObject({ kind: "command", command: "goto.line-end" });
  });
  it("applies shorthand unbinds to every matching mode but reports a wholly missing target", () => {
    const compiled = compileKeymap(defaultKeymap, { version: 1, unbind: ["Space"] });
    expect(compiled.issues).toEqual([]);
    expect(resolveKeymap(compiled.tries.get("editor:normal"), ["Space"])).toEqual({ kind: "cancelled" });
    expect(resolveKeymap(compiled.tries.get("editor:visual"), ["Space"])).toEqual({ kind: "cancelled" });
    expect(issues({ version: 1, unbind: ["F2"] }, [])).toContain("missing-unbind");
  });
  it("matches the exact count/repeat oracle derived from counted and recorded legacy paths", () => {
    const inventory = JSON.parse(readFileSync(resolve(process.cwd(), "packages/editor-controller/testdata/legacy-keymap-inventory.json"), "utf8")) as { metadata: { count: string[]; repeat: string[] } };
    const flagged = (field: "count" | "repeat") => completeCommandCatalog.filter((entry) => entry[field]).map((entry) => entry.id).sort();
    expect(flagged("count")).toEqual([...inventory.metadata.count].sort());
    expect(flagged("repeat")).toEqual([...inventory.metadata.repeat].sort());
    expect(commandCatalogById.get("jump.flash")).not.toMatchObject({ count: true });
    expect(commandCatalogById.get("jump.flash")).not.toMatchObject({ repeat: true });
    expect(commandCatalogById.get("goto.matching-bracket")).toMatchObject({ repeat: true });
    expect(commandCatalogById.get("goto.matching-bracket")?.count).not.toBe(true);
    expect(commandCatalogById.get("textobject.select")).toMatchObject({ repeat: true });
    expect(commandCatalogById.get("textobject.select")?.count).not.toBe(true);
    expect(commandCatalogById.get("goto.window-center")?.count).not.toBe(true);
    expect(defaultKeymap.some((entry) => entry.command === "goto.window-center")).toBe(false);
    expect(defaultKeymap.filter((entry) => entry.context === "sticky-view" && typeof entry.keys === "string" && entry.keys.startsWith("Ctrl+")).map((entry) => entry.command).sort()).toEqual(["view.half-page-down", "view.half-page-up", "view.page-down", "view.page-up"]);
    for (const entry of completeCommandCatalog) expect(entry.availability?.every((pair) => entry.modes.includes(pair.mode))).toBe(true);
  });
  it("keeps the default Space behavior as flash in normal and visual modes", () => {
    const compiled = compileKeymap(defaultKeymap, { version: 1 });
    const golden = JSON.parse(readFileSync(resolve(process.cwd(), "packages/editor-controller/testdata/keymap-v1-default.golden.json"), "utf8")) as { version: number; bindings: { context?: string; modes: string[]; keys: string; command: string }[] };
    expect(golden.version).toBe(1);
    expect(compiled.issues).toEqual([]);
    const space = (mode: string) => golden.bindings.find((binding) => (binding.context ?? "editor") === "editor" && binding.modes.includes(mode) && binding.keys === "Space")?.command;
    expect(resolveKeymap(compiled.tries.get("editor:normal"), ["Space"])).toEqual({ kind: "command", command: space("normal") });
    expect(resolveKeymap(compiled.tries.get("editor:visual"), ["Space"])).toEqual({ kind: "command", command: space("visual") });
  });
});
