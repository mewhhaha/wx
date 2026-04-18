import type { EditorState } from "@wx/editor-core";
import type { EditorPendingAction } from "@wx/editor-controller";

export function keyboardInputForEvent(event: KeyboardEvent) {
  return {
    key: event.key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
    shift: event.shiftKey,
    text: event.key.length === 1 ? event.key : undefined,
    source: "dom" as const
  };
}

export function isControllerHandledModifierKey(
  event: KeyboardEvent,
  options: {
    state: EditorState;
    commandLineActive: boolean;
    pickerActive: boolean;
    pendingAction: EditorPendingAction;
  }
): boolean {
  if (event.metaKey && !event.ctrlKey && !event.altKey) {
    return false;
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    return (
      options.state.mode !== "insert" &&
      (event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "." ||
        event.key === "*" ||
        event.key === "/" ||
        event.key.toLowerCase() === "g" ||
        event.key.toLowerCase() === "r" ||
        event.key.toLowerCase() === "k")
    );
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey) {
    return [" ", "s", "r", "o", "i", "b", "d", "f", "u", "."].includes(event.key);
  }

  return false;
}

export function isBrowserPasteShortcut(
  event: KeyboardEvent,
  options: {
    state: EditorState;
    commandLineActive: boolean;
    pickerActive: boolean;
  }
): boolean {
  return (
    options.state.mode === "insert" &&
    !options.commandLineActive &&
    !options.pickerActive &&
    !event.altKey &&
    ((event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "v") ||
      (event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "v"))
  );
}

export function shouldRouteKeydown(
  event: KeyboardEvent,
  options: {
    state: EditorState;
    commandLineActive: boolean;
    pickerActive: boolean;
    completionActive: boolean;
    flashActive: boolean;
    pendingAction: EditorPendingAction;
    stickyViewMode: boolean;
    hoverActive: boolean;
  }
): boolean {
  const hasCommandState =
    options.flashActive ||
    options.commandLineActive ||
    options.pickerActive ||
    options.completionActive ||
    !!options.pendingAction ||
    options.stickyViewMode ||
    options.hoverActive;
  const plainEditorKey = !event.metaKey && !event.ctrlKey && !event.altKey;

  return (
    hasCommandState ||
    plainEditorKey ||
    isControllerHandledModifierKey(event, {
      state: options.state,
      commandLineActive: options.commandLineActive,
      pickerActive: options.pickerActive,
      pendingAction: options.pendingAction
    })
  );
}
