import type { EditorMode, KeymapContext } from "./command-catalog";

export type KeymapPrimitive = string | boolean | number;
export type KeymapArgs = Readonly<Record<string, KeymapPrimitive>>;
export interface KeymapBinding { keys: string | readonly string[]; command: string; modes?: readonly EditorMode[]; context?: KeymapContext; args?: KeymapArgs; }
export interface KeymapUnbind { keys: string | readonly string[]; modes?: readonly EditorMode[]; context?: KeymapContext; subtree?: boolean; }
export interface KeymapConfig { version: 1; bindings?: readonly KeymapBinding[]; unbind?: readonly (string | KeymapUnbind)[]; }
export type KeymapModifierPolicy = "canonical" | "ignore" | "completion-tab-shift" | "selective-ignore" | "ctrl-w";
export type KeymapUnmatchedPolicy = "fallthrough" | "consume" | "delegate";
export type KeymapAfterInputPolicy = { readonly kind: "fixed"; readonly context: KeymapContext } | { readonly kind: "sticky-state"; readonly whenActive: KeymapContext; readonly whenInactive: KeymapContext };
export interface KeymapOverlayPolicy { readonly fallbackContext: KeymapContext; readonly retainFallbackOnMatch: boolean; }
export interface KeymapContextPolicy { context: KeymapContext; modifiers: KeymapModifierPolicy; unmatched: KeymapUnmatchedPolicy; ignoreModifiersFor?: readonly string[]; afterInput?: KeymapAfterInputPolicy; overlay?: KeymapOverlayPolicy; }
const defaultKeymapContextPolicySource: readonly KeymapContextPolicy[] = [
  { context: "editor", modifiers: "canonical", unmatched: "fallthrough" },
  { context: "goto", modifiers: "ignore", unmatched: "fallthrough" },
  { context: "match", modifiers: "ignore", unmatched: "fallthrough" },
  { context: "bracket-prev", modifiers: "ignore", unmatched: "fallthrough" },
  { context: "bracket-next", modifiers: "ignore", unmatched: "fallthrough" },
  { context: "view", modifiers: "ignore", unmatched: "consume", afterInput: { kind: "fixed", context: "editor" } },
  { context: "sticky-view-prefix", modifiers: "ignore", unmatched: "consume", afterInput: { kind: "sticky-state", whenActive: "sticky-view", whenInactive: "editor" } },
  { context: "sticky-view-overlay", modifiers: "selective-ignore", unmatched: "delegate", ignoreModifiersFor: ["Escape", "j", "k", "ArrowDown", "ArrowUp"], overlay: { fallbackContext: "sticky-view-prefix", retainFallbackOnMatch: true } },
  { context: "sticky-view", modifiers: "selective-ignore", unmatched: "fallthrough", ignoreModifiersFor: ["Escape", "j", "k", "ArrowDown", "ArrowUp"] },
  { context: "ctrl-w", modifiers: "ctrl-w", unmatched: "fallthrough", ignoreModifiersFor: ["Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] },
  { context: "question", modifiers: "ignore", unmatched: "fallthrough" },
  { context: "picker", modifiers: "ignore", unmatched: "consume" },
  { context: "completion", modifiers: "completion-tab-shift", unmatched: "fallthrough" },
  { context: "hover", modifiers: "ignore", unmatched: "fallthrough" }
];
export const defaultKeymapContextPolicies: readonly KeymapContextPolicy[] = Object.freeze(defaultKeymapContextPolicySource.map((entry) => Object.freeze({
  ...entry,
  ...(entry.ignoreModifiersFor ? { ignoreModifiersFor: Object.freeze([...entry.ignoreModifiersFor]) } : {}),
  ...(entry.afterInput ? { afterInput: Object.freeze({ ...entry.afterInput }) } : {}),
  ...(entry.overlay ? { overlay: Object.freeze({ ...entry.overlay }) } : {})
})));
export type KeymapIssueCode = "unsupported-version" | "invalid-config" | "invalid-command" | "invalid-args" | "duplicate" | "shadowed-leaf" | "shadowed-prefix" | "unreachable-mode" | "unreachable-context" | "after-operand" | "incomplete-prefix" | "alias-collision" | "invalid-key" | "missing-unbind";
export interface KeymapIssue { code: KeymapIssueCode; message: string; binding?: KeymapBinding; }

const modes = new Set<EditorMode>(["normal", "visual", "insert"]);
const contexts = new Set<KeymapContext>(["editor", "goto", "match", "bracket-prev", "bracket-next", "view", "sticky-view-prefix", "sticky-view-overlay", "sticky-view", "ctrl-w", "question", "picker", "completion", "hover"]);
const keyList = (value: unknown): value is string | readonly string[] => typeof value === "string" || (Array.isArray(value) && value.every((key) => typeof key === "string"));
const modeList = (value: unknown): value is readonly EditorMode[] => Array.isArray(value) && value.every((mode) => typeof mode === "string" && modes.has(mode as EditorMode));
const argsObject = (value: unknown): value is KeymapArgs => value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((arg) => typeof arg === "string" || typeof arg === "boolean" || (typeof arg === "number" && Number.isFinite(arg)));

/** Decode untrusted JSON completely before handing it to the compiler. */
export function decodeKeymapConfig(value: unknown): { config: KeymapConfig; issues: readonly KeymapIssue[] } {
  const issues: KeymapIssue[] = [];
  const object = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!object) return { config: { version: 1 }, issues: [{ code: "invalid-config", message: "Keymap must be an object" }] };
  if (object.version !== 1) issues.push({ code: "unsupported-version", message: `version must be 1, got ${String(object.version)}` });
  const binding = (value: unknown, path: string): KeymapBinding | null => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) { issues.push({ code: "invalid-config", message: `${path} must be an object` }); return null; }
    const row = value as Record<string, unknown>;
    if (!keyList(row.keys) || typeof row.command !== "string") { issues.push({ code: "invalid-config", message: `${path} requires string command and string/string[] keys` }); return null; }
    if (row.modes !== undefined && !modeList(row.modes)) { issues.push({ code: "invalid-config", message: `${path}.modes contains an invalid mode` }); return null; }
    if (row.context !== undefined && (typeof row.context !== "string" || !contexts.has(row.context as KeymapContext))) { issues.push({ code: "invalid-config", message: `${path}.context contains an invalid context` }); return null; }
    if (row.args !== undefined && !argsObject(row.args)) { issues.push({ code: "invalid-config", message: `${path}.args must be a primitive-only object` }); return null; }
    return { keys: typeof row.keys === "string" ? row.keys : [...row.keys], command: row.command, ...(row.modes === undefined ? {} : { modes: [...row.modes] }), ...(row.context === undefined ? {} : { context: row.context as KeymapContext }), ...(row.args === undefined ? {} : { args: { ...row.args } }) };
  };
  const unbind = (value: unknown, path: string): string | KeymapUnbind | null => {
    if (typeof value === "string") return value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) { issues.push({ code: "invalid-config", message: `${path} requires keys` }); return null; }
    const row = value as Record<string, unknown>;
    if (!keyList(row.keys) || (row.modes !== undefined && !modeList(row.modes)) || (row.context !== undefined && (typeof row.context !== "string" || !contexts.has(row.context as KeymapContext))) || (row.subtree !== undefined && typeof row.subtree !== "boolean")) { issues.push({ code: "invalid-config", message: `${path} has invalid keys, modes, context, or subtree` }); return null; }
    return { keys: typeof row.keys === "string" ? row.keys : [...row.keys], ...(row.modes === undefined ? {} : { modes: [...row.modes] }), ...(row.context === undefined ? {} : { context: row.context as KeymapContext }), ...(row.subtree === undefined ? {} : { subtree: row.subtree }) };
  };
  const bindings = Array.isArray(object.bindings) ? object.bindings.map((entry, index) => binding(entry, `bindings[${index}]`)).filter((entry): entry is KeymapBinding => entry !== null) : [];
  if (object.bindings !== undefined && !Array.isArray(object.bindings)) issues.push({ code: "invalid-config", message: "bindings must be an array" });
  const unbinds = Array.isArray(object.unbind) ? object.unbind.map((entry, index) => unbind(entry, `unbind[${index}]`)).filter((entry): entry is string | KeymapUnbind => entry !== null) : [];
  if (object.unbind !== undefined && !Array.isArray(object.unbind)) issues.push({ code: "invalid-config", message: "unbind must be an array" });
  return { config: { version: 1, ...(bindings.length ? { bindings } : {}), ...(unbinds.length ? { unbind: unbinds } : {}) }, issues };
}
