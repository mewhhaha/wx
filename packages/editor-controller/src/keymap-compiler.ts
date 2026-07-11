import { commandCatalogById, resolveCommandId, type CommandMetadata, type EditorMode, type KeymapContext } from "./command-catalog";
import { decodeKeymapConfig, defaultKeymapContextPolicies, type KeymapArgs, type KeymapBinding, type KeymapConfig, type KeymapContextPolicy, type KeymapIssue, type KeymapModifierPolicy } from "./keymap-schema";

export interface KeymapTrie { command?: string; args?: KeymapArgs; description?: string; children: Map<string, KeymapTrie>; }
export interface CompiledBinding { context: KeymapContext; mode: EditorMode; keys: readonly string[]; command: string; args?: KeymapArgs; }
export interface CompiledKeymap { tries: ReadonlyMap<string, KeymapTrie>; issues: readonly KeymapIssue[]; bindings: readonly CompiledBinding[]; contextPolicies: readonly KeymapContextPolicy[]; }
export type KeymapResolution = { kind: "none" | "pending" | "cancelled" } | { kind: "command"; command: string; args?: KeymapArgs };
export class KeymapConfigurationError extends Error { readonly issues: readonly KeymapIssue[]; constructor(issues: readonly KeymapIssue[]) { super(`Invalid keymap configuration:\n${issues.map((issue) => `- [${issue.code}] ${issue.message}`).join("\n")}`); this.name = "KeymapConfigurationError"; this.issues = Object.freeze([...issues]); } }
const allModes: readonly EditorMode[] = ["normal", "visual", "insert"];
const root = (): KeymapTrie => ({ children: new Map() });
const mapKey = (context: KeymapContext, mode: EditorMode) => `${context}:${mode}`;
const contextOf = (binding: Pick<KeymapBinding, "context">): KeymapContext => binding.context ?? "editor";
const cloneArgs = (args: KeymapArgs | undefined): KeymapArgs | undefined => args && Object.freeze({ ...args });
const codeUnitCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export function parseKeyStroke(stroke: string): string | null {
  if (!stroke || stroke !== stroke.trim()) return null;
  let parts: string[]; let key: string;
  if (stroke === "+") { parts = []; key = "+"; }
  else if (stroke.endsWith("++")) { const modifiers = stroke.slice(0, -2); if (!modifiers) return null; parts = modifiers.split("+"); key = "+"; }
  else { parts = stroke.split("+"); key = parts.pop()!; }
  const order = ["Ctrl", "Alt", "Shift", "Meta"];
  if (!key || parts.some((part) => !order.includes(part)) || new Set(parts).size !== parts.length) return null;
  const named = new Set(["Space", "Tab", "Escape", "Enter", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "F2"]);
  if (!named.has(key) && [...key].length !== 1) return null;
  if (parts.includes("Shift") && key !== "Tab") { parts.splice(parts.indexOf("Shift"), 1); if (/^[a-z]$/.test(key)) key = key.toUpperCase(); }
  return [...parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)), key].join("+");
}
/** `key` already represents a shifted printable glyph. Space ignores Shift in the legacy handler. */
export function eventToKeyStroke(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">, policy: KeymapModifierPolicy = "canonical"): string | null {
  const key = event.key === " " ? "Space" : event.key;
  if (policy === "ignore") return parseKeyStroke(key);
  if (policy === "completion-tab-shift") return parseKeyStroke([event.shiftKey && key === "Tab" && "Shift", key].filter(Boolean).join("+"));
  const canonicalKey = event.altKey && key.toLowerCase() === "g" ? event.shiftKey ? "G" : "g" : key;
  return parseKeyStroke([event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && key === "Tab" && "Shift", event.metaKey && "Meta", canonicalKey].filter(Boolean).join("+"));
}
export function eventToContextKeyStroke(context: KeymapContext, event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">, policies: readonly KeymapContextPolicy[] = defaultKeymapContextPolicies): string | null {
  const policy = policies.find((entry) => entry.context === context); const rawKey = event.key === " " ? "Space" : event.key;
  if (policy?.ignoreModifiersFor?.includes(rawKey)) return eventToKeyStroke(event, "ignore");
  if (policy?.modifiers === "ctrl-w") return eventToKeyStroke({ ...event, altKey: false, metaKey: false }, "canonical");
  return eventToKeyStroke(event, policy?.modifiers === "selective-ignore" ? "canonical" : policy?.modifiers ?? "canonical");
}
export function contextAfterInput(policy: KeymapContextPolicy | undefined, state: { readonly sticky: boolean }): KeymapContext | undefined { if (!policy?.afterInput) return undefined; return policy.afterInput.kind === "fixed" ? policy.afterInput.context : state.sticky ? policy.afterInput.whenActive : policy.afterInput.whenInactive; }
export function parseKeySequence(keys: string | readonly string[]): readonly string[] | null { const values = typeof keys === "string" ? keys.split(/\s+/) : keys; if (!values.length || values.some((value) => typeof value !== "string")) return null; const parsed = values.map(parseKeyStroke); return parsed.some((value) => value === null) ? null : parsed as string[]; }
const available = (metadata: CommandMetadata, context: KeymapContext, mode: EditorMode) => metadata.availability ? metadata.availability.some((entry) => entry.context === context && entry.mode === mode) : metadata.modes.includes(mode) && (metadata.contexts ?? ["editor"]).includes(context);
const validateArgs = (metadata: CommandMetadata, supplied: KeymapArgs | undefined): KeymapArgs | null => {
  const contract = metadata.args; const args = { ...(contract?.defaults ?? {}), ...(supplied ?? {}) };
  if (!contract) return supplied && Object.keys(supplied).length ? null : cloneArgs(supplied) ?? {};
  if (Object.keys(args).some((key) => !Object.hasOwn(contract.properties, key)) || (contract.required ?? []).some((key) => args[key] === undefined)) return null;
  for (const [key, value] of Object.entries(args)) {
    const rule = contract.properties[key];
    if (!rule || typeof value !== rule.type || (rule.type === "number" && !Number.isFinite(value)) || (rule.type === "string" && rule.values && !rule.values.includes(value as string))) return null;
  }
  return cloneArgs(args) ?? {};
};

export function compileKeymap(defaults: readonly KeymapBinding[], unsafeConfig: KeymapConfig | unknown = { version: 1 }, catalog = commandCatalogById, policies: readonly KeymapContextPolicy[] = defaultKeymapContextPolicies): CompiledKeymap {
  const decoded = decodeKeymapConfig(unsafeConfig); const config = decoded.config; const issues = [...decoded.issues]; const tries = new Map<string, KeymapTrie>(); const bindings: CompiledBinding[] = [];
  const get = (context: KeymapContext, mode: EditorMode) => { const id = mapKey(context, mode); let trie = tries.get(id); if (!trie) { trie = root(); tries.set(id, trie); } return trie; };
  const install = (binding: KeymapBinding) => {
    const strokes = parseKeySequence(binding.keys); const context = contextOf(binding); const canonical = resolveCommandId(binding.command, catalog); const metadata = canonical && catalog.get(canonical);
    if (!strokes) { issues.push({ code: "invalid-key", message: `Invalid key sequence for ${binding.command}`, binding }); return; }
    if (!metadata) { issues.push({ code: "invalid-command", message: `Unknown command: ${binding.command}`, binding }); return; }
    const args = validateArgs(metadata, binding.args); if (!args) { issues.push({ code: "invalid-args", message: `Invalid arguments for ${canonical}`, binding }); return; }
    for (const mode of binding.modes ?? allModes) {
      if (!available(metadata, context, mode)) { issues.push({ code: metadata.availability?.some((entry) => entry.context === context) || !metadata.modes.includes(mode) ? "unreachable-mode" : "unreachable-context", message: `${canonical} is unavailable in ${context}/${mode}`, binding }); continue; }
      let node = get(context, mode);
      for (const stroke of strokes) { if (node.command) { const prior = catalog.get(node.command); issues.push({ code: prior?.operand ? "after-operand" : "shadowed-prefix", message: `${context}/${mode}: ${strokes.join(" ")} extends ${node.command}`, binding }); return; } node = node.children.get(stroke) ?? (() => { const child = root(); node.children.set(stroke, child); return child; })(); }
      if (node.command) { issues.push({ code: "duplicate", message: `${strokes.join(" ")} is already bound to ${node.command}`, binding }); continue; }
      if (node.children.size) { issues.push({ code: "shadowed-leaf", message: `${strokes.join(" ")} would shadow a key prefix`, binding }); continue; }
      node.command = canonical; node.args = args; node.description = metadata.description; bindings.push({ context, mode, keys: Object.freeze([...strokes]), command: canonical, ...(Object.keys(args).length ? { args } : {}) });
    }
  };
  defaults.forEach(install);
  const remove = (trie: KeymapTrie, keys: readonly string[], subtree: boolean): boolean => { const walk = (node: KeymapTrie, index: number): boolean => { if (index === keys.length) { if (!node.command && !subtree) return false; node.command = undefined; node.args = undefined; node.description = undefined; if (subtree) node.children.clear(); return true; } const child = node.children.get(keys[index]!); if (!child || !walk(child, index + 1)) return false; if (!child.command && !child.children.size) node.children.delete(keys[index]!); return true; }; return walk(trie, 0); };
  for (const item of config.unbind ?? []) {
    const target = typeof item === "string" ? { keys: item } : item; const strokes = parseKeySequence(target.keys);
    if (!strokes) { issues.push({ code: "invalid-key", message: "Invalid unbind sequence" }); continue; }
    const context = contextOf(target); let removedAny = false;
    for (const mode of target.modes ?? allModes) {
      const trie = tries.get(mapKey(context, mode)); const removed = !!trie && remove(trie, strokes, target.subtree === true);
      if (!removed) {
        if (target.modes !== undefined) issues.push({ code: "missing-unbind", message: `No binding to unbind: ${context}/${mode} ${strokes.join(" ")}` });
        continue;
      }
      removedAny = true;
      for (let i = bindings.length - 1; i >= 0; i--) { const binding = bindings[i]!; if (binding.context === context && binding.mode === mode && (target.subtree ? strokes.every((stroke, part) => binding.keys[part] === stroke) : binding.keys.join("\0") === strokes.join("\0"))) bindings.splice(i, 1); }
    }
    if (target.modes === undefined && !removedAny) issues.push({ code: "missing-unbind", message: `No binding to unbind: ${context} ${strokes.join(" ")}` });
  }
  (config.bindings ?? []).forEach(install);
  const owners = new Map<string, string>(); for (const entry of catalog.values()) for (const alias of entry.aliases ?? []) { const owner = owners.get(alias); if (owner && owner !== entry.id) issues.push({ code: "alias-collision", message: `Alias ${alias} belongs to both ${owner} and ${entry.id}` }); owners.set(alias, entry.id); }
  return { tries, issues, bindings, contextPolicies: Object.freeze(policies.map((entry) => Object.freeze({ ...entry, ...(entry.ignoreModifiersFor ? { ignoreModifiersFor: Object.freeze([...entry.ignoreModifiersFor]) } : {}), ...(entry.afterInput ? { afterInput: Object.freeze({ ...entry.afterInput }) } : {}), ...(entry.overlay ? { overlay: Object.freeze({ ...entry.overlay }) } : {}) }))) };
}
export function resolveKeymap(trie: KeymapTrie | undefined, keys: readonly string[]): KeymapResolution { if (!trie) return { kind: "none" }; let node = trie; for (const stroke of keys) { const next = node.children.get(stroke); if (!next) return keys.length ? { kind: "cancelled" } : { kind: "none" }; node = next; } return node.command ? { kind: "command", command: node.command, ...(node.args && Object.keys(node.args).length ? { args: cloneArgs(node.args) } : {}) } : node.children.size ? { kind: "pending" } : { kind: "none" }; }
export interface ContextKeymapResolution { readonly context: KeymapContext; readonly stroke: string | null; readonly resolution: KeymapResolution; readonly policy?: KeymapContextPolicy; }
export function resolveContextKeymap(compiled: CompiledKeymap, context: KeymapContext, mode: EditorMode, event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): ContextKeymapResolution {
  const resolveIn = (target: KeymapContext): ContextKeymapResolution => { const policy = compiled.contextPolicies.find((entry) => entry.context === target); const stroke = eventToContextKeyStroke(target, event, compiled.contextPolicies); return { context: target, stroke, resolution: stroke === null ? { kind: "none" } : resolveKeymap(compiled.tries.get(mapKey(target, mode)), [stroke]), ...(policy ? { policy } : {}) }; };
  const primary = resolveIn(context); const fallback = primary.policy?.overlay?.fallbackContext;
  return fallback && primary.policy.unmatched === "delegate" && (primary.resolution.kind === "none" || primary.resolution.kind === "cancelled") ? resolveIn(fallback) : primary;
}
export function getKeymapHelp(trie: KeymapTrie | undefined, pending: readonly string[] = []): readonly { keys: readonly string[]; command: string; description: string; args?: KeymapArgs }[] { const result: { keys: string[]; command: string; description: string; args?: KeymapArgs }[] = []; let node = trie; for (const stroke of pending) node = node?.children.get(stroke); const walk = (current: KeymapTrie, keys: string[]) => { if (current.command) result.push({ keys, command: current.command, description: current.description ?? current.command, ...(current.args && Object.keys(current.args).length ? { args: cloneArgs(current.args) } : {}) }); [...current.children.entries()].sort(([a], [b]) => codeUnitCompare(a, b)).forEach(([stroke, child]) => walk(child, [...keys, stroke])); }; if (node) walk(node, [...pending]); return result; }
