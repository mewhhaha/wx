import type {
  EditorCommandCompletionItem,
  EditorCommandLineState
} from "./types";

const ROOT_COMMANDS: EditorCommandCompletionItem[] = [
  { label: "theme", detail: "switch theme" },
  { label: "write", detail: "save document" },
  { label: "format", detail: "format document" },
  { label: "code-actions", detail: "show code actions" }
];

export function getCommandCompletionItems(
  commandLine: EditorCommandLineState,
  themeNames: readonly string[] = []
): EditorCommandCompletionItem[] {
  if (!commandLine.active || commandLine.prompt !== ":") {
    return [];
  }

  const rawValue = commandLine.value;
  const trimmedStart = rawValue.trimStart();

  if (!trimmedStart) {
    return [...ROOT_COMMANDS];
  }

  const parts = trimmedStart.split(/\s+/);
  const commandName = (parts[0] ?? "").toLowerCase();
  const hasArgumentSpace = /\s$/.test(rawValue);
  const commandArgument = trimmedStart.slice(parts[0]?.length ?? 0).trim();

  if (commandName === "theme") {
    return themeNames
      .filter((entry) => entry.toLowerCase().includes(commandArgument.toLowerCase()))
      .map((entry) => ({ label: entry, detail: "theme" }));
  }

  if (!hasArgumentSpace) {
    return ROOT_COMMANDS.filter((entry) => entry.label.startsWith(commandName));
  }

  return [];
}

export function hasRunnableCommandLineValue(rawValue: string, themeNames: readonly string[] = []): boolean {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return false;
  }

  const [commandName = "", ...argumentParts] = trimmed.split(/\s+/);
  const value = commandName.toLowerCase();
  const commandArgument = argumentParts.join(" ").trim();

  if (["format", "fmt", "w", "write", "code-actions", "codeaction", "ca", "q", "quit"].includes(value)) {
    return true;
  }

  if (value !== "theme") {
    return false;
  }

  if (!commandArgument) {
    return true;
  }

  const normalizedArgument = commandArgument.toLowerCase();
  return themeNames.some(
    (entry) => entry.toLowerCase() === normalizedArgument || entry.toLowerCase().startsWith(normalizedArgument)
  );
}

export function resolveCommandPreviewTheme(options: {
  commandLine: EditorCommandLineState;
  commandCompletionIndex: number;
  commandCompletionItems: readonly EditorCommandCompletionItem[];
  previewTheme: string | null;
  themeName: string | null;
  themeNames: readonly string[];
}): {
  items: EditorCommandCompletionItem[];
  index: number;
  previewTheme: string | null;
  themeName: string | null;
  changed: boolean;
} {
  const items = getCommandCompletionItems(options.commandLine, options.themeNames);
  const rawValue = options.commandLine.value.trimStart();
  const activeCommandName = rawValue.split(/\s+/)[0]?.toLowerCase() ?? "";
  const previousItems = options.commandCompletionItems;
  let changed =
    previousItems.length !== items.length ||
    previousItems.some((item, index) => item.label !== items[index]?.label || item.detail !== items[index]?.detail);

  if (
    items.length === 0 ||
    !options.commandLine.active ||
    options.commandLine.prompt !== ":" ||
    activeCommandName !== "theme"
  ) {
    if (options.previewTheme !== null) {
      changed = true;
    }
    if (options.commandCompletionIndex !== 0 && items.length === 0) {
      changed = true;
    }
    return {
      items,
      index: items.length === 0 ? 0 : options.commandCompletionIndex,
      previewTheme: null,
      themeName: options.themeName,
      changed
    };
  }

  const index = Math.max(0, Math.min(items.length - 1, options.commandCompletionIndex));
  if (options.commandCompletionIndex !== index) {
    changed = true;
  }
  const previewTheme =
    options.themeNames.find((entry) => entry === items[index]?.label) ?? items[index]?.label ?? null;
  if (options.previewTheme !== previewTheme) {
    changed = true;
  }

  return {
    items,
    index,
    previewTheme,
    themeName: previewTheme ?? options.themeName,
    changed
  };
}
