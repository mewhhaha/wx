import {
  changeSelection,
  createCharacterSelection,
  createSelection,
  deleteSelection,
  findNextChar,
  findPrevChar,
  findTillNextChar,
  findTillPrevChar,
  getActiveCharacterOffset,
  getSelectionOffsets,
  gotoMatchingBracket,
  gotoNextParagraph,
  gotoPrevParagraph,
  gotoWindowBottom,
  gotoWindowCenter,
  gotoWindowTop,
  halfPageDown,
  halfPageUp,
  moveDown,
  moveUp,
  pageDown,
  pageUp,
  pasteAfter,
  selectTextobject,
  yankSelection,
  type Command,
  type CommandContext,
  type EditorState,
  type TextChange,
  type Transaction
} from "@mewhhaha/wx-core";
import type { SyntaxTextobjectMode } from "@mewhhaha/wx-language";
import { buildFlashLabels } from "./flash-labels";
import type {
  EditorBottomMessageState,
  EditorFlashHintState,
  EditorJumpEntry,
  EditorKeyInputOptions,
  EditorPresentationState,
  EditorRepeatableMotion
} from "./types";

interface CommandsRuntimeContext {
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getController(): {
    getSelectedRegister(): string | null;
    getRegister(name?: string | null): string | null;
    setRegister(name: string | null, value: string | null): void;
    selectRegister(name: string | null): void;
    getState(): EditorState;
  };
  dispatch(transaction: Transaction): void;
  getSnapshot(): { revision: number; doc: EditorState["doc"] };
  getActiveOffset(): number;
  getVisibleLineCount(): number;
  getVisibleLineViewport(): { fromLine: number; toLine: number };
  readPendingCount(): number;
  historyControls: NonNullable<CommandContext["history"]>;
  setBottomMessage(message: EditorBottomMessageState | null): void;
  clearFlashState(effectType?: string | null): boolean;
  closePicker(effectType?: string): void;
  syncVisibleLanguageDecorations(): boolean;
  ensureVisibleHighlightCoverage(): Promise<void>;
  revealSelectionWithinViewport(): boolean;
  syncVisibleViewportRows(): boolean;
  pushJumpEntry(entry: EditorJumpEntry): boolean;
  createJumpEntry(): EditorJumpEntry;
  dispatchOffsetSelection(targetOffset: number, preferredColumn: number | null): boolean;
  moveByVisualRows(delta: number): boolean;
  gotoVisibleRow(position: "top" | "center" | "bottom"): boolean;
  getCommentToggler(): {
    toggleComments?(context: { document: { revision: number; doc: EditorState["doc"] }; selection: { from: number; to: number } }): Promise<readonly TextChange[]>;
    toggleLineComments(context: { document: { revision: number; doc: EditorState["doc"] }; selection: { from: number; to: number } }): Promise<readonly TextChange[]>;
    toggleBlockComments?(context: { document: { revision: number; doc: EditorState["doc"] }; selection: { from: number; to: number } }): Promise<readonly TextChange[]>;
  } | undefined;
  getSyntaxSelector(): {
    expandSelection?(selection: { from: number; to: number }, activeOffset: number, revision: number): Promise<{ from: number; to: number } | null>;
    shrinkSelection?(selection: { from: number; to: number }, activeOffset: number, revision: number): Promise<{ from: number; to: number } | null>;
  } | undefined;
  getSyntaxTextobjectProvider(): {
    selectTextobject(context: {
      document: { revision: number; doc: EditorState["doc"] };
      selection: { from: number; to: number };
      activeOffset: number;
      object: string;
      mode: SyntaxTextobjectMode;
    }): Promise<{ from: number; to: number } | null>;
  } | undefined;
  getSyntaxNavigationProvider(): {
    gotoNext?(context: { document: { revision: number; doc: EditorState["doc"] }; activeOffset: number; kind: string }): Promise<{ from: number; to: number } | null>;
    gotoPrev?(context: { document: { revision: number; doc: EditorState["doc"] }; activeOffset: number; kind: string }): Promise<{ from: number; to: number } | null>;
  } | undefined;
  restoreJump(entry: EditorJumpEntry | null): boolean;
}

export interface CommandsRuntime {
  executeEditorCommand(command: Command): boolean;
  executeCommandWithCount(command: Command, options?: EditorKeyInputOptions): Promise<boolean>;
  executeCommandWithCountSync(command: Command): boolean;
  runRepeatableMotion(motion: EditorRepeatableMotion, options?: EditorKeyInputOptions): Promise<boolean>;
  navigateDiagnostic(direction: "next" | "prev", extreme?: boolean): boolean;
  toggleComments(mode?: "smart" | "line" | "block"): Promise<boolean>;
  selectTextobjectWithFallback(mode: SyntaxTextobjectMode, object: string): Promise<boolean>;
  navigateSyntax(direction: "next" | "prev", kind: string): Promise<boolean>;
  collectVisibleFlashHints(target: string): readonly EditorFlashHintState[];
  applyFlashJump(targetOffset: number): void;
  handleAltArrowSyntaxSelection(key: "ArrowUp" | "ArrowDown"): Promise<boolean>;
}

export function createCommandsRuntime(context: CommandsRuntimeContext): CommandsRuntime {
  const primeRegisterForPaste = () => {
    const controller = context.getController();
    const selected = controller.getSelectedRegister();
    controller.selectRegister(null);
    if (!selected) {
      return;
    }

    const value = controller.getRegister(selected);
    context.dispatch({
      yankBuffer: value
    });
  };

  const executeEditorCommand = (command: Command): boolean => {
    const state = context.getState();
    const presentation = context.getPresentation();
    const controller = context.getController();
    context.setBottomMessage(null);
    context.clearFlashState("flash.clear");
    context.closePicker("ui.picker.close");
    const selectedRegister = presentation.registers.selected;

    if (command === pasteAfter) {
      primeRegisterForPaste();
    }

    if (presentation.viewport.softWrap) {
      if (command === moveUp) {
        return context.moveByVisualRows(-1);
      }

      if (command === moveDown) {
        return context.moveByVisualRows(1);
      }

      if (command === pageUp) {
        return context.moveByVisualRows(-(Math.max(1, context.getVisibleLineCount() - 1)));
      }

      if (command === pageDown) {
        return context.moveByVisualRows(Math.max(1, context.getVisibleLineCount() - 1));
      }

      if (command === halfPageUp) {
        return context.moveByVisualRows(-Math.max(1, Math.floor(context.getVisibleLineCount() / 2)));
      }

      if (command === halfPageDown) {
        return context.moveByVisualRows(Math.max(1, Math.floor(context.getVisibleLineCount() / 2)));
      }

      if (command === gotoWindowTop) {
        return context.gotoVisibleRow("top");
      }

      if (command === gotoWindowCenter) {
        return context.gotoVisibleRow("center");
      }

      if (command === gotoWindowBottom) {
        return context.gotoVisibleRow("bottom");
      }
    }

    const viewport = context.getVisibleLineViewport();
    const didRun = command(state, context.dispatch, {
      history: context.historyControls,
      viewport: {
        fromLine: viewport.fromLine,
        toLine: viewport.toLine,
        visibleLineCount: Math.max(1, viewport.toLine - viewport.fromLine + 1)
      }
    });

    if (didRun && [yankSelection, deleteSelection, changeSelection].includes(command)) {
      if (selectedRegister) {
        controller.setRegister(selectedRegister, controller.getState().yankBuffer);
      }
      controller.selectRegister(null);
    }

    return didRun;
  };

  const executeCommandWithCount = async (command: Command, options: EditorKeyInputOptions = {}): Promise<boolean> => {
    const controller = context.getController();
    const count = context.readPendingCount();
    const selectedRegister = controller.getSelectedRegister();

    if (command === pasteAfter && selectedRegister === "+" && options.readClipboardText) {
      const value = await options.readClipboardText();
      controller.selectRegister(null);

      if (!value) {
        context.setBottomMessage({ tone: "warning", text: 'Register "+" is empty' });
        return false;
      }

      context.dispatch({ yankBuffer: value });
    }

    let applied = false;
    for (let index = 0; index < count; index += 1) {
      const previousMode = context.getState().mode;
      const previousRevision = context.getState().revision;
      const didRun = executeEditorCommand(command);

      if (!didRun) {
        break;
      }

      applied = true;

      if (context.getState().mode !== previousMode || context.getState().revision === previousRevision) {
        break;
      }
    }

    return applied;
  };

  const executeCommandWithCountSync = (command: Command): boolean => {
    const count = context.readPendingCount();
    let applied = false;

    for (let index = 0; index < count; index += 1) {
      const previousMode = context.getState().mode;
      const previousRevision = context.getState().revision;
      const didRun = executeEditorCommand(command);

      if (!didRun) {
        break;
      }

      applied = true;

      if (context.getState().mode !== previousMode || context.getState().revision === previousRevision) {
        break;
      }
    }

    return applied;
  };

  const runRepeatableMotion = async (motion: EditorRepeatableMotion): Promise<boolean> => {
    switch (motion.kind) {
      case "find":
        return executeEditorCommand(
          motion.variant === "f"
            ? findNextChar(motion.target)
            : motion.variant === "F"
              ? findPrevChar(motion.target)
              : motion.variant === "t"
                ? findTillNextChar(motion.target)
                : findTillPrevChar(motion.target)
        );
      case "matching-bracket":
        return executeEditorCommand(gotoMatchingBracket);
      case "paragraph":
        return executeEditorCommand(motion.direction === "next" ? gotoNextParagraph : gotoPrevParagraph);
      case "textobject":
        return executeEditorCommand(selectTextobject(motion.mode, motion.object));
      case "search":
        return false;
    }

    return false;
  };

  const navigateDiagnostic = (direction: "next" | "prev", extreme = false): boolean => {
    const state = context.getState();
    const presentation = context.getPresentation();
    if (presentation.language.diagnostics.length === 0) {
      context.setBottomMessage({ tone: "warning", text: "No diagnostics" });
      return false;
    }

    const activeOffset = context.getActiveOffset();
    const ordered = [...presentation.language.diagnostics].sort((left, right) => left.from - right.from);
    const target =
      direction === "next"
        ? extreme
          ? ordered[ordered.length - 1]
          : ordered.find((entry) => entry.from > activeOffset) ?? ordered[0]
        : extreme
          ? ordered[0]
          : [...ordered].reverse().find((entry) => entry.to - 1 < activeOffset) ?? ordered[ordered.length - 1];

    if (!target) {
      return false;
    }

    context.pushJumpEntry(context.createJumpEntry());
    context.dispatch({
      selection: createSelection(target.from, Math.max(target.from, target.to - 1)),
      mode: "normal"
    });
    context.revealSelectionWithinViewport();
    context.syncVisibleViewportRows();
    context.syncVisibleLanguageDecorations();
    return true;
  };

  const toggleComments = async (mode: "smart" | "line" | "block" = "line"): Promise<boolean> => {
    const toggler = context.getCommentToggler();

    if (!toggler) {
      context.setBottomMessage({ tone: "warning", text: "No comment provider" });
      return false;
    }

    let changes: readonly TextChange[];

    try {
      const toggleContext = {
        document: context.getSnapshot(),
        selection: getSelectionOffsets(context.getState())
      };

      changes =
        mode === "smart"
          ? toggler.toggleComments
            ? await toggler.toggleComments(toggleContext)
            : await toggler.toggleLineComments(toggleContext)
          : mode === "block"
            ? toggler.toggleBlockComments
              ? await toggler.toggleBlockComments(toggleContext)
              : toggler.toggleComments
                ? await toggler.toggleComments(toggleContext)
                : await toggler.toggleLineComments(toggleContext)
            : await toggler.toggleLineComments(toggleContext);
    } catch {
      context.setBottomMessage({ tone: "error", text: "Comment toggle failed" });
      return false;
    }

    if (changes.length === 0) {
      context.setBottomMessage({ tone: "info", text: "Nothing to comment" });
      return false;
    }

    context.dispatch({
      changes,
      effects: [{ type: "language.comment-toggle" }]
    });
    context.setBottomMessage({ tone: "info", text: "Toggled comments" });
    return true;
  };

  const selectTextobjectWithFallback = async (mode: SyntaxTextobjectMode, object: string): Promise<boolean> => {
    if (["w", "W", "p", "'", "\"", "`", "(", ")", "[", "]", "{", "}", "<", ">"].includes(object)) {
      return executeEditorCommand(selectTextobject(mode, object));
    }

    const provider = context.getSyntaxTextobjectProvider();
    if (!provider) {
      return false;
    }

    const state = context.getState();
    const next = await provider.selectTextobject({
      document: context.getSnapshot(),
      selection: getSelectionOffsets(state),
      activeOffset: getActiveCharacterOffset(state),
      object,
      mode
    });

    if (!next) {
      return false;
    }

    context.dispatch({
      selection: createSelection(next.from, Math.max(next.from, next.to - 1)),
      mode: "normal"
    });
    return true;
  };

  const navigateSyntax = async (direction: "next" | "prev", kind: string): Promise<boolean> => {
    const provider = context.getSyntaxNavigationProvider();
    const navigate = direction === "next" ? provider?.gotoNext : provider?.gotoPrev;

    if (!navigate) {
      return false;
    }

    const next = await navigate({
      document: context.getSnapshot(),
      activeOffset: getActiveCharacterOffset(context.getState()),
      kind
    });

    if (!next) {
      return false;
    }

    context.pushJumpEntry(context.createJumpEntry());
    context.dispatch({
      selection: createSelection(next.from, Math.max(next.from, next.to - 1)),
      mode: "normal"
    });
    context.revealSelectionWithinViewport();
    context.syncVisibleViewportRows();
    context.syncVisibleLanguageDecorations();
    return true;
  };

  const isFlashJumpOffset = (offset: number, target: string) => {
    const state = context.getState();
    const character = state.doc.text[offset] ?? "";

    if (!character || character !== target) {
      return false;
    }

    return offset !== context.getActiveOffset();
  };

  const collectVisibleFlashHints = (target: string): readonly EditorFlashHintState[] => {
    const presentation = context.getPresentation();
    const offsets: number[] = [];

    for (const visualRow of presentation.viewport.visibleVisualRows) {
      for (let offset = visualRow.segmentStart; offset < visualRow.segmentEnd; offset += 1) {
        if (isFlashJumpOffset(offset, target)) {
          offsets.push(offset);
        }
      }
    }

    const labels = buildFlashLabels(target, offsets.length);
    return offsets.map((offset, index) => ({
      offset,
      label: labels[index] ?? ""
    }));
  };

  const applyFlashJump = (targetOffset: number) => {
    const state = context.getState();
    context.clearFlashState("flash.clear");
    const targetPosition = state.doc.positionAt(targetOffset);
    context.dispatch({
      selection:
        state.mode === "insert"
          ? createSelection(targetOffset, targetOffset, targetPosition.column)
          : state.mode === "visual"
            ? createSelection(
                state.selection.ranges[state.selection.primaryIndex]?.anchor ?? targetOffset,
                targetOffset,
                targetPosition.column
              )
            : createCharacterSelection(state.doc, targetOffset, targetPosition.column)
    });
  };

  const handleAltArrowSyntaxSelection = async (key: "ArrowUp" | "ArrowDown"): Promise<boolean> => {
    const syntaxSelector = context.getSyntaxSelector();
    const syntaxSelection =
      key === "ArrowUp"
        ? syntaxSelector?.expandSelection?.bind(syntaxSelector)
        : syntaxSelector?.shrinkSelection?.bind(syntaxSelector);

    if (!syntaxSelection) {
      return false;
    }

    const state = context.getState();
    const revision = state.revision;
    const syntaxRevision = context.getPresentation().language.languageRevision;
    const selection = getSelectionOffsets(state);
    const activeOffset = getActiveCharacterOffset(state);
    const nextSelection = await syntaxSelection(selection, activeOffset, syntaxRevision);
    if (!nextSelection || context.getState().revision !== revision || nextSelection.to <= nextSelection.from) {
      return true;
    }

    context.dispatch({
      selection: createSelection(nextSelection.from, Math.max(nextSelection.from, nextSelection.to - 1))
    });
    return true;
  };

  return {
    executeEditorCommand,
    executeCommandWithCount,
    executeCommandWithCountSync,
    runRepeatableMotion,
    navigateDiagnostic,
    toggleComments,
    selectTextobjectWithFallback,
    navigateSyntax,
    collectVisibleFlashHints,
    applyFlashJump,
    handleAltArrowSyntaxSelection
  };
}
