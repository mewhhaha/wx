import { buildFlashLabels } from "./flash-labels";
import type { KeyRuntimeContext } from "./key-runtime-types";

export interface FlashKeyRuntime {
  beginFlashTarget(): void;
  handleFlashKey(key: string): boolean;
}

export function createFlashKeyRuntime(context: KeyRuntimeContext): FlashKeyRuntime {
  const beginFlashTarget = () => {
    context.setPendingActionState({ kind: "flash-target" }, "flash.pending");
  };

  const handleFlashKey = (key: string): boolean => {
    const presentation = context.getPresentation();

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

  return {
    beginFlashTarget,
    handleFlashKey
  };
}
