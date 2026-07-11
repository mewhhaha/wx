import { completeCommandCatalog } from "./command-catalog";
import { defaultKeymap } from "./default-keymap";
import { defaultKeymapContextPolicies } from "./keymap-schema";

const compareCodeUnits = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const stable = <T>(values: readonly T[], select: (value: T) => string) => [...values].sort((left, right) => compareCodeUnits(select(left), select(right)));
export function renderCommandKeyGolden(): string {
  return `${JSON.stringify({ version: 1, contextPolicies: stable(defaultKeymapContextPolicies, (entry) => entry.context), catalog: stable(completeCommandCatalog, (entry) => entry.id), bindings: stable(defaultKeymap, (entry) => `${entry.context ?? "editor"}:${(entry.modes ?? []).join(",")}:${typeof entry.keys === "string" ? entry.keys : entry.keys.join(" ")}:${entry.command}`) }, null, 2)}\n`;
}
export function renderCommandKeyReference(): string {
  const keys = new Map<string, string[]>();
  for (const binding of defaultKeymap) { const value = `${binding.context ?? "editor"}/${(binding.modes ?? []).join(",")}: ${typeof binding.keys === "string" ? binding.keys : binding.keys.join(" ")}`; keys.set(binding.command, [...(keys.get(binding.command) ?? []), value]); }
  const afterInput = (entry: (typeof defaultKeymapContextPolicies)[number]) => !entry.afterInput ? "—" : entry.afterInput.kind === "fixed" ? entry.afterInput.context : `sticky:${entry.afterInput.whenActive}; non-sticky:${entry.afterInput.whenInactive}`;
  return `# Command and key reference (v1)\n\nGenerated from the stable catalog and default map. Do not edit manually.\n\n## Context policies\n\n| Context | Modifiers | Unmatched input | After input | Overlay fallback |\n| --- | --- | --- | --- | --- |\n${stable(defaultKeymapContextPolicies, (entry) => entry.context).map((entry) => `| \`${entry.context}\` | ${entry.modifiers}${entry.ignoreModifiersFor?.length ? ` (${entry.ignoreModifiersFor.join(", ")})` : ""} | ${entry.unmatched} | ${afterInput(entry)} | ${entry.overlay ? `${entry.overlay.fallbackContext}${entry.overlay.retainFallbackOnMatch ? " (retained on match)" : ""}` : "—"} |`).join("\n")}\n\n## Commands\n\n| ID | Description | Default keys | Metadata |\n| --- | --- | --- | --- |\n${stable(completeCommandCatalog, (entry) => entry.id).map((entry) => `| \`${entry.id}\` | ${entry.description} | ${(keys.get(entry.id) ?? []).sort(compareCodeUnits).join("<br>") || "—"} | ${[entry.count && "count", entry.async && "async", entry.repeat && "repeat", entry.history && "history", entry.palette && "palette", entry.operand && `operand:${entry.operand.kind}/${entry.operand.arity}`, entry.args && `args:${Object.keys(entry.args.properties).sort(compareCodeUnits).join("/")}`, entry.aliases?.length && `aliases:${entry.aliases.join(",")}`].filter(Boolean).join(", ") || "—"} |`).join("\n")}\n`;
}
