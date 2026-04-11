import {
  addSurround,
  deleteSurround,
  findNextChar,
  findPrevChar,
  findTillNextChar,
  findTillPrevChar,
  gotoMatchingBracket,
  halfPageDown,
  halfPageUp,
  insertText,
  pageDown,
  pageUp,
  pasteAfter,
  replaceSurround,
  type Command,
  type EditorState
} from "@wx/editor-core";
import type { SyntaxTextobjectMode } from "@wx/editor-language";
import { buildFlashLabels } from "./flash-labels";
import { getCommandCompletionItems, hasRunnableCommandLineValue } from "./command-line";
import {
  commandForBracketPrefix,
  commandForGotoPrefix,
  commandForInsertMode,
  commandForNormalMode,
  commandForVisualMode
} from "./keymap";
import type {
  EditorBottomMessageState,
  EditorCommandLineKeyOptions,
  EditorCommandLineKeyResult,
  EditorController,
  EditorFlashHintState,
  EditorJumpEntry,
  EditorKeyInputOptions,
  EditorKeyInputResult,
  EditorPendingAction,
  EditorPickerState,
  EditorPresentationState,
  EditorRepeatableMotion
} from "./types";

export interface PickerActionItem {
  label: string;
  detail?: string;
  run: () => Promise<void> | void;
}

interface KeyRuntimeContext {
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getController(): EditorController;
  getActiveOffset(): number;
  getVisibleLineCount(): number;
  executeEditorCommand(command: Command): boolean;
  executeCommandWithCount(command: Command, options?: EditorKeyInputOptions): Promise<boolean>;
  executeCommandWithCountSync(command: Command): boolean;
  runRepeatableMotion(motion: EditorRepeatableMotion, options?: EditorKeyInputOptions): Promise<boolean>;
  recordRepeatableMotion(candidate: EditorRepeatableMotion, didChange: boolean): void;
  handleAltArrowSyntaxSelection(key: "ArrowUp" | "ArrowDown"): Promise<boolean>;
  searchFromSelection(reverse?: boolean): boolean;
  repeatSearch(reverseAgainstDirection?: boolean): boolean;
  toggleComments(mode?: "smart" | "line" | "block"): Promise<boolean>;
  navigateDiagnostic(direction: "next" | "prev", extreme?: boolean): boolean;
  navigateSyntax(direction: "next" | "prev", kind: string): Promise<boolean>;
  selectTextobjectWithFallback(mode: SyntaxTextobjectMode, object: string): Promise<boolean>;
  syncCommandPreviewTheme(themeNames?: readonly string[]): {
    themeName: string | null;
    changed: boolean;
  };
  applyCommandCompletion(themeNames?: readonly string[]): Promise<EditorKeyInputResult | null>;
  openCommandLine(prompt: ":" | "/" | "?"): void;
  handleCommandLineKeyInput(
    key: string,
    options?: EditorCommandLineKeyOptions
  ): Promise<EditorCommandLineKeyResult>;
  clearPendingCount(): void;
  setPendingActionState(next: EditorPendingAction, effectType?: string): void;
  setPendingCountState(next: string, effectType?: string): void;
  setStickyViewMode(next: boolean, effectType?: string): void;
  setPickerState(
    next: Omit<EditorPickerState, "items"> & { items: readonly PickerActionItem[] },
    effectType?: string
  ): void;
  movePicker(delta: number): boolean;
  acceptPicker(index?: number): Promise<boolean>;
  closePicker(effectType?: string): void;
  setBottomMessage(message: EditorBottomMessageState | null): void;
  clearHover(): boolean;
  restoreJump(entry: EditorJumpEntry | null): boolean;
  openDiagnosticsPicker(): boolean;
  openJumpListPicker(): boolean;
  loadCodeActions(): Promise<boolean>;
  collectVisibleFlashHints(target: string): readonly EditorFlashHintState[];
  applyFlashJump(targetOffset: number): void;
  clearFlashState(effectType?: string | null): boolean;
  emitPresentationUpdate(effectType?: string): void;
}

export interface KeyRuntime {
  handleKeyInput(input: Parameters<EditorController["handleKeyInput"]>[0], options?: EditorKeyInputOptions): Promise<EditorKeyInputResult>;
  handleTextInput(text: string, options?: EditorKeyInputOptions): Promise<EditorKeyInputResult>;
  repeatSearch(reverseAgainstDirection?: boolean): boolean;
  beginFlashTarget(): void;
  handleFlashKey(key: string): boolean;
}

export function createKeyRuntime(context: KeyRuntimeContext): KeyRuntime {
  const beginFlashTarget = () => {
    context.setPendingActionState({ kind: "flash-target" }, "flash.pending");
  };

  const handleFlashKey = (key: string): boolean => {
    const presentation = context.getPresentation();
    const state = context.getState();

    if (presentation.ui.flash.active) {
      if (key === "Escape" || key === "Backspace") {
        context.clearFlashState("flash.cancel");
        return true;
      }

      if (!/^[a-z]$/i.test(key)) {
        context.clearFlashState("flash.cancel");
        return true;
      }

      const matchingHints = presentation.ui.flash.hints.filter((hint) => hint.label === key.toLowerCase());

      if (matchingHints.length === 0) {
        return true;
      }

      if (matchingHints.length === 1) {
        context.applyFlashJump(matchingHints[0]!.offset);
        return true;
      }

      const nextTarget = key.toLowerCase();
      const labels = buildFlashLabels(nextTarget, matchingHints.length);
      presentation.ui.flash = {
        ...presentation.ui.flash,
        input: `${presentation.ui.flash.input}${nextTarget}`,
        hints: matchingHints.map((hint, index) => ({
          offset: hint.offset,
          label: labels[index] ?? labels[0] ?? nextTarget
        }))
      };
      context.emitPresentationUpdate("flash.narrow");
      return true;
    }

    if (presentation.ui.pendingAction?.kind !== "flash-target") {
      return false;
    }

    presentation.ui.pendingAction = null;

    if (key === "Escape") {
      context.emitPresentationUpdate("flash.cancel");
      return true;
    }

    if (!/^[a-z]$/i.test(key)) {
      context.emitPresentationUpdate("flash.cancel");
      return false;
    }

    const hints = context.collectVisibleFlashHints(key);

    if (hints.length === 0) {
      context.setBottomMessage({ tone: "warning", text: `No visible '${key}' targets` });
      return true;
    }

    presentation.ui.flash = {
      active: true,
      target: key,
      input: "",
      hints
    };
    context.setBottomMessage(null);
    context.emitPresentationUpdate("flash.start");
    return true;
  };

  const handleKeyInput: KeyRuntime["handleKeyInput"] = async (input, options = {}) => {
    const state = context.getState();
    const presentation = context.getPresentation();
    const controller = context.getController();
    const key = input.key;
    const ctrl = !!input.ctrl;
    const alt = !!input.alt;
    const meta = !!input.meta;
    const shift = !!input.shift;

    if (presentation.ui.flash.active || presentation.ui.pendingAction?.kind === "flash-target") {
      const handled = handleFlashKey(key);
      if (handled) {
        return { handled: true };
      }
    }

    if (presentation.ui.picker.active) {
      if (key === "Escape") {
        context.closePicker("ui.picker.close");
        return { handled: true };
      }

      if (key === "ArrowLeft" || key === "h" || key === "ArrowUp" || key === "k") {
        context.movePicker(-1);
        return { handled: true };
      }

      if (key === "ArrowRight" || key === "l" || key === "ArrowDown" || key === "j") {
        context.movePicker(1);
        return { handled: true };
      }

      if (key === "Enter") {
        await context.acceptPicker();
        return { handled: true };
      }

      if (/^[1-9]$/.test(key)) {
        await context.acceptPicker(Number(key) - 1);
        return { handled: true };
      }

      return { handled: false };
    }

    if (presentation.ui.commandLine.active) {
      if (key === "Tab") {
        const completionItems = getCommandCompletionItems(presentation.ui.commandLine, options.themeNames ?? []);
        if (completionItems.length === 0) {
          return { handled: false };
        }

        const delta = shift ? -1 : 1;
        presentation.ui.commandCompletionIndex =
          (presentation.ui.commandCompletionIndex + delta + completionItems.length) % completionItems.length;
        const { themeName } = context.syncCommandPreviewTheme(options.themeNames ?? []);
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
          const result = await context.applyCommandCompletion(options.themeNames ?? []);
          return result ?? { handled: true, themeName: presentation.themeName };
        }

        if (selectedCompletion && !hasRunnableCommandLineValue(nextValue, options.themeNames ?? [])) {
          const result = await context.applyCommandCompletion(options.themeNames ?? []);
          return result ?? { handled: true, themeName: presentation.themeName };
        }

        const result = await context.handleCommandLineKeyInput("Enter", options);
        return { ...result, themeName: result.themeName ?? presentation.themeName };
      }

      const result = await context.handleCommandLineKeyInput(key, options);
      if (key.length === 1 || key === "Backspace" || key === "Escape") {
        const { themeName, changed } = context.syncCommandPreviewTheme(options.themeNames ?? []);
        if (changed) {
          context.emitPresentationUpdate("ui.command-line.completion");
        }
        if (result.handled) {
          return { ...result, themeName: result.themeName ?? themeName };
        }
      }
      return result;
    }

    if (presentation.ui.hover.active && key === "Escape") {
      context.clearHover();
      context.clearPendingCount();
      return { handled: true };
    }

    if (presentation.ui.stickyViewMode && (state.mode === "normal" || state.mode === "visual")) {
      if (key === "Escape") {
        context.setStickyViewMode(false);
        return { handled: true };
      }

      if (key === "j" || key === "ArrowDown") {
        controller.scrollViewportBy(1);
        return { handled: true };
      }

      if (key === "k" || key === "ArrowUp") {
        controller.scrollViewportBy(-1);
        return { handled: true };
      }
    }

    if (alt && !meta && !ctrl && state.mode !== "insert" && (key === "ArrowUp" || key === "ArrowDown")) {
      return { handled: await context.handleAltArrowSyntaxSelection(key) };
    }

    if (alt && !meta && !ctrl && state.mode !== "insert" && key === ".") {
      if (!presentation.ui.lastRepeatableMotion) {
        return { handled: false };
      }

      await context.runRepeatableMotion(presentation.ui.lastRepeatableMotion, options);
      return { handled: true };
    }

    if (alt && !meta && !ctrl && state.mode !== "insert" && key === "*") {
      context.searchFromSelection(true);
      return { handled: true };
    }

    if (ctrl && !meta && !alt && state.mode === "insert" && key === "s") {
      controller.execute((_state, _dispatch, commandContext) => commandContext.history?.checkpoint?.() ?? false);
      return { handled: true };
    }

    if (ctrl && !meta && !alt && state.mode === "insert" && key === "r") {
      context.setPendingActionState({ kind: "register-select", insert: true });
      return { handled: true };
    }

    if (ctrl && !meta && !alt && state.mode !== "insert" && key === "s") {
      controller.pushJump();
      context.setBottomMessage({ tone: "info", text: "Saved jump" });
      return { handled: true };
    }

    if (ctrl && !meta && !alt && state.mode !== "insert" && key === "o") {
      context.restoreJump(controller.jumpBackward());
      return { handled: true };
    }

    if (ctrl && !meta && !alt && state.mode !== "insert" && key === "i") {
      context.restoreJump(controller.jumpForward());
      return { handled: true };
    }

    if (ctrl && !meta && !alt && (state.mode !== "insert" || presentation.ui.stickyViewMode) && ["b", "d", "f", "u"].includes(key)) {
      if (presentation.ui.stickyViewMode) {
        const delta =
          key === "b"
            ? -(Math.max(1, context.getVisibleLineCount() - 1))
            : key === "f"
              ? Math.max(1, context.getVisibleLineCount() - 1)
              : key === "u"
                ? -Math.max(1, Math.floor(context.getVisibleLineCount() / 2))
                : Math.max(1, Math.floor(context.getVisibleLineCount() / 2));
        controller.scrollViewportBy(delta);
        return { handled: true };
      }

      const command = key === "b" ? pageUp : key === "f" ? pageDown : key === "u" ? halfPageUp : halfPageDown;
      context.executeCommandWithCountSync(command);
      return { handled: true };
    }

    if (presentation.ui.pendingAction) {
      const nextPending = presentation.ui.pendingAction;

      if (key === "Escape") {
        if (nextPending.kind === "flash-target") {
          handleFlashKey("Escape");
        } else {
          context.setPendingActionState(null);
        }
        context.clearPendingCount();
        return { handled: true };
      }

      if (nextPending.kind !== "flash-target") {
        context.setPendingActionState(null);
      }

      if (nextPending.kind === "g") {
        if (key === "c") {
          await context.toggleComments("line");
          return { handled: true };
        }

        const chordCommand = commandForGotoPrefix(key);
        if (chordCommand) {
          context.executeCommandWithCountSync(chordCommand);
          return { handled: true };
        }
      }

      if (nextPending.kind === "[" || nextPending.kind === "]") {
        if (key === "d" || key === "D") {
          context.navigateDiagnostic(nextPending.kind === "]" ? "next" : "prev", key === "D");
          return { handled: true };
        }

        if (["f", "t", "a", "c", "T", "g", "x"].includes(key)) {
          await context.navigateSyntax(nextPending.kind === "]" ? "next" : "prev", key);
          return { handled: true };
        }

        const chordCommand = commandForBracketPrefix(nextPending.kind, key);
        if (chordCommand) {
          const previousRevision = state.revision;
          context.executeCommandWithCountSync(chordCommand);
          context.recordRepeatableMotion(
            { kind: "paragraph", direction: nextPending.kind === "]" ? "next" : "prev" },
            context.getState().revision !== previousRevision
          );
          return { handled: true };
        }
      }

      if (nextPending.kind === "m") {
        if (key === "m") {
          const previousRevision = state.revision;
          context.executeEditorCommand(gotoMatchingBracket);
          context.recordRepeatableMotion({ kind: "matching-bracket" }, context.getState().revision !== previousRevision);
          return { handled: true };
        }

        if (key === "a" || key === "i") {
          context.setPendingActionState({ kind: "textobject", mode: key === "a" ? "around" : "inside" });
          return { handled: true };
        }

        if (key === "s") {
          context.setPendingActionState({ kind: "surround-add" });
          return { handled: true };
        }

        if (key === "d") {
          context.setPendingActionState({ kind: "surround-delete" });
          return { handled: true };
        }

        if (key === "r") {
          context.setPendingActionState({ kind: "surround-replace-from" });
          return { handled: true };
        }
      }

      if (nextPending.kind === "space") {
        if (!ctrl && !meta && key.toLowerCase() === "c") {
          await context.toggleComments(alt ? "line" : shift ? "block" : "smart");
          return { handled: true };
        }

        if (key === "a") {
          await context.loadCodeActions();
          return { handled: true };
        }

        if (key === "d") {
          context.openDiagnosticsPicker();
          return { handled: true };
        }

        if (key === "j") {
          context.openJumpListPicker();
          return { handled: true };
        }

        if (key === "k") {
          const hoverOffset = context.getActiveOffset();
          const activeDiagnostic =
            presentation.language.diagnostics.find((entry) => hoverOffset >= entry.from && hoverOffset < entry.to) ?? null;

          if (activeDiagnostic) {
            controller.showDiagnosticHover(activeDiagnostic, { pinned: true });
            return { handled: true };
          }

          await controller.requestHoverAt(hoverOffset, { pinned: true });
          return { handled: true };
        }
      }

      if (nextPending.kind === "find") {
        const previousRevision = state.revision;
        context.executeEditorCommand(
          nextPending.variant === "f"
            ? findNextChar(key)
            : nextPending.variant === "F"
              ? findPrevChar(key)
              : nextPending.variant === "t"
                ? findTillNextChar(key)
                : findTillPrevChar(key)
        );
        context.recordRepeatableMotion(
          { kind: "find", variant: nextPending.variant, target: key },
          context.getState().revision !== previousRevision
        );
        return { handled: true };
      }

      if (nextPending.kind === "textobject") {
        const previousRevision = state.revision;
        const didRun = await context.selectTextobjectWithFallback(nextPending.mode, key);
        context.recordRepeatableMotion(
          { kind: "textobject", mode: nextPending.mode, object: key },
          didRun || context.getState().revision !== previousRevision
        );
        return { handled: true };
      }

      if (nextPending.kind === "surround-add") {
        context.executeEditorCommand(addSurround(key));
        return { handled: true };
      }

      if (nextPending.kind === "surround-delete") {
        context.executeEditorCommand(deleteSurround(key));
        return { handled: true };
      }

      if (nextPending.kind === "surround-replace-from") {
        context.setPendingActionState({ kind: "surround-replace-to", fromObject: key });
        return { handled: true };
      }

      if (nextPending.kind === "surround-replace-to") {
        context.executeEditorCommand(replaceSurround(nextPending.fromObject, key));
        return { handled: true };
      }

      if (nextPending.kind === "register-select") {
        if (nextPending.insert && state.mode === "insert") {
          const value = key === "+" ? (await options.readClipboardText?.()) ?? null : controller.getRegister(key);
          controller.selectRegister(null);

          if (!value) {
            context.setBottomMessage({ tone: "warning", text: `Register ${key} is empty` });
            return { handled: true };
          }

          context.executeEditorCommand(insertText(value));
        } else {
          controller.selectRegister(key);
          context.setBottomMessage({ tone: "info", text: `Register "${key}" selected` });
        }
        return { handled: true };
      }

      if (nextPending.kind === "z") {
        if (key === "Escape") {
          context.setStickyViewMode(false);
          return { handled: true };
        }

        if (key === "z" || key === "c" || key === "m") {
          controller.alignViewportToSelection("center");
        } else if (key === "t") {
          controller.alignViewportToSelection("top");
        } else if (key === "b") {
          controller.alignViewportToSelection("bottom");
        } else if (key === "j") {
          controller.scrollViewportBy(1);
        } else if (key === "k") {
          controller.scrollViewportBy(-1);
        }

        if (!nextPending.sticky) {
          context.setStickyViewMode(false);
        }
        return { handled: true };
      }
    }

    if (meta || ctrl || alt) {
      return { handled: false };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === ":") {
      context.clearPendingCount();
      context.openCommandLine(":");
      const { themeName, changed } = context.syncCommandPreviewTheme(options.themeNames ?? []);
      if (changed) {
        context.emitPresentationUpdate("ui.command-line.completion");
      }
      return { handled: true, themeName };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "/") {
      context.clearPendingCount();
      context.openCommandLine("/");
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "?") {
      context.clearPendingCount();
      context.openCommandLine("?");
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "\"") {
      context.setPendingActionState({ kind: "register-select", insert: false });
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && /^[0-9]$/.test(key) && !(presentation.ui.pendingCount === "" && key === "0")) {
      context.setPendingCountState(`${presentation.ui.pendingCount}${key}`);
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === " ") {
      context.setPendingActionState({ kind: "space" });
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === ",") {
      beginFlashTarget();
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "z") {
      context.setStickyViewMode(false);
      context.setPendingActionState({ kind: "z", sticky: false });
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "Z") {
      context.setStickyViewMode(true);
      context.setPendingActionState({ kind: "z", sticky: true });
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "n") {
      context.repeatSearch(false);
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "N") {
      context.repeatSearch(true);
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "*") {
      context.searchFromSelection(false);
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "g") {
      context.setPendingActionState({ kind: "g" });
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && (key === "[" || key === "]")) {
      context.setPendingActionState({ kind: key });
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && key === "m") {
      context.setPendingActionState({ kind: "m" });
      return { handled: true };
    }

    if ((state.mode === "normal" || state.mode === "visual") && ["f", "F", "t", "T"].includes(key)) {
      context.setPendingActionState({ kind: "find", variant: key as "f" | "F" | "t" | "T" });
      return { handled: true };
    }

    const command =
      state.mode === "normal"
        ? commandForNormalMode(key)
        : state.mode === "visual"
          ? commandForVisualMode(key)
          : commandForInsertMode(key);

    if (!command) {
      return { handled: false };
    }

    if (command === pasteAfter && controller.getSelectedRegister() === "+" && options.readClipboardText) {
      await context.executeCommandWithCount(command, options);
    } else {
      context.executeCommandWithCountSync(command);
    }
    return { handled: true };
  };

  const handleTextInput: KeyRuntime["handleTextInput"] = async (text, options = {}) => {
    let handled = false;
    let themeName: string | null | undefined;
    let quit = false;

    for (const char of text) {
      const result = await handleKeyInput({ key: char, text: char }, options);
      handled = handled || result.handled;
      if (result.themeName !== undefined) {
        themeName = result.themeName;
      }
      quit = quit || !!result.quit;
    }

    return { handled, themeName, quit };
  };

  return {
    handleKeyInput,
    handleTextInput,
    repeatSearch(reverseAgainstDirection = false) {
      return context.repeatSearch(reverseAgainstDirection);
    },
    beginFlashTarget,
    handleFlashKey
  };
}
