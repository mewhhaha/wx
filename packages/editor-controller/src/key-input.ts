import type { EditorKeyInputOptions } from "./types";

import { createFlashKeyRuntime } from "./key-flash";
import { handleDirectKey } from "./key-direct";
import { handlePickerKey } from "./key-picker";
import { handlePendingActionKey } from "./key-prefix";
import type { KeyRuntime, KeyRuntimeContext } from "./key-runtime-types";

export type { KeyRuntime } from "./key-runtime-types";
export type { PickerActionItem } from "./key-runtime-types";

export function createKeyRuntime(context: KeyRuntimeContext): KeyRuntime {
  const flashRuntime = createFlashKeyRuntime(context);

  const handleKeyInput: KeyRuntime["handleKeyInput"] = async (input, options: EditorKeyInputOptions = {}) => {
    const state = context.getState();
    const presentation = context.getPresentation();
    const key = input.key;
    const ctrl = !!input.ctrl;
    const alt = !!input.alt;
    const meta = !!input.meta;
    const shift = !!input.shift;

    if (presentation.ui.flash.active || presentation.ui.pendingAction?.kind === "flash-target") {
      const handled = flashRuntime.handleFlashKey(key);
      if (handled) {
        return { handled: true };
      }
    }

    if (presentation.ui.completion.active) {
      if (key === "Escape") {
        context.dismissCompletion();
        return { handled: true };
      }

      if (key === "ArrowUp" || (key === "Tab" && shift)) {
        return { handled: context.moveCompletion(-1) };
      }

      if (key === "ArrowDown" || key === "Tab") {
        return { handled: context.moveCompletion(1) };
      }

      if (key === "Enter") {
        return { handled: await context.acceptCompletion() };
      }
    }

    if (presentation.ui.picker.active) {
      return { handled: await handlePickerKey(context, key) };
    }

    if (presentation.ui.commandLine.active) {
      return (
        (await context.handleActiveCommandLineKey(key, { ...options, shift })) ??
        { handled: false }
      );
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
        context.getController().scrollViewportBy(1);
        return { handled: true };
      }

      if (key === "k" || key === "ArrowUp") {
        context.getController().scrollViewportBy(-1);
        return { handled: true };
      }
    }

    if (presentation.ui.pendingAction) {
      const result = await handlePendingActionKey(
        context,
        flashRuntime,
        { key, ctrl, alt, meta, shift },
        options
      );
      if (result) {
        return result;
      }
    }

    return (
      (await handleDirectKey(
        context,
        flashRuntime,
        { key, ctrl, alt, meta, shift },
        options,
        { beginFlashTarget: flashRuntime.beginFlashTarget }
      )) ?? { handled: false }
    );
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
    beginFlashTarget: flashRuntime.beginFlashTarget,
    handleFlashKey: flashRuntime.handleFlashKey
  };
}
