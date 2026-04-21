import type { EditorState, TextChange, Transaction } from "@mewhhaha/wx-core";
import type {
  EditorCodeAction,
  EditorCompletionItem,
  EditorDiagnostic,
  EditorHover,
  EditorLineRange,
  EditorLocationTarget,
  EditorRenameChangeSet,
  EditorSymbol,
  HighlightSpan
} from "@mewhhaha/wx-language";

import type {
  EditorFileSearchResult,
  EditorLineChange,
  EditorLineChangeState,
  EditorPresentationState
} from "./types";

export interface Snapshot {
  revision: number;
  doc: EditorState["doc"];
}

export interface LanguageRuntimeContext {
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getSearchMatchCache(): readonly { from: number; to: number }[];
  getVisibleLineViewport(): EditorLineRange;
  getVisibleHighlightViewport(): EditorLineRange;
  getSnapshot(): Snapshot;
  emitPresentationUpdate(effectType?: string): void;
  dispatch(transaction: Transaction): void;
}

export interface LanguageHighlighter {
  open(snapshot: Snapshot): Promise<void>;
  update(snapshot: Snapshot, changes: readonly TextChange[]): Promise<void>;
  getHighlights(viewport: EditorLineRange, revision: number): Promise<HighlightSpan[]>;
}

export interface LanguageHoverSource {
  hover(snapshot: Snapshot, offset: number): Promise<EditorHover | null>;
}

export interface LanguageDiagnosticsSource {
  diagnostics(snapshot: Snapshot): Promise<readonly EditorDiagnostic[]>;
}

export interface LanguageCodeActionSource {
  getCodeActions(context: {
    document: Snapshot;
    selection: { from: number; to: number };
    diagnostics: readonly EditorDiagnostic[];
  }): Promise<readonly EditorCodeAction[]>;
}

export interface LanguageCompletionSource {
  complete(document: Snapshot, offset: number): Promise<readonly EditorCompletionItem[]>;
}

export interface LanguageGotoSource {
  definition?(document: Snapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
  declaration?(document: Snapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
  typeDefinition?(document: Snapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
  implementation?(document: Snapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
  references?(document: Snapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
}

export interface LanguageRenameSource {
  prepareRename?(document: Snapshot, offset: number): Promise<{ from: number; to: number } | null>;
  rename(document: Snapshot, offset: number, nextName: string): Promise<readonly EditorRenameChangeSet[] | null>;
}

export interface LanguageSymbolSource {
  documentSymbols?(document: Snapshot): Promise<readonly EditorSymbol[]>;
  workspaceSymbols?(query: string, document?: Snapshot): Promise<readonly EditorSymbol[]>;
}

export interface LanguageFormatter {
  format(context: {
    document: Snapshot;
    selection: { from: number; to: number };
  }): Promise<readonly TextChange[] | null | undefined>;
}

export interface LanguageRuntime {
  syncVisibleLanguageDecorations(): boolean;
  handleDocumentChange(previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]): void;
  clearLanguageState(): void;
  resetRequestTracking(): void;
  requestRawHover(offset: number): Promise<EditorHover | null>;
  ensureVisibleHighlightCoverage(force?: boolean): Promise<void>;
  syncLanguage(options?: {
    changes?: readonly TextChange[];
    forceDocumentSync?: boolean;
    highlightViewport?: EditorLineRange;
    refreshHighlights?: boolean;
    refreshDiagnostics?: boolean;
    refreshLineChanges?: boolean;
  }): Promise<void>;
  refreshLineChanges(): Promise<void>;
  requestCodeActions(): Promise<readonly EditorCodeAction[]>;
  applyCodeAction(action: EditorCodeAction): Promise<boolean>;
  requestCompletion(): Promise<boolean>;
  acceptCompletion(index?: number): Promise<boolean>;
  moveCompletion(delta: number): boolean;
  dismissCompletion(): boolean;
  gotoTarget(kind: "definition" | "declaration" | "type-definition" | "implementation" | "references"): Promise<boolean>;
  renameSymbol(nextName: string): Promise<boolean>;
  openSymbols(kind: "document" | "workspace"): Promise<boolean>;
  formatDocument(): Promise<boolean>;
  saveDocument(targetPath?: string | null): Promise<boolean>;
}

export interface LanguageHighlightsRuntime {
  syncVisibleLanguageDecorations(): boolean;
  handleDocumentChange(previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]): void;
  clearHighlightState(): void;
  resetHighlightTracking(): void;
  ensureVisibleHighlightCoverage(force?: boolean): Promise<void>;
  syncLanguageHighlights(options?: {
    changes?: readonly TextChange[];
    forceDocumentSync?: boolean;
    highlightViewport?: EditorLineRange;
    refreshHighlights?: boolean;
  }): Promise<void>;
}

export interface LanguageDiagnosticsRuntime {
  refreshDiagnostics(): Promise<void>;
  refreshLineChanges(): Promise<void>;
  clearDiagnosticsState(): void;
  resetDiagnosticsTracking(): void;
  remapDiagnosticsForChanges(previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]): void;
}

export interface LanguageActionsRuntime {
  requestRawHover(offset: number): Promise<EditorHover | null>;
  requestCodeActions(): Promise<readonly EditorCodeAction[]>;
  applyCodeAction(action: EditorCodeAction): Promise<boolean>;
  formatDocument(): Promise<boolean>;
  saveDocument(targetPath?: string | null): Promise<boolean>;
  resetActionTracking(): void;
}

export interface LanguageLspRuntime {
  requestCompletion(): Promise<boolean>;
  acceptCompletion(index?: number): Promise<boolean>;
  moveCompletion(delta: number): boolean;
  dismissCompletion(): boolean;
  gotoTarget(kind: "definition" | "declaration" | "type-definition" | "implementation" | "references"): Promise<boolean>;
  renameSymbol(nextName: string): Promise<boolean>;
  openSymbols(kind: "document" | "workspace"): Promise<boolean>;
  resetLspTracking(): void;
}

export interface LineChangeHostServices {
  getLineChanges?(context: { filePath: string; text: string }): Promise<readonly EditorLineChange[]>;
  readFile?(context: { filePath: string }): Promise<{ text: string } | string>;
  searchFiles?(context: {
    scope: "repo" | "folder";
    filePath: string;
    query: string;
  }): Promise<readonly EditorFileSearchResult[]>;
  writeFile?(context: { filePath: string; text: string }): Promise<void>;
  didWriteFile?(context: { filePath: string; text: string }): Promise<void> | void;
}

export type DiagnosticsMap = Map<number, EditorDiagnostic[]>;
export type LineChangesMap = Map<number, EditorLineChangeState>;
