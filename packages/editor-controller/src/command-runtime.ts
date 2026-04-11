import { getActiveCharacterOffset, getSelectionOffsets, type EditorState, type SelectionSet } from "@wx/editor-core";
import { getCommandCompletionItems, resolveCommandPreviewTheme } from "./command-line";
import { escapeRegex } from "./search";
import type {
  EditorBottomMessageState,
  EditorCommandLineKeyOptions,
  EditorCommandLineKeyResult,
  EditorController,
  EditorKeyInputResult,
  EditorPresentationState,
  EditorSearchState
} from "./types";

interface SearchPreviewState {
  active: true;
  direction: "forward" | "backward";
  selection: SelectionSet;
  mode: EditorState["mode"];
  search: EditorSearchState;
  startOffset: number;
}

interface CommandRuntimeContext {
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getController(): EditorController;
  getSearchState(): EditorSearchState;
  getActiveOffset(): number;
  applySearchState(next: Partial<EditorSearchState>, effectType?: string): void;
  applyRegisterValue(name: string | null, value: string | null, effectType?: string): void;
  applySelectionRange(from: number, to: number): void;
  revealSelectionWithinViewport(): boolean;
  syncVisibleViewportRows(): boolean;
  syncVisibleLanguageDecorations(): boolean;
  ensureVisibleHighlightCoverage(): Promise<void>;
  setBottomMessage(message: EditorBottomMessageState | null): void;
  setCommandLineState(next: EditorPresentationState["ui"]["commandLine"], effectType?: string): void;
  emitPresentationUpdate(effectType?: string): void;
  loadCodeActions(): Promise<boolean>;
}

export interface CommandRuntime {
  openCommandLineState(prompt: ":" | "/" | "?"): void;
  handleCommandLineKeyInput(key: string, options?: EditorCommandLineKeyOptions): Promise<EditorCommandLineKeyResult>;
  handleActiveCommandLineKey(key: string, options?: EditorCommandLineKeyOptions): Promise<EditorKeyInputResult | null>;
  repeatSearch(reverseAgainstDirection?: boolean): boolean;
  searchFromSelection(reverse?: boolean): boolean;
  syncCommandPreviewTheme(themeNames?: readonly string[]): { themeName: string | null; changed: boolean };
}

function findSearchMatch(
  matches: readonly { from: number; to: number }[],
  offset: number,
  direction: "forward" | "backward",
  reverse = false
): { from: number; to: number } | null {
  const forward = reverse ? direction === "backward" : direction === "forward";

  return forward
    ? matches.find((entry) => entry.from > offset || (entry.from <= offset && offset < entry.to)) ?? matches[0] ?? null
    : [...matches].reverse().find((entry) => entry.to - 1 < offset || (entry.from <= offset && offset < entry.to)) ??
        matches[matches.length - 1] ??
        null;
}

export function createCommandRuntime(context: CommandRuntimeContext): CommandRuntime {
  let searchPreviewState: SearchPreviewState | null = null;

  const restoreSearchPreview = () => {
    if (!searchPreviewState?.active) {
      searchPreviewState = null;
      return;
    }

    context.applySearchState(searchPreviewState.search, "search.restore");
    const controller = context.getController();
    controller.dispatch({
      selection: searchPreviewState.selection,
      mode: searchPreviewState.mode
    });
    searchPreviewState = null;
  };

  const runSearch = (
    query: string,
    direction: "forward" | "backward",
    reverse = false,
    startOffset?: number
  ): boolean => {
    const presentation = context.getPresentation();
    const searchState = context.getSearchState();
    const previousSearch = { ...searchState };
    context.applySearchState(
      {
        query,
        direction,
        lastMatch: null
      },
      "search.update"
    );

    if (presentation.search.matches.length === 0) {
      context.applySearchState(previousSearch, "search.restore");
      context.setBottomMessage({ tone: "warning", text: `No matches for ${query}` });
      return false;
    }

    const offset = startOffset ?? context.getActiveOffset();
    const match = findSearchMatch(presentation.search.matches, offset, direction, reverse);

    if (!match) {
      context.applySearchState(previousSearch, "search.restore");
      return false;
    }

    context.applySearchState(
      {
        query,
        direction,
        lastMatch: match
      },
      "search.match"
    );
    context.applyRegisterValue("/", query, "register.search");
    context.applySelectionRange(match.from, match.to);
    context.revealSelectionWithinViewport();
    context.syncVisibleViewportRows();
    context.syncVisibleLanguageDecorations();
    void context.ensureVisibleHighlightCoverage();
    context.setBottomMessage(null);
    return true;
  };

  const previewSearch = (rawQuery: string, direction: "forward" | "backward") => {
    if (!searchPreviewState?.active) {
      return;
    }

    const query = rawQuery.trim();

    if (!query) {
      context.applySearchState(searchPreviewState.search, "search.restore");
      context.getController().dispatch({
        selection: searchPreviewState.selection,
        mode: searchPreviewState.mode
      });
      return;
    }

    context.applySearchState(
      {
        query,
        direction,
        lastMatch: null
      },
      "search.preview"
    );

    const matches = context.getPresentation().search.matches;

    if (matches.length === 0) {
      context.applySearchState(searchPreviewState.search, "search.restore");
      context.getController().dispatch({
        selection: searchPreviewState.selection,
        mode: searchPreviewState.mode
      });
      return;
    }

    const match = findSearchMatch(matches, searchPreviewState.startOffset, direction);
    if (!match) {
      context.applySearchState(searchPreviewState.search, "search.restore");
      context.getController().dispatch({
        selection: searchPreviewState.selection,
        mode: searchPreviewState.mode
      });
      return;
    }

    context.applySearchState(
      {
        query,
        direction,
        lastMatch: match
      },
      "search.preview"
    );
    context.applySelectionRange(match.from, match.to);
    context.revealSelectionWithinViewport();
    context.syncVisibleViewportRows();
    context.syncVisibleLanguageDecorations();
    void context.ensureVisibleHighlightCoverage();
  };

  const syncCommandPreviewTheme = (themeNames: readonly string[] = []) => {
    const presentation = context.getPresentation();
    const next = resolveCommandPreviewTheme({
      commandLine: presentation.ui.commandLine,
      commandCompletionIndex: presentation.ui.commandCompletionIndex,
      commandCompletionItems: presentation.ui.commandCompletionItems,
      previewTheme: presentation.ui.previewTheme,
      themeName: presentation.themeName,
      themeNames
    });

    if (next.changed) {
      presentation.ui.commandCompletionItems = next.items;
      presentation.ui.commandCompletionIndex = next.index;
      presentation.ui.previewTheme = next.previewTheme;
    }

    return { themeName: next.themeName, changed: next.changed };
  };

  const applyCommandCompletion = async (themeNames: readonly string[] = []): Promise<EditorKeyInputResult | null> => {
    const presentation = context.getPresentation();
    const items = getCommandCompletionItems(presentation.ui.commandLine, themeNames);
    if (items.length === 0) {
      return null;
    }

    const selected = items[Math.max(0, Math.min(items.length - 1, presentation.ui.commandCompletionIndex))];
    if (!selected || presentation.ui.commandLine.prompt !== ":") {
      return null;
    }

    if (selected.detail === "theme" && presentation.ui.commandLine.value.trimStart().toLowerCase().startsWith("theme")) {
      context.setCommandLineState(
        { ...presentation.ui.commandLine, value: `theme ${selected.label}` },
        "ui.command-line.input"
      );
      const result = await handleCommandLineKeyInput("Enter", { themeNames });
      return { ...result, themeName: result.themeName ?? presentation.themeName };
    }

    const nextValue =
      selected.label === "theme" || selected.label === "write"
        ? `${selected.label} `
        : selected.label;
    context.setCommandLineState({ ...presentation.ui.commandLine, value: nextValue }, "ui.command-line.input");
    presentation.ui.commandCompletionIndex = 0;
    const { themeName } = syncCommandPreviewTheme(themeNames);
    context.emitPresentationUpdate("ui.command-line.completion");
    return { handled: true, themeName };
  };

  const openCommandLineState = (prompt: ":" | "/" | "?") => {
    const state = context.getState();
    const searchState = context.getSearchState();
    const presentation = context.getPresentation();

    if (prompt === "/" || prompt === "?") {
      searchPreviewState = {
        active: true,
        direction: prompt === "/" ? "forward" : "backward",
        selection: state.selection,
        mode: state.mode,
        search: { ...searchState },
        startOffset: context.getActiveOffset()
      };
    } else {
      searchPreviewState = null;
    }

    presentation.ui.pendingAction = null;
    presentation.ui.commandCompletionIndex = 0;
    presentation.ui.commandCompletionItems = [];
    presentation.ui.previewTheme = null;
    context.setCommandLineState({ active: true, value: "", prompt }, "ui.command-line.open");
  };

  const handleCommandLineKeyInput = async (
    key: string,
    options: EditorCommandLineKeyOptions = {}
  ): Promise<EditorCommandLineKeyResult> => {
    const controller = context.getController();
    const presentation = context.getPresentation();
    const commandLine = presentation.ui.commandLine;

    if (!commandLine.active) {
      return { handled: false };
    }

    if (key === "Escape") {
      restoreSearchPreview();
      searchPreviewState = null;
      presentation.ui.commandCompletionIndex = 0;
      presentation.ui.commandCompletionItems = [];
      presentation.ui.previewTheme = null;
      context.setCommandLineState({ active: false, value: "", prompt: ":" }, "ui.command-line.close");
      return { handled: true };
    }

    if (key === "Backspace") {
      const nextValue = commandLine.value.slice(0, -1);
      context.setCommandLineState({ ...commandLine, value: nextValue }, "ui.command-line.input");
      if (commandLine.prompt === "/" || commandLine.prompt === "?") {
        previewSearch(nextValue, commandLine.prompt === "/" ? "forward" : "backward");
      }
      return { handled: true };
    }

    if (key === "Enter") {
      const trimmed = commandLine.value.trim();
      const prompt = commandLine.prompt;
      presentation.ui.commandCompletionIndex = 0;
      presentation.ui.commandCompletionItems = [];
      presentation.ui.previewTheme = null;
      context.setCommandLineState({ active: false, value: "", prompt: ":" }, "ui.command-line.commit");

      if (prompt === "/" || prompt === "?") {
        searchPreviewState = null;
        if (!trimmed) {
          return { handled: true };
        }
        runSearch(trimmed, prompt === "/" ? "forward" : "backward");
        return { handled: true };
      }

      if (!trimmed) {
        return { handled: true };
      }

      const [commandName = "", ...argumentParts] = trimmed.split(/\s+/);
      const value = commandName.toLowerCase();
      const commandArgument = argumentParts.join(" ").trim();

      if (value === "q" || value === "quit") {
        return { handled: true, quit: true };
      }

      if (value === "format" || value === "fmt") {
        const didFormat = await controller.formatDocument();
        context.setBottomMessage({ tone: "info", text: didFormat ? "Formatted document" : "Already formatted" });
        return { handled: true };
      }

      if (value === "w" || value === "write") {
        const targetPath = commandArgument || presentation.filePath;
        const didSave = await controller.saveDocument(targetPath);
        context.setBottomMessage({
          tone: didSave ? "info" : "error",
          text: didSave ? `Wrote ${targetPath}` : `Write failed for ${targetPath}`
        });
        return { handled: true };
      }

      if (value === "theme") {
        if (!commandArgument) {
          context.setBottomMessage({ tone: "warning", text: "Theme name required" });
          return { handled: true };
        }

        const normalizedArgument = commandArgument.toLowerCase();
        const matchedTheme =
          options.themeNames?.find((entry) => entry.toLowerCase() === normalizedArgument) ??
          options.themeNames?.find((entry) => entry.toLowerCase().startsWith(normalizedArgument)) ??
          commandArgument;

        if (!matchedTheme) {
          context.setBottomMessage({ tone: "warning", text: `Unknown theme: ${commandArgument}` });
          return { handled: true };
        }

        presentation.themeName = matchedTheme;
        context.setBottomMessage({ tone: "info", text: `Theme ${matchedTheme}` });
        context.emitPresentationUpdate("presentation.theme-name");
        return { handled: true, themeName: matchedTheme };
      }

      if (value === "code-actions" || value === "codeaction" || value === "ca") {
        await context.loadCodeActions();
        return { handled: true };
      }

      context.setBottomMessage({ tone: "warning", text: `Unknown command: ${trimmed}` });
      return { handled: true };
    }

    if (key.length === 1) {
      const nextValue = `${commandLine.value}${key}`;
      context.setCommandLineState({ ...commandLine, value: nextValue }, "ui.command-line.input");
      if (commandLine.prompt === "/" || commandLine.prompt === "?") {
        previewSearch(nextValue, commandLine.prompt === "/" ? "forward" : "backward");
      }
      return { handled: true };
    }

    return { handled: false };
  };

  const handleActiveCommandLineKey = async (
    key: string,
    options: EditorCommandLineKeyOptions = {}
  ): Promise<EditorKeyInputResult | null> => {
    const presentation = context.getPresentation();

    if (!presentation.ui.commandLine.active) {
      return null;
    }

    if (key === "Tab") {
      const completionItems = getCommandCompletionItems(presentation.ui.commandLine, options.themeNames ?? []);
      if (completionItems.length === 0) {
        return { handled: false };
      }

      const delta = options.shift ? -1 : 1;
      presentation.ui.commandCompletionIndex =
        (presentation.ui.commandCompletionIndex + delta + completionItems.length) % completionItems.length;
      const { themeName } = syncCommandPreviewTheme(options.themeNames ?? []);
      context.emitPresentationUpdate("ui.command-line.completion");
      return { handled: true, themeName };
    }

    if (key === "Enter") {
      const completionItems = getCommandCompletionItems(presentation.ui.commandLine, options.themeNames ?? []);
      const nextValue = presentation.ui.commandLine.value;
      const selectedCompletion = completionItems[presentation.ui.commandCompletionIndex];
      const shouldTakeThemeCompletion =
        !!selectedCompletion &&
        presentation.ui.commandLine.prompt === ":" &&
        /^\s*theme\s+$/i.test(nextValue);

      if (shouldTakeThemeCompletion) {
        const result = await applyCommandCompletion(options.themeNames ?? []);
        return result ?? { handled: true, themeName: presentation.themeName };
      }

      if (selectedCompletion) {
        const trimmed = nextValue.trim();
        const [commandName = "", ...argumentParts] = trimmed.split(/\s+/);
        const commandArgument = argumentParts.join(" ").trim();
        const isRunnable =
          commandName.toLowerCase() === "theme"
            ? !!commandArgument
            : ["format", "fmt", "w", "write", "code-actions", "codeaction", "ca", "q", "quit"].includes(commandName.toLowerCase());

        if (!isRunnable) {
          const result = await applyCommandCompletion(options.themeNames ?? []);
          return result ?? { handled: true, themeName: presentation.themeName };
        }
      }

      const result = await handleCommandLineKeyInput("Enter", options);
      return { ...result, themeName: result.themeName ?? presentation.themeName };
    }

    const result = await handleCommandLineKeyInput(key, options);
    if (key.length === 1 || key === "Backspace" || key === "Escape") {
      const { themeName, changed } = syncCommandPreviewTheme(options.themeNames ?? []);
      if (changed) {
        context.emitPresentationUpdate("ui.command-line.completion");
      }
      if (result.handled) {
        return { ...result, themeName: result.themeName ?? themeName };
      }
    }

    return result;
  };

  return {
    openCommandLineState,
    handleCommandLineKeyInput,
    handleActiveCommandLineKey,
    repeatSearch(reverseAgainstDirection = false) {
      const searchState = context.getSearchState();
      if (!searchState.query) {
        context.setBottomMessage({ tone: "warning", text: "No active search" });
        return false;
      }

      const baseOffset = searchState.lastMatch
        ? reverseAgainstDirection
          ? searchState.lastMatch.from - 1
          : searchState.lastMatch.to
        : undefined;

      return runSearch(searchState.query, searchState.direction, reverseAgainstDirection, baseOffset);
    },
    searchFromSelection(reverse = false) {
      const selection = getSelectionOffsets(context.getState());
      const query = escapeRegex(context.getState().doc.slice(selection.from, selection.to));

      if (!query) {
        return false;
      }

      return runSearch(query, reverse ? "backward" : "forward");
    },
    syncCommandPreviewTheme
  };
}
