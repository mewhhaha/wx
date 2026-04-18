import type { EditorState, SelectionSet, Transaction } from "@wx/editor-core";
import type { EditorDiagnostic } from "@wx/editor-language";

import type {
  EditorBottomMessageState,
  EditorCommandCompletionItem,
  EditorCommandLineState,
  EditorJumpEntry,
  EditorPendingAction,
  EditorPresentationState,
  EditorRepeatableMotion
} from "./types";

export function selectionEquals(left: SelectionSet, right: SelectionSet): boolean {
  if (left.primaryIndex !== right.primaryIndex || left.ranges.length !== right.ranges.length) {
    return false;
  }

  return left.ranges.every((range, index) => {
    const other = right.ranges[index];
    return (
      !!other &&
      range.anchor === other.anchor &&
      range.head === other.head &&
      range.preferredColumn === other.preferredColumn
    );
  });
}

export function jumpEntryEquals(left: EditorJumpEntry, right: EditorJumpEntry): boolean {
  return left.mode === right.mode && selectionEquals(left.selection, right.selection);
}

export function createJumpEntry(state: EditorState): EditorJumpEntry {
  return {
    selection: state.selection,
    mode: state.mode
  };
}

export function normalizeRegisterName(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }

  return name.toLowerCase();
}

export function transactionRequiresFullDocumentLanguageSync(transaction: Transaction): boolean {
  if ((transaction.changes?.length ?? 0) > 0) {
    return false;
  }

  return (transaction.effects ?? []).some((effect) => {
    return effect.type === "controller.replace-state" || effect.type.startsWith("history.");
  });
}

interface CreateSessionRuntimeOptions {
  presentation: EditorPresentationState;
  emitPresentationUpdate(effectType?: string): void;
}

export interface SessionRuntime {
  setBottomMessageValue(message: EditorBottomMessageState | null): boolean;
  setBottomMessage(message: EditorBottomMessageState | null, effectType?: string): void;
  clearHoverState(options?: {
    preservePinned?: boolean;
    effectType?: string | null;
    invalidateRequest?: boolean;
  }): boolean;
  showHoverState(
    next: EditorPresentationState["ui"]["hover"],
    options?: {
      effectType?: string;
      clearBottomMessage?: boolean;
      invalidateRequest?: boolean;
    }
  ): boolean;
  hoverToneForDiagnostic(severity: EditorDiagnostic["severity"]): "info" | "warning" | "error";
  setCommandLineState(next: EditorCommandLineState, effectType?: string): void;
  setCommandCompletions(next: readonly EditorCommandCompletionItem[], index?: number, effectType?: string): void;
  setCommandCompletionIndex(next: number, effectType?: string): void;
  setCompletionState(next: EditorPresentationState["ui"]["completion"], effectType?: string): void;
  setRenameState(next: EditorPresentationState["ui"]["rename"], effectType?: string): void;
  setPendingActionState(next: EditorPendingAction, effectType?: string): void;
  setPendingCountState(next: string, effectType?: string): void;
  clearPendingCount(): void;
  readPendingCount(): number;
  setStickyViewMode(next: boolean, effectType?: string): void;
  setLastRepeatableMotion(next: EditorRepeatableMotion | null, effectType?: string): void;
  setPreviewThemeName(next: string | null, effectType?: string): void;
  clearFlashState(effectType?: string | null): boolean;
}

function repeatableMotionEquals(
  left: EditorRepeatableMotion | null,
  right: EditorRepeatableMotion | null
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right || left.kind !== right.kind) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

export function createSessionRuntime(options: CreateSessionRuntimeOptions): SessionRuntime {
  const { presentation, emitPresentationUpdate } = options;

  const hoverStateEquals = (
    left: EditorPresentationState["ui"]["hover"],
    right: EditorPresentationState["ui"]["hover"]
  ) =>
    left.active === right.active &&
    left.pinned === right.pinned &&
    left.offset === right.offset &&
    left.content === right.content &&
    left.source === right.source &&
    left.tone === right.tone;

  const setHoverStateValue = (next: EditorPresentationState["ui"]["hover"]) => {
    if (hoverStateEquals(presentation.ui.hover, next)) {
      return false;
    }

    presentation.ui.hover = next;
    return true;
  };

  const setBottomMessageValue = (message: EditorBottomMessageState | null) => {
    const current = presentation.ui.bottomMessage;

    if (current?.tone === message?.tone && current?.text === message?.text && (!!current === !!message)) {
      return false;
    }

    presentation.ui.bottomMessage = message;
    return true;
  };

  const setPendingCountState = (next: string, effectType = "ui.pending-count") => {
    if (presentation.ui.pendingCount === next) {
      return;
    }

    presentation.ui.pendingCount = next;
    emitPresentationUpdate(effectType);
  };

  const completionStateEquals = (
    left: EditorPresentationState["ui"]["completion"],
    right: EditorPresentationState["ui"]["completion"]
  ) =>
    left.active === right.active &&
    left.loading === right.loading &&
    left.anchorOffset === right.anchorOffset &&
    left.selectedIndex === right.selectedIndex &&
    left.error === right.error &&
    left.items.length === right.items.length &&
    left.items.every(
      (item, index) =>
        item.label === right.items[index]?.label &&
        item.detail === right.items[index]?.detail &&
        item.kind === right.items[index]?.kind &&
        item.documentation === right.items[index]?.documentation &&
        item.insertText === right.items[index]?.insertText &&
        item.selected === right.items[index]?.selected
    );

  const renameStateEquals = (
    left: EditorPresentationState["ui"]["rename"],
    right: EditorPresentationState["ui"]["rename"]
  ) =>
    left.active === right.active &&
    left.anchorOffset === right.anchorOffset &&
    left.value === right.value &&
    left.error === right.error;

  return {
    setBottomMessageValue,
    setBottomMessage(message, effectType = "ui.bottom-message") {
      if (!setBottomMessageValue(message)) {
        return;
      }

      emitPresentationUpdate(effectType);
    },
    clearHoverState(runtimeOptions = {}) {
      if (runtimeOptions.preservePinned && presentation.ui.hover.pinned) {
        return false;
      }

      if (runtimeOptions.invalidateRequest !== false) {
        presentation.language.hoverRequestId += 1;
      }

      const changed = setHoverStateValue({
        active: false,
        pinned: false,
        offset: null,
        content: "",
        tone: "info"
      });

      if (changed && runtimeOptions.effectType !== null) {
        emitPresentationUpdate(runtimeOptions.effectType ?? "ui.hover.clear");
      }

      return changed;
    },
    showHoverState(next, runtimeOptions = {}) {
      if (runtimeOptions.invalidateRequest) {
        presentation.language.hoverRequestId += 1;
      }

      const hoverChanged = setHoverStateValue(next);
      const bottomMessageChanged = runtimeOptions.clearBottomMessage ? setBottomMessageValue(null) : false;

      if (hoverChanged || bottomMessageChanged) {
        emitPresentationUpdate(runtimeOptions.effectType ?? "ui.hover");
      }

      return hoverChanged || bottomMessageChanged;
    },
    hoverToneForDiagnostic(severity) {
      return severity === "error" ? "error" : severity === "warning" ? "warning" : "info";
    },
    setCommandLineState(next, effectType = "ui.command-line") {
      const current = presentation.ui.commandLine;
      if (current.active === next.active && current.value === next.value && current.prompt === next.prompt) {
        return;
      }

      presentation.ui.commandLine = next;
      emitPresentationUpdate(effectType);
    },
    setCommandCompletions(next, index = 0, effectType = "ui.command-completion") {
      const currentItems = presentation.ui.commandCompletionItems;
      const nextIndex = next.length === 0 ? 0 : Math.max(0, Math.min(next.length - 1, index));
      const itemsChanged =
        currentItems.length !== next.length ||
        currentItems.some((item, itemIndex) => item.label !== next[itemIndex]?.label || item.detail !== next[itemIndex]?.detail);
      const indexChanged = presentation.ui.commandCompletionIndex !== nextIndex;

      if (!itemsChanged && !indexChanged) {
        return;
      }

      presentation.ui.commandCompletionItems = [...next];
      presentation.ui.commandCompletionIndex = nextIndex;
      emitPresentationUpdate(effectType);
    },
    setCommandCompletionIndex(next, effectType = "ui.command-completion-index") {
      if (presentation.ui.commandCompletionIndex === next) {
        return;
      }

      presentation.ui.commandCompletionIndex = next;
      emitPresentationUpdate(effectType);
    },
    setCompletionState(next, effectType = "ui.completion") {
      if (completionStateEquals(presentation.ui.completion, next)) {
        return;
      }

      presentation.ui.completion = next;
      emitPresentationUpdate(effectType);
    },
    setRenameState(next, effectType = "ui.rename") {
      if (renameStateEquals(presentation.ui.rename, next)) {
        return;
      }

      presentation.ui.rename = next;
      emitPresentationUpdate(effectType);
    },
    setPendingActionState(next, effectType = "ui.pending-action") {
      if (presentation.ui.pendingAction === next) {
        return;
      }

      presentation.ui.pendingAction = next;
      emitPresentationUpdate(effectType);
    },
    setPendingCountState,
    clearPendingCount() {
      setPendingCountState("");
    },
    readPendingCount() {
      if (!presentation.ui.pendingCount) {
        return 1;
      }

      const parsed = Number.parseInt(presentation.ui.pendingCount, 10);
      presentation.ui.pendingCount = "";
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    },
    setStickyViewMode(next, effectType = "ui.sticky-view-mode") {
      if (presentation.ui.stickyViewMode === next) {
        return;
      }

      presentation.ui.stickyViewMode = next;
      emitPresentationUpdate(effectType);
    },
    setLastRepeatableMotion(next, effectType = "ui.repeatable-motion") {
      if (repeatableMotionEquals(presentation.ui.lastRepeatableMotion, next)) {
        return;
      }

      presentation.ui.lastRepeatableMotion = next;
      emitPresentationUpdate(effectType);
    },
    setPreviewThemeName(next, effectType = "ui.preview-theme") {
      if (presentation.ui.previewTheme === next) {
        return;
      }

      presentation.ui.previewTheme = next;
      emitPresentationUpdate(effectType);
    },
    clearFlashState(effectType: string | null = "ui.flash") {
      if (!presentation.ui.flash.active) {
        return false;
      }

      presentation.ui.flash = {
        active: false,
        target: "",
        input: "",
        hints: []
      };

      if (effectType !== null) {
        emitPresentationUpdate(effectType);
      }

      return true;
    }
  };
}
