import type {
  EditorCommandCompletionItem,
  EditorCommandLineState
} from "./types";

const ROOT_COMMANDS: EditorCommandCompletionItem[] = [
  { label: "theme", detail: "switch theme" },
  { label: "write", detail: "save document" },
  { label: "format", detail: "format document" },
  { label: "code-actions", detail: "show code actions" },
  { label: "completion", detail: "request completion" },
  { label: "goto", detail: "goto definition or references" },
  { label: "symbols", detail: "show document or workspace symbols" },
  { label: "rename", detail: "rename current symbol" },
  { label: "vsplit", detail: "split pane vertically" },
  { label: "hsplit", detail: "split pane horizontally" },
  { label: "close", detail: "close active pane" },
  { label: "only", detail: "keep only active pane" },
  { label: "buffer-next", detail: "next buffer in active pane" },
  { label: "buffer-prev", detail: "previous buffer in active pane" },
  { label: "select-next", detail: "add next occurrence" },
  { label: "select-prev", detail: "add previous occurrence" },
  { label: "select-all", detail: "select all occurrences" },
  { label: "split-lines", detail: "split selections by line" },
  { label: "collapse-selections", detail: "keep only primary selection" },
  { label: "remove-selection", detail: "drop primary selection" }
];

const QUESTION_ACTIONS: EditorCommandCompletionItem[] = [
  { label: "f", detail: "search repo files" },
  { label: "F", detail: "search folder files" },
  { label: "b", detail: "show buffers" },
  { label: "B", detail: "show buffers" },
  { label: "d", detail: "show diagnostics" },
  { label: "j", detail: "show jumplist" },
  { label: "p", detail: "show panes" },
  { label: "s", detail: "show document symbols" },
  { label: "S", detail: "show workspace symbols" },
  { label: "r", detail: "show references" },
  { label: "n", detail: "rename current symbol" }
];

export function getQuestionActionItems(): EditorCommandCompletionItem[] {
  return [...QUESTION_ACTIONS];
}

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

  if (commandName === "goto") {
    return ["definition", "declaration", "type-definition", "implementation", "references"]
      .filter((entry) => entry.includes(commandArgument.toLowerCase()))
      .map((entry) => ({ label: entry, detail: "goto target" }));
  }

  if (commandName === "symbols") {
    return ["document", "workspace"]
      .filter((entry) => entry.includes(commandArgument.toLowerCase()))
      .map((entry) => ({ label: entry, detail: "symbol scope" }));
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
  const normalizedArgument = commandArgument.toLowerCase();

  if (
    [
      "format",
      "fmt",
      "w",
      "write",
      "code-actions",
      "codeaction",
      "ca",
      "completion",
      "q",
      "quit",
      "vsplit",
      "hsplit",
      "close",
      "only",
      "buffer-next",
      "buffer-prev",
      "select-next",
      "select-prev",
      "select-all",
      "split-lines",
      "collapse-selections",
      "remove-selection"
    ].includes(value)
  ) {
    return true;
  }

  if (value !== "theme") {
    if (value === "goto") {
      return ["definition", "declaration", "type-definition", "implementation", "references"].includes(normalizedArgument);
    }

    if (value === "symbols") {
      return ["document", "workspace"].includes(normalizedArgument);
    }

    return value === "rename" ? !!commandArgument : false;
  }

  if (!commandArgument) {
    return true;
  }
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
