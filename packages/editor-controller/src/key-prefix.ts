import {
  addSurround,
  deleteSurround,
  findNextChar,
  findPrevChar,
  findTillNextChar,
  findTillPrevChar,
  gotoMatchingBracket,
  insertText
} from "@wx/editor-core";

import {
  commandForBracketPrefix,
  commandForGotoPrefix
} from "./keymap";
import type { EditorKeyInputOptions, EditorKeyInputResult } from "./types";
import type { FlashKeyRuntime } from "./key-flash";
import type { KeyRuntimeContext } from "./key-runtime-types";

interface PrefixKeyInput {
  key: string;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  shift: boolean;
}

export async function handlePendingActionKey(
  context: KeyRuntimeContext,
  flashRuntime: FlashKeyRuntime,
  input: PrefixKeyInput,
  options: EditorKeyInputOptions
): Promise<EditorKeyInputResult | null> {
  const state = context.getState();
  const presentation = context.getPresentation();
  const controller = context.getController();
  const nextPending = presentation.ui.pendingAction;

  if (!nextPending) {
    return null;
  }

  if (input.key === "Escape") {
    if (nextPending.kind === "flash-target") {
      flashRuntime.handleFlashKey("Escape");
    } else {
      context.setPendingActionState(null);
      if (nextPending.kind === "?") {
        context.setCommandCompletions([], 0, "ui.pending-action.help");
      }
    }
    context.clearPendingCount();
    return { handled: true };
  }

  if (nextPending.kind !== "flash-target") {
    context.setPendingActionState(null);
    if (nextPending.kind === "?") {
      context.setCommandCompletions([], 0, "ui.pending-action.help");
    }
  }

  if (nextPending.kind === "g") {
    if (input.key === "c") {
      await context.toggleComments("line");
      return { handled: true };
    }

    const chordCommand = commandForGotoPrefix(input.key);
    if (chordCommand) {
      context.executeCommandWithCountSync(chordCommand);
      return { handled: true };
    }
  }

  if (nextPending.kind === "[" || nextPending.kind === "]") {
    if (input.key === "d" || input.key === "D") {
      context.navigateDiagnostic(nextPending.kind === "]" ? "next" : "prev", input.key === "D");
      return { handled: true };
    }

    if (["f", "t", "a", "c", "T", "g", "x"].includes(input.key)) {
      await context.navigateSyntax(nextPending.kind === "]" ? "next" : "prev", input.key);
      return { handled: true };
    }

    const chordCommand = commandForBracketPrefix(nextPending.kind, input.key);
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
    if (input.key === "m") {
      const previousRevision = state.revision;
      context.executeEditorCommand(gotoMatchingBracket);
      context.recordRepeatableMotion({ kind: "matching-bracket" }, context.getState().revision !== previousRevision);
      return { handled: true };
    }

    if (input.key === "a" || input.key === "i") {
      context.setPendingActionState({ kind: "textobject", mode: input.key === "a" ? "around" : "inside" });
      return { handled: true };
    }

    if (input.key === "s") {
      context.setPendingActionState({ kind: "surround-add" });
      return { handled: true };
    }

    if (input.key === "d") {
      context.setPendingActionState({ kind: "surround-delete" });
      return { handled: true };
    }

    if (input.key === "r") {
      context.setPendingActionState({ kind: "surround-replace-from" });
      return { handled: true };
    }
  }

  if (nextPending.kind === "?") {
    if (input.key === "f") {
      await context.openFileSearchPicker("repo");
      return { handled: true };
    }

    if (input.key === "F") {
      await context.openFileSearchPicker("folder");
      return { handled: true };
    }

    if (input.key === "b") {
      context.openBuffersPicker();
      return { handled: true };
    }

    if (input.key === "d") {
      context.openDiagnosticsPicker();
      return { handled: true };
    }

    if (input.key === "j") {
      context.openJumpListPicker();
      return { handled: true };
    }
  }

  if (nextPending.kind === "find") {
    const previousRevision = state.revision;
    context.executeEditorCommand(
      nextPending.variant === "f"
        ? findNextChar(input.key)
        : nextPending.variant === "F"
          ? findPrevChar(input.key)
          : nextPending.variant === "t"
            ? findTillNextChar(input.key)
            : findTillPrevChar(input.key)
    );
    context.recordRepeatableMotion(
      { kind: "find", variant: nextPending.variant, target: input.key },
      context.getState().revision !== previousRevision
    );
    return { handled: true };
  }

  if (nextPending.kind === "textobject") {
    const previousRevision = state.revision;
    const didRun = await context.selectTextobjectWithFallback(nextPending.mode, input.key);
    context.recordRepeatableMotion(
      { kind: "textobject", mode: nextPending.mode, object: input.key },
      didRun || context.getState().revision !== previousRevision
    );
    return { handled: true };
  }

  if (nextPending.kind === "surround-add") {
    context.executeEditorCommand(addSurround(input.key));
    return { handled: true };
  }

  if (nextPending.kind === "surround-delete") {
    context.executeEditorCommand(deleteSurround(input.key));
    return { handled: true };
  }

  if (nextPending.kind === "surround-replace-from") {
    context.setPendingActionState({ kind: "surround-replace-to", fromObject: input.key });
    return { handled: true };
  }

  if (nextPending.kind === "surround-replace-to") {
    context.executeEditorCommand(replaceSurround(nextPending.fromObject, input.key));
    return { handled: true };
  }

  if (nextPending.kind === "register-select") {
    if (nextPending.insert && state.mode === "insert") {
      const value = input.key === "+" ? (await options.readClipboardText?.()) ?? null : controller.getRegister(input.key);
      controller.selectRegister(null);

      if (!value) {
        context.setBottomMessage({ tone: "warning", text: `Register ${input.key} is empty` });
        return { handled: true };
      }

      context.executeEditorCommand(insertText(value));
    } else {
      controller.selectRegister(input.key);
      context.setBottomMessage({ tone: "info", text: `Register "${input.key}" selected` });
    }
    return { handled: true };
  }

  if (nextPending.kind === "z") {
    if (input.key === "Escape") {
      context.setStickyViewMode(false);
      return { handled: true };
    }

    if (input.key === "z" || input.key === "c" || input.key === "m") {
      controller.alignViewportToSelection("center");
    } else if (input.key === "t") {
      controller.alignViewportToSelection("top");
    } else if (input.key === "b") {
      controller.alignViewportToSelection("bottom");
    } else if (input.key === "j") {
      controller.scrollViewportBy(1);
    } else if (input.key === "k") {
      controller.scrollViewportBy(-1);
    }

    if (!nextPending.sticky) {
      context.setStickyViewMode(false);
    }
    return { handled: true };
  }

  return null;
}
