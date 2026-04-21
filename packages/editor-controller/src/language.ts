import type { EditorState, TextChange } from "@mewhhaha/wx-core";

import { createLanguageActionsRuntime } from "./language-actions";
import { createLanguageDiagnosticsRuntime } from "./language-diagnostics";
import { createLanguageHighlightsRuntime } from "./language-highlights";
import { createLanguageLspRuntime } from "./language-lsp";
import type {
  LanguageCodeActionSource,
  LanguageCompletionSource,
  LanguageDiagnosticsSource,
  LanguageFormatter,
  LanguageGotoSource,
  LanguageHighlighter,
  LanguageHoverSource,
  LanguageRenameSource,
  LanguageRuntime,
  LanguageRuntimeContext,
  LanguageSymbolSource,
  LineChangeHostServices
} from "./language-runtime-types";
import type { EditorBottomMessageState, EditorPresentationState } from "./types";
import type { PickerActionItem, PickerSearchSource } from "./picker";

function getHighlighter(presentation: EditorPresentationState): LanguageHighlighter | undefined {
  return presentation.language.services.find((services) => services.highlighter)?.highlighter;
}

function getHoverSource(presentation: EditorPresentationState): LanguageHoverSource | undefined {
  return presentation.language.services.find((services) => services.hover)?.hover;
}

function getDiagnosticsSource(presentation: EditorPresentationState): LanguageDiagnosticsSource | undefined {
  return presentation.language.services.find((services) => services.diagnostics)?.diagnostics;
}

function getCodeActionSource(presentation: EditorPresentationState): LanguageCodeActionSource | undefined {
  return presentation.language.services.find((services) => services.codeActions)?.codeActions;
}

function getCompletionSource(presentation: EditorPresentationState): LanguageCompletionSource | undefined {
  return presentation.language.services.find((services) => services.completion)?.completion;
}

function getGotoSource(presentation: EditorPresentationState): LanguageGotoSource | undefined {
  return presentation.language.services.find((services) => services.goto)?.goto;
}

function getRenameSource(presentation: EditorPresentationState): LanguageRenameSource | undefined {
  return presentation.language.services.find((services) => services.rename)?.rename;
}

function getSymbolSource(presentation: EditorPresentationState): LanguageSymbolSource | undefined {
  return presentation.language.services.find((services) => services.symbols)?.symbols;
}

function getFormatter(presentation: EditorPresentationState): LanguageFormatter | undefined {
  return presentation.language.services.find((services) => services.formatter)?.formatter;
}

function getHostServices(presentation: EditorPresentationState): LineChangeHostServices | null {
  return presentation.language.host;
}

export type { LanguageRuntime } from "./language-runtime-types";

interface CreateLanguageRuntimeOptions {
  context: LanguageRuntimeContext;
  setBottomMessage(message: EditorBottomMessageState | null): void;
  setCompletionState(next: EditorPresentationState["ui"]["completion"], effectType?: string): void;
  setRenameState(next: EditorPresentationState["ui"]["rename"], effectType?: string): void;
  applySelectionRange(from: number, to: number): void;
  revealSelectionWithinViewport(): boolean;
  syncVisibleViewportRows(): boolean;
  syncVisibleLanguageDecorations(): boolean;
  ensureVisibleHighlightCoverage(): Promise<void>;
  pushJump(): boolean;
  openBuffer(filePath: string): Promise<boolean>;
  findBufferState(filePath: string): EditorState | null;
  storeBufferState(filePath: string, state: EditorState, dirty?: boolean): void;
  createStateForText(text: string, template: EditorState): EditorState;
  openActionPicker(options: {
    title: string;
    items: readonly PickerActionItem[];
    selectedIndex?: number;
    query?: string;
    variant?: "bar" | "modal";
    effectType?: string;
  }): boolean;
  openSearchPicker(source: PickerSearchSource): Promise<boolean>;
}

export function createLanguageRuntime(options: CreateLanguageRuntimeOptions): LanguageRuntime {
  const { context } = options;
  const highlightsRuntime = createLanguageHighlightsRuntime({
    context,
    getHighlighter
  });

  const diagnosticsRuntime = createLanguageDiagnosticsRuntime({
    context,
    getDiagnosticsSource,
    getHostServices,
    syncVisibleLanguageDecorations: highlightsRuntime.syncVisibleLanguageDecorations
  });

  const actionsRuntime = createLanguageActionsRuntime({
    context,
    getHoverSource,
    getCodeActionSource,
    getFormatter,
    getHostServices,
    refreshLineChanges: diagnosticsRuntime.refreshLineChanges
  });

  const lspRuntime = createLanguageLspRuntime({
    context,
    getCompletionSource,
    getGotoSource,
    getRenameSource,
    getSymbolSource,
    getHostServices,
    setBottomMessage: options.setBottomMessage,
    setCompletionState: options.setCompletionState,
    setRenameState: options.setRenameState,
    applySelectionRange: options.applySelectionRange,
    revealSelectionWithinViewport: options.revealSelectionWithinViewport,
    syncVisibleViewportRows: options.syncVisibleViewportRows,
    syncVisibleLanguageDecorations: options.syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: options.ensureVisibleHighlightCoverage,
    pushJump: options.pushJump,
    openBuffer: options.openBuffer,
    findBufferState: options.findBufferState,
    storeBufferState: options.storeBufferState,
    createStateForText: options.createStateForText,
    openActionPicker: options.openActionPicker,
    openSearchPicker: options.openSearchPicker
  });

  const syncLanguage = async (
    options: {
      changes?: readonly TextChange[];
      forceDocumentSync?: boolean;
      highlightViewport?: { fromLine: number; toLine: number };
      refreshHighlights?: boolean;
      refreshDiagnostics?: boolean;
      refreshLineChanges?: boolean;
    } = {}
  ): Promise<void> => {
    const highlightRefresh = highlightsRuntime.syncLanguageHighlights(options);

    if (options.refreshDiagnostics ?? true) {
      void diagnosticsRuntime.refreshDiagnostics();
    }

    if (options.refreshLineChanges ?? true) {
      void diagnosticsRuntime.refreshLineChanges();
    }

    await highlightRefresh;
  };

  const handleDocumentChange = (
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ) => {
    highlightsRuntime.handleDocumentChange(previousState, nextState, changes);
    diagnosticsRuntime.remapDiagnosticsForChanges(previousState, nextState, changes);
  };

  const clearLanguageState = () => {
    highlightsRuntime.clearHighlightState();
    diagnosticsRuntime.clearDiagnosticsState();
  };

  const resetRequestTracking = () => {
    highlightsRuntime.resetHighlightTracking();
    diagnosticsRuntime.resetDiagnosticsTracking();
    actionsRuntime.resetActionTracking();
    lspRuntime.resetLspTracking();
  };

  return {
    syncVisibleLanguageDecorations: highlightsRuntime.syncVisibleLanguageDecorations,
    handleDocumentChange,
    clearLanguageState,
    resetRequestTracking,
    requestRawHover: actionsRuntime.requestRawHover,
    ensureVisibleHighlightCoverage: highlightsRuntime.ensureVisibleHighlightCoverage,
    syncLanguage,
    refreshLineChanges: diagnosticsRuntime.refreshLineChanges,
    requestCodeActions: actionsRuntime.requestCodeActions,
    applyCodeAction: actionsRuntime.applyCodeAction,
    requestCompletion: lspRuntime.requestCompletion,
    acceptCompletion: lspRuntime.acceptCompletion,
    moveCompletion: lspRuntime.moveCompletion,
    dismissCompletion: lspRuntime.dismissCompletion,
    gotoTarget: lspRuntime.gotoTarget,
    renameSymbol: lspRuntime.renameSymbol,
    openSymbols: lspRuntime.openSymbols,
    formatDocument: actionsRuntime.formatDocument,
    saveDocument: actionsRuntime.saveDocument
  };
}
