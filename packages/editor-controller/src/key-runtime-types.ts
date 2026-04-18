import type { Command, EditorState } from "@wx/editor-core";
import type { SyntaxTextobjectMode } from "@wx/editor-language";

import type {
  EditorBottomMessageState,
  EditorCommandCompletionItem,
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

export interface KeyRuntimeContext {
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getController(): EditorController;
  getActiveOffset(): number;
  getVisibleLineCount(): number;
  executeEditorCommand(command: Command): boolean;
  executeCommandWithCount(command: Command, options?: EditorKeyInputOptions): Promise<boolean>;
  executeCommandWithCountSync(command: Command): boolean;
  requestCompletion(): Promise<boolean>;
  acceptCompletion(index?: number): Promise<boolean>;
  moveCompletion(delta: number): boolean;
  dismissCompletion(): boolean;
  gotoTarget(kind: "definition" | "declaration" | "type-definition" | "implementation" | "references"): Promise<boolean>;
  renameSymbol(nextName: string): Promise<boolean>;
  openSymbols(kind: "document" | "workspace"): Promise<boolean>;
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
  openCommandLine(prompt: ":" | "/" | "?"): void;
  setCommandCompletions(next: readonly EditorCommandCompletionItem[], index?: number, effectType?: string): void;
  handleActiveCommandLineKey(
    key: string,
    options?: EditorCommandLineKeyOptions & { shift?: boolean }
  ): Promise<EditorKeyInputResult | null>;
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
  openBuffersPicker(): boolean;
  openFileSearchPicker(scope: "repo" | "folder"): Promise<boolean>;
  updatePickerQuery(query: string): Promise<boolean>;
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
