import { insertText } from "@mewhhaha/wx-core";
import type { EditorMode } from "./command-catalog";
import { contextAfterInput, eventToContextKeyStroke, getKeymapHelp, resolveContextKeymap, resolveKeymap, type CompiledKeymap, type ContextKeymapResolution } from "./keymap-compiler";
import type { KeymapContextPolicy } from "./keymap-schema";
import { createFlashKeyRuntime } from "./key-flash";
import type { RuntimeCommandRegistry } from "./key-command-registry";
import type { KeyRuntime, KeyRuntimeContext } from "./key-runtime-types";
import type { EditorKeyInput, EditorKeyInputOptions, EditorKeyInputResult, EditorPendingAction } from "./types";

export type { KeyRuntime } from "./key-runtime-types";
export type { PickerActionItem } from "./key-runtime-types";

interface KeyRuntimeData { compiled: CompiledKeymap; registry: RuntimeCommandRegistry; }
interface PendingSequence { context: Parameters<typeof eventToContextKeyStroke>[0]; mode: EditorMode; keys: string[]; }
const browserEvent = (input: EditorKeyInput) => ({ key: input.key, ctrlKey: !!input.ctrl, altKey: !!input.alt, metaKey: !!input.meta, shiftKey: !!input.shift });

export function createKeyRuntime(context: KeyRuntimeContext, data: KeyRuntimeData): KeyRuntime {
  const flashRuntime = createFlashKeyRuntime(context); let pendingSequence: PendingSequence | null = null;
  const pendingContext = (pending: EditorPendingAction): Parameters<typeof eventToContextKeyStroke>[0] | null => pending?.kind === "g" ? "goto" : pending?.kind === "ctrl-w" ? "ctrl-w" : pending?.kind === "[" ? "bracket-prev" : pending?.kind === "]" ? "bracket-next" : pending?.kind === "m" ? "match" : pending?.kind === "?" ? "question" : pending?.kind === "z" ? pending.sticky ? context.getPresentation().ui.stickyViewMode ? "sticky-view-overlay" : "sticky-view-prefix" : "view" : null;
  const policy = (name: Parameters<typeof eventToContextKeyStroke>[0]): KeymapContextPolicy | undefined => data.compiled.contextPolicies.find((entry) => entry.context === name);
  const transitionAfterInput = (contextPolicy: KeymapContextPolicy | undefined) => { const next = contextAfterInput(contextPolicy, { sticky: context.getPresentation().ui.stickyViewMode }); if (next === "sticky-view") context.setStickyViewMode(true); else if (next === "editor") context.setStickyViewMode(false); return next; };
  const clearHelp = () => context.setCommandCompletions([], 0, "ui.pending-action.help");
  const showHelp = (name: Parameters<typeof eventToContextKeyStroke>[0], mode: EditorMode, prefix: readonly string[] = []) => {
    const help = getKeymapHelp(data.compiled.tries.get(`${name}:${mode}`), prefix); const order = new Map(data.compiled.bindings.filter((entry) => entry.context === name && entry.mode === mode).map((entry, index) => [`${entry.keys.join("\0")}\0${entry.command}`, index]));
    const items = [...help].sort((left, right) => (order.get(`${left.keys.join("\0")}\0${left.command}`) ?? Number.MAX_SAFE_INTEGER) - (order.get(`${right.keys.join("\0")}\0${right.command}`) ?? Number.MAX_SAFE_INTEGER)).map((entry) => ({ label: entry.keys.slice(prefix.length).join(" "), detail: entry.description }));
    context.setCommandCompletions(items, 0, "ui.pending-action.help");
  };
  const syncPendingHelp = () => { const presentation = context.getPresentation(); const next = pendingContext(presentation.ui.pendingAction); if (next) showHelp(next, context.getState().mode); else if (!pendingSequence && !presentation.ui.commandLine.active) clearHelp(); };
  const withSynchronizedHelp = (result: EditorKeyInputResult | Promise<EditorKeyInputResult>): EditorKeyInputResult | Promise<EditorKeyInputResult> => {
    if (result && typeof (result as PromiseLike<EditorKeyInputResult>).then === "function") {
      return Promise.resolve(result).then((settled) => { syncPendingHelp(); return settled; });
    }
    syncPendingHelp();
    return result;
  };
  const dispatch = (resolved: ContextKeymapResolution, input: EditorKeyInput, options: EditorKeyInputOptions): EditorKeyInputResult | Promise<EditorKeyInputResult> => {
    if (resolved.resolution.kind !== "command") return { handled: false };
    return withSynchronizedHelp(data.registry.dispatch({ command: resolved.resolution.command, args: resolved.resolution.args, input, options }));
  };
  const resolveContext = (name: Parameters<typeof eventToContextKeyStroke>[0], input: EditorKeyInput, options: EditorKeyInputOptions): { matched: boolean; result: EditorKeyInputResult | Promise<EditorKeyInputResult>; resolved: ContextKeymapResolution } => {
    const mode = context.getState().mode; const resolved = resolveContextKeymap(data.compiled, name, mode, browserEvent(input));
    if (resolved.resolution.kind === "command") return { matched: true, result: dispatch(resolved, input, options), resolved };
    if (resolved.resolution.kind === "pending") { pendingSequence = { context: resolved.context, mode, keys: [resolved.stroke!] }; showHelp(resolved.context, mode, pendingSequence.keys); return { matched: true, result: { handled: true }, resolved }; }
    return { matched: resolved.policy?.unmatched === "consume", result: { handled: resolved.policy?.unmatched === "consume" }, resolved };
  };
  const runPendingSequence = async (input: EditorKeyInput, options: EditorKeyInputOptions): Promise<EditorKeyInputResult | null> => {
    if (!pendingSequence) return null; if (input.key === "Escape") { pendingSequence = null; clearHelp(); context.clearPendingCount(); return { handled: true }; }
    const stroke = eventToContextKeyStroke(pendingSequence.context, browserEvent(input), data.compiled.contextPolicies); if (!stroke) return { handled: false }; const keys = [...pendingSequence.keys, stroke]; const trie = data.compiled.tries.get(`${pendingSequence.context}:${pendingSequence.mode}`); const resolution = resolveKeymap(trie, keys);
    if (resolution.kind === "pending") { pendingSequence.keys = keys; showHelp(pendingSequence.context, pendingSequence.mode, keys); return { handled: true }; }
    const current = pendingSequence; pendingSequence = null; clearHelp(); if (resolution.kind === "command") return await withSynchronizedHelp(data.registry.dispatch({ command: resolution.command, args: resolution.args, input, options })); return policy(current.context)?.unmatched === "consume" ? { handled: true } : null;
  };
  const dynamicPicker = async (input: EditorKeyInput): Promise<EditorKeyInputResult> => { const picker = context.getPresentation().ui.picker; const key = input.key; if (picker.inputMode === "filename" && [...key].length === 1) return { handled: await context.updatePickerQuery(`${picker.query}${key}`) }; if ([...key].length === 1 && !/^[1-9]$/.test(key)) return { handled: await context.updatePickerQuery(`${picker.query}${key}`) }; if (/^[1-9]$/.test(key)) { await context.acceptPicker(Number(key) - 1); return { handled: true }; } return { handled: false }; };
  const handleOperand = async (pending: Extract<NonNullable<EditorPendingAction>, { kind: "command-operand" }>, input: EditorKeyInput, options: EditorKeyInputOptions): Promise<EditorKeyInputResult> => { if (input.key === "Escape") { context.setPendingActionState(null); clearHelp(); context.clearPendingCount(); return { handled: true }; } const operands = [...pending.operands, input.key]; const arity = data.registry.catalog.get(pending.command)?.operand?.arity ?? operands.length; if (operands.length < arity) { context.setPendingActionState({ ...pending, operands }); return { handled: true }; } context.setPendingActionState(null); clearHelp(); return data.registry.dispatch({ command: pending.command, args: pending.args, operands, input, options }); };

  const handleKeyInput: KeyRuntime["handleKeyInput"] = async (input, options: EditorKeyInputOptions = {}) => {
    const state = context.getState(); const presentation = context.getPresentation(); const pending = presentation.ui.pendingAction;
    if (presentation.ui.flash.active || pending?.kind === "flash-target") { const didHandle = flashRuntime.handleFlashKey(input.key); if (didHandle) return { handled: true }; }
    if (presentation.ui.completion.active) { const match = resolveContext("completion", input, options); if (match.matched) return match.result; }
    if (presentation.ui.picker.active) { const resolved = resolveContextKeymap(data.compiled, "picker", state.mode, browserEvent(input)); if (resolved.resolution.kind === "command" && !(resolved.resolution.args?.variant === "bar" && presentation.ui.picker.variant !== "bar")) return dispatch(resolved, input, options); return dynamicPicker(input); }
    if (presentation.ui.commandLine.active) return (await context.handleActiveCommandLineKey(input.key, { ...options, shift: !!input.shift })) ?? { handled: false };
    if (presentation.ui.hover.active) { const match = resolveContext("hover", input, options); if (match.matched) return match.result; }
    if (pendingSequence) { const sequence = await runPendingSequence(input, options); if (sequence) return sequence; }
    if (pending?.kind === "command-operand") return handleOperand(pending, input, options);
    const modalContext = pendingContext(pending);
    if (modalContext === "sticky-view-overlay") { const resolved = resolveContextKeymap(data.compiled, modalContext, state.mode, browserEvent(input)); const retainedOverlayMatch = resolved.context === modalContext && policy(modalContext)?.overlay?.retainFallbackOnMatch === true; if (retainedOverlayMatch && resolved.resolution.kind === "command") return dispatch(resolved, input, options); context.setPendingActionState(null); clearHelp(); transitionAfterInput(resolved.policy); if (resolved.resolution.kind === "command") return dispatch(resolved, input, options); if (resolved.resolution.kind === "pending") { pendingSequence = { context: resolved.context, mode: state.mode, keys: [resolved.stroke!] }; showHelp(resolved.context, state.mode, pendingSequence.keys); return { handled: true }; } if (resolved.policy?.unmatched === "consume") return { handled: true }; }
    if (pending && input.key === "Escape") { context.setPendingActionState(null); clearHelp(); context.clearPendingCount(); return { handled: true }; }
    if (modalContext && modalContext !== "sticky-view-overlay") { context.setPendingActionState(null); clearHelp(); const match = resolveContext(modalContext, input, options); const next = transitionAfterInput(match.resolved.policy); if (match.matched) return match.result; if (next) return { handled: true }; }
    if (!presentation.ui.pendingAction && presentation.ui.stickyViewMode) { const match = resolveContext("sticky-view", input, options); if (match.matched) return match.result; }
    if ((state.mode === "normal" || state.mode === "visual") && !input.ctrl && !input.alt && !input.meta && /^[0-9]$/.test(input.key) && !(presentation.ui.pendingCount === "" && input.key === "0")) { context.setPendingCountState(`${presentation.ui.pendingCount}${input.key}`); return { handled: true }; }
    const editor = resolveContext("editor", input, options); if (editor.matched) return editor.result;
    if (state.mode === "insert" && !input.ctrl && !input.alt && !input.meta && [...input.key].length === 1) { context.executeCommandWithCountSync(insertText(input.key)); return { handled: true }; }
    return { handled: false };
  };
  const handleTextInput: KeyRuntime["handleTextInput"] = async (text, options = {}) => { let handledAny = false; let themeName: string | null | undefined; let quit = false; for (const char of text) { const result = await handleKeyInput({ key: char, text: char }, options); handledAny ||= result.handled; if (result.themeName !== undefined) themeName = result.themeName; quit ||= !!result.quit; } return { handled: handledAny, themeName, quit }; };
  return { handleKeyInput, handleTextInput, repeatSearch: (reverse = false) => context.repeatSearch(reverse), beginFlashTarget: flashRuntime.beginFlashTarget, handleFlashKey: flashRuntime.handleFlashKey };
}
