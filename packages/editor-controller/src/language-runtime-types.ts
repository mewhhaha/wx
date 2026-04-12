import type { EditorState, TextChange, Transaction } from "@wx/editor-core";
import type { EditorCodeAction, EditorDiagnostic, EditorHover, EditorLineRange, HighlightSpan } from "@wx/editor-language";

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
  formatDocument(): Promise<boolean>;
  saveDocument(targetPath?: string): Promise<boolean>;
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
  saveDocument(targetPath?: string): Promise<boolean>;
  resetActionTracking(): void;
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
