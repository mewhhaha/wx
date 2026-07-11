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
  LanguageDocumentUpdate,
  LanguageRenameSource,
  LanguageSignatureHelpSource,
  LanguageRuntime,
  LanguageRuntimeContext,
  LanguageSymbolSource,
  LineChangeHostServices,
  Snapshot
} from "./language-runtime-types";
import type { EditorBottomMessageState, EditorJumpEntry, EditorPresentationState } from "./types";
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
function getSignatureHelpSource(presentation: EditorPresentationState): LanguageSignatureHelpSource | undefined {
  return presentation.language.services.find((services) => services.signatureHelp)?.signatureHelp;
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
  reportServiceFailure(error: unknown): void;
  reportServiceReady(): void;
  setBottomMessage(message: EditorBottomMessageState | null): void;
  setCompletionState(next: EditorPresentationState["ui"]["completion"], effectType?: string): void;
  setSignatureHelpState(next: EditorPresentationState["ui"]["signatureHelp"], effectType?: string): void;
  setRenameState(next: EditorPresentationState["ui"]["rename"], effectType?: string): void;
  applySelectionRange(from: number, to: number): void;
  revealSelectionWithinViewport(): boolean;
  syncVisibleViewportRows(): boolean;
  syncVisibleLanguageDecorations(): boolean;
  ensureVisibleHighlightCoverage(): Promise<void>;
  pushJump(entry?: EditorJumpEntry): boolean;
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
  interface SyncCaller { resolve(): void; }
  interface SyncWork {
    target: Snapshot;
    updates: LanguageDocumentUpdate[];
    forceDocumentSync: boolean;
    highlightViewport?: { fromLine: number; toLine: number };
    refreshHighlights: boolean;
    generation: number;
    serviceGeneration: number;
    callers: SyncCaller[];
  }
  let workGeneration = 1;
  let activeSync: SyncWork | null = null;
  let pendingSync: SyncWork | null = null;
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
    getSignatureHelpSource,
    getGotoSource,
    getRenameSource,
    getSymbolSource,
    getHostServices,
    setBottomMessage: options.setBottomMessage,
    setCompletionState: options.setCompletionState,
    setSignatureHelpState: options.setSignatureHelpState,
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

  const updateDocumentWorkDepth = () => {
    const work = context.getPresentation().language.work.document;
    work.inFlight = activeSync ? 1 : 0;
    work.queued = pendingSync ? 1 : 0;
    work.maxQueueDepth = Math.max(work.maxQueueDepth, work.inFlight + work.queued);
  };

  const syncWorkIsCurrent = (work: SyncWork) => {
    const presentation = context.getPresentation();
    return work.generation === workGeneration && work.serviceGeneration === presentation.language.serviceStatus.generation;
  };

  const pumpDocumentSync = () => {
    if (activeSync || !pendingSync) return;
    const work = pendingSync;
    pendingSync = null;
    activeSync = work;
    const stats = context.getPresentation().language.work.document;
    stats.started += 1;
    updateDocumentWorkDepth();

    void highlightsRuntime.syncLanguageHighlights({
      target: work.target,
      updates: work.updates,
      forceDocumentSync: work.forceDocumentSync,
      highlightViewport: work.highlightViewport,
      refreshHighlights: work.refreshHighlights,
      isCurrent: () => syncWorkIsCurrent(work)
    }).then(() => {
      if (!syncWorkIsCurrent(work)) return;
      const currentStats = context.getPresentation().language.work.document;
      currentStats.completed += 1;
      currentStats.latestCompletedRevision = work.target.revision;
      options.reportServiceReady();
    }).catch((error) => {
      if (syncWorkIsCurrent(work)) options.reportServiceFailure(error);
    }).finally(() => {
      for (const caller of work.callers) caller.resolve();
      if (activeSync !== work) return;
      activeSync = null;
      updateDocumentWorkDepth();
      pumpDocumentSync();
    });
  };

  const syncLanguage = (
    runtimeOptions: {
      changes?: readonly TextChange[];
      forceDocumentSync?: boolean;
      highlightViewport?: { fromLine: number; toLine: number };
      refreshHighlights?: boolean;
      refreshDiagnostics?: boolean;
      refreshLineChanges?: boolean;
    } = {}
  ): Promise<void> => {
    const presentation = context.getPresentation();
    const snapshot = context.getSnapshot();
    const stats = presentation.language.work.document;
    const changes = runtimeOptions.changes ?? [];
    const forceDocumentSync = runtimeOptions.forceDocumentSync ?? false;
    stats.requested += 1;
    stats.latestRequestedRevision = snapshot.revision;

    if (runtimeOptions.refreshDiagnostics ?? true) {
      void diagnosticsRuntime.refreshDiagnostics();
    }

    if (runtimeOptions.refreshLineChanges ?? true) {
      void diagnosticsRuntime.refreshLineChanges();
    }

    return new Promise<void>((resolve) => {
      const caller = { resolve };
      if (!pendingSync) {
        pendingSync = {
          target: snapshot,
          updates: changes.length > 0 ? [{ document: snapshot, changes: [...changes] }] : [],
          forceDocumentSync,
          highlightViewport: runtimeOptions.highlightViewport,
          refreshHighlights: runtimeOptions.refreshHighlights ?? true,
          generation: workGeneration,
          serviceGeneration: presentation.language.serviceStatus.generation,
          callers: [caller]
        };
      } else {
        pendingSync.target = snapshot;
        pendingSync.highlightViewport = runtimeOptions.highlightViewport ?? pendingSync.highlightViewport;
        pendingSync.refreshHighlights ||= runtimeOptions.refreshHighlights ?? true;
        pendingSync.callers.push(caller);
        stats.coalesced += 1;
        if (forceDocumentSync) {
          pendingSync.forceDocumentSync = true;
          pendingSync.updates = [];
        } else if (!pendingSync.forceDocumentSync && changes.length > 0) {
          pendingSync.updates.push({ document: snapshot, changes: [...changes] });
        } else if (pendingSync.forceDocumentSync) {
          // The eventual open always uses the latest snapshot, so later edits
          // remain coalesced into that full correctness fallback.
          pendingSync.updates = [];
        }
      }
      updateDocumentWorkDepth();
      pumpDocumentSync();
    });
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
    workGeneration += 1;
    const documentStats = context.getPresentation().language.work.document;
    for (const work of [activeSync, pendingSync]) {
      if (!work) continue;
      documentStats.cancelled += 1;
      for (const caller of work.callers) caller.resolve();
    }
    activeSync = null;
    pendingSync = null;
    updateDocumentWorkDepth();
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
    async requestRawHover(offset) {
      const serviceGeneration = context.getPresentation().language.serviceStatus.generation;
      try {
        return await actionsRuntime.requestRawHover(offset);
      } catch (error) {
        if (serviceGeneration === context.getPresentation().language.serviceStatus.generation) {
          options.reportServiceFailure(error);
        }
        return null;
      }
    },
    async ensureVisibleHighlightCoverage(force) {
      const serviceGeneration = context.getPresentation().language.serviceStatus.generation;
      try {
        await highlightsRuntime.ensureVisibleHighlightCoverage(force);
      } catch (error) {
        if (serviceGeneration === context.getPresentation().language.serviceStatus.generation) {
          options.reportServiceFailure(error);
        }
      }
    },
    syncLanguage,
    refreshLineChanges: diagnosticsRuntime.refreshLineChanges,
    requestCodeActions: actionsRuntime.requestCodeActions,
    applyCodeAction: actionsRuntime.applyCodeAction,
    requestCompletion: lspRuntime.requestCompletion,
    acceptCompletion: lspRuntime.acceptCompletion,
    moveCompletion: lspRuntime.moveCompletion,
    dismissCompletion: lspRuntime.dismissCompletion,
    requestSignatureHelp: lspRuntime.requestSignatureHelp,
    moveSignatureHelp: lspRuntime.moveSignatureHelp,
    dismissSignatureHelp: lspRuntime.dismissSignatureHelp,
    gotoTarget: lspRuntime.gotoTarget,
    renameSymbol: lspRuntime.renameSymbol,
    openSymbols: lspRuntime.openSymbols,
    formatDocument: actionsRuntime.formatDocument,
    saveDocument: actionsRuntime.saveDocument
  };
}
