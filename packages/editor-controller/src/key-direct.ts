import {
  halfPageDown,
  halfPageUp,
  pageDown,
  pageUp,
  pasteAfter,
  type Command
} from "@mewhhaha/wx-core";

import {
  commandForInsertMode,
  commandForNormalMode,
  commandForVisualMode
} from "./keymap";
import { getQuestionActionItems } from "./command-line";
import type { FlashKeyRuntime } from "./key-flash";
import type { EditorKeyInputOptions, EditorKeyInputResult } from "./types";
import type { KeyRuntimeContext } from "./key-runtime-types";

interface DirectKeyInput {
  key: string;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  shift: boolean;
}

interface DirectKeyHelpers {
  beginFlashTarget(): void;
}

export async function handleDirectKey(
  context: KeyRuntimeContext,
  _flashRuntime: FlashKeyRuntime,
  input: DirectKeyInput,
  options: EditorKeyInputOptions,
  helpers: DirectKeyHelpers
): Promise<EditorKeyInputResult | null> {
  const state = context.getState();
  const presentation = context.getPresentation();
  const controller = context.getController();

  if (input.alt && !input.meta && !input.ctrl && state.mode !== "insert" && (input.key === "ArrowUp" || input.key === "ArrowDown")) {
    return { handled: await context.handleAltArrowSyntaxSelection(input.key) };
  }

  if (input.alt && !input.meta && !input.ctrl && state.mode !== "insert" && input.key === ".") {
    if (!presentation.ui.lastRepeatableMotion) {
      return { handled: false };
    }

    await context.runRepeatableMotion(presentation.ui.lastRepeatableMotion, options);
    return { handled: true };
  }

  if (input.alt && !input.meta && !input.ctrl && state.mode !== "insert" && input.key === "*") {
    context.searchFromSelection(true);
    return { handled: true };
  }

  if (input.alt && !input.meta && !input.ctrl && state.mode !== "insert" && input.key === "/") {
    await context.toggleComments("smart");
    return { handled: true };
  }

  if (input.alt && !input.meta && !input.ctrl && state.mode !== "insert" && input.key.toLowerCase() === "k") {
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

  if (input.alt && !input.meta && !input.ctrl && state.mode !== "insert" && input.key.toLowerCase() === "g") {
    return { handled: await context.gotoTarget(input.shift ? "references" : "definition") };
  }

  if (input.alt && !input.meta && !input.ctrl && state.mode !== "insert" && input.key.toLowerCase() === "r") {
    context.openCommandLine(":");
    await context.getController().handleTextInput("rename ");
    return { handled: true };
  }

  if (input.ctrl && !input.meta && !input.alt && input.key === " ") {
    return { handled: await context.requestCompletion() };
  }

  if (input.ctrl && !input.meta && !input.alt && input.key === "p") {
    return { handled: await context.openFileSearchPicker() };
  }

  if (!input.ctrl && !input.meta && !input.alt && input.key === "F2") {
    context.openCommandLine(":");
    await context.getController().handleTextInput("rename ");
    return { handled: true };
  }

  if (input.ctrl && !input.meta && !input.alt && state.mode === "insert" && input.key === "s") {
    controller.execute((_state, _dispatch, commandContext) => commandContext.history?.checkpoint?.() ?? false);
    return { handled: true };
  }

  if (input.ctrl && !input.meta && !input.alt && state.mode === "insert" && input.key === "r") {
    context.setPendingActionState({ kind: "register-select", insert: true });
    return { handled: true };
  }

  if (input.ctrl && !input.meta && !input.alt && state.mode !== "insert" && input.key === "s") {
    controller.pushJump();
    context.setBottomMessage({ tone: "info", text: "Saved jump" });
    return { handled: true };
  }

  if (input.ctrl && !input.meta && !input.alt && state.mode !== "insert" && input.key === "o") {
    context.restoreJump(controller.jumpBackward());
    return { handled: true };
  }

  if (input.ctrl && !input.meta && !input.alt && state.mode !== "insert" && input.key === "i") {
    context.restoreJump(controller.jumpForward());
    return { handled: true };
  }

  if (input.ctrl && !input.meta && !input.alt && state.mode !== "insert" && input.key === ".") {
    await context.loadCodeActions();
    return { handled: true };
  }

  if (input.ctrl && !input.meta && !input.alt && (state.mode === "normal" || state.mode === "visual") && input.key === "w") {
    context.setPendingActionState({ kind: "ctrl-w" });
    return { handled: true };
  }

  if (
    input.ctrl &&
    !input.meta &&
    !input.alt &&
    (state.mode !== "insert" || presentation.ui.stickyViewMode) &&
    ["b", "d", "f", "u"].includes(input.key)
  ) {
    if (presentation.ui.stickyViewMode) {
      const delta =
        input.key === "b"
          ? -(Math.max(1, context.getVisibleLineCount() - 1))
          : input.key === "f"
            ? Math.max(1, context.getVisibleLineCount() - 1)
            : input.key === "u"
              ? -Math.max(1, Math.floor(context.getVisibleLineCount() / 2))
              : Math.max(1, Math.floor(context.getVisibleLineCount() / 2));
      controller.scrollViewportBy(delta);
      return { handled: true };
    }

    const command = input.key === "b" ? pageUp : input.key === "f" ? pageDown : input.key === "u" ? halfPageUp : halfPageDown;
    context.executeCommandWithCountSync(command);
    return { handled: true };
  }

  if (input.meta || input.ctrl || input.alt) {
    return { handled: false };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === ":") {
    context.clearPendingCount();
    context.openCommandLine(":");
    const { themeName, changed } = context.syncCommandPreviewTheme(options.themeNames ?? []);
    if (changed) {
      context.emitPresentationUpdate("ui.command-line.completion");
    }
    return { handled: true, themeName };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "/") {
    context.clearPendingCount();
    context.openCommandLine("/");
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "?") {
    context.clearPendingCount();
    context.setPendingActionState({ kind: "?" });
    context.setCommandCompletions(getQuestionActionItems(), 0, "ui.pending-action.help");
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "\"") {
    context.setPendingActionState({ kind: "register-select", insert: false });
    return { handled: true };
  }

  if (
    (state.mode === "normal" || state.mode === "visual") &&
    /^[0-9]$/.test(input.key) &&
    !(presentation.ui.pendingCount === "" && input.key === "0")
  ) {
    context.setPendingCountState(`${presentation.ui.pendingCount}${input.key}`);
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === " ") {
    helpers.beginFlashTarget();
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "z") {
    context.setStickyViewMode(false);
    context.setPendingActionState({ kind: "z", sticky: false });
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "Z") {
    context.setStickyViewMode(true);
    context.setPendingActionState({ kind: "z", sticky: true });
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "n") {
    context.repeatSearch(false);
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "N") {
    context.repeatSearch(true);
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "*") {
    context.searchFromSelection(false);
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "g") {
    context.setPendingActionState({ kind: "g" });
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && (input.key === "[" || input.key === "]")) {
    context.setPendingActionState({ kind: input.key });
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && input.key === "m") {
    context.setPendingActionState({ kind: "m" });
    return { handled: true };
  }

  if ((state.mode === "normal" || state.mode === "visual") && ["f", "F", "t", "T"].includes(input.key)) {
    context.setPendingActionState({ kind: "find", variant: input.key as "f" | "F" | "t" | "T" });
    return { handled: true };
  }

  const command: Command | null =
    state.mode === "normal"
      ? commandForNormalMode(input.key)
      : state.mode === "visual"
        ? commandForVisualMode(input.key)
        : commandForInsertMode(input.key);

  if (!command) {
    return { handled: false };
  }

  if (command === pasteAfter && controller.getSelectedRegister() === "+" && options.readClipboardText) {
    await context.executeCommandWithCount(command, options);
  } else {
    context.executeCommandWithCountSync(command);
  }

  return { handled: true };
}
