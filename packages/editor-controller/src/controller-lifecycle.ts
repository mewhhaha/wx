import { applyTransaction, type CommandContext, type EditorState, type TextChange, type Transaction } from "@mewhhaha/wx-core";

import { restoreEditorState } from "./history";
import { selectionEquals, transactionRequiresFullDocumentLanguageSync } from "./session";
import type {
  EditorPresentationState,
  EditorUpdate,
  EditorUpdateListener,
  HistoryEntry,
  HistoryPlugin
} from "./types";

interface CreateControllerLifecycleRuntimeOptions {
  presentation: EditorPresentationState;
  history: HistoryPlugin | null;
  listeners: Set<EditorUpdateListener>;
  getState(): EditorState;
  setState(next: EditorState): void;
  getDocumentRevision(): number;
  setDocumentRevision(next: number): void;
  clearFlashOnDocChange(): void;
  clearHoverOnDocChange(): void;
  refreshSearchMatchCache(targetState?: EditorState): void;
  handleLanguageDocumentChange(prevState: EditorState, nextState: EditorState, changes: readonly TextChange[]): void;
  syncVisibleLanguageDecorations(): void;
  ensureVisibleHighlightCoverage(): Promise<void>;
  rebuildViewportModel(): void;
  revealSelectionWithinViewport(): boolean;
  syncVisibleViewportRows(): boolean;
  syncLanguage(options: {
    changes?: readonly TextChange[];
    forceDocumentSync?: boolean;
    refreshHighlights?: boolean;
    refreshDiagnostics?: boolean;
    refreshLineChanges?: boolean;
  }): Promise<void>;
  handleYankBufferChanged(prevState: EditorState, nextState: EditorState): void;
}

export interface ControllerLifecycleRuntime {
  notify(
    prevState: EditorState,
    nextState: EditorState,
    transaction: Transaction,
    options?: { recordHistory?: boolean }
  ): void;
  dispatch(transaction: Transaction): void;
  emitPresentationUpdate(effectType?: string): void;
  schedulePresentationUpdate(effectType?: string): void;
  updatePresentationStateValue(
    updater: (presentation: EditorPresentationState) => void,
    effectType?: string,
    options?: { defer?: boolean }
  ): void;
  historyControls: NonNullable<CommandContext["history"]>;
}

export function createControllerLifecycleRuntime(
  options: CreateControllerLifecycleRuntimeOptions
): ControllerLifecycleRuntime {
  let pendingDeferredPresentationUpdate = false;
  let deferredPresentationEffectType = "presentation.update";

  const getState = () => options.getState();

  const notify = (
    prevState: EditorState,
    nextState: EditorState,
    transaction: Transaction,
    runtimeOptions: { recordHistory?: boolean } = {}
  ) => {
    const update: EditorUpdate = {
      prevState,
      nextState,
      transaction,
      docChanged: prevState.doc.text !== nextState.doc.text,
      selectionChanged: !selectionEquals(prevState.selection, nextState.selection),
      modeChanged: prevState.mode !== nextState.mode
    };

    const shouldCheckpointHistory = prevState.mode === "insert" && nextState.mode !== "insert";

    if (runtimeOptions.recordHistory !== false && (update.docChanged || shouldCheckpointHistory)) {
      options.history?.record(update, { checkpoint: shouldCheckpointHistory });
    }

    if (update.docChanged) {
      options.setDocumentRevision(options.getDocumentRevision() + 1);
      options.clearFlashOnDocChange();
      options.clearHoverOnDocChange();
      const changes = transaction.changes ?? [];
      options.refreshSearchMatchCache(nextState);
      options.handleLanguageDocumentChange(prevState, nextState, changes);
    } else if (update.selectionChanged) {
      options.clearHoverOnDocChange();
    }

    options.handleYankBufferChanged(prevState, nextState);

    let viewportChanged = false;

    if (update.selectionChanged || update.modeChanged || update.docChanged) {
      options.rebuildViewportModel();
      const didReveal = options.revealSelectionWithinViewport();
      viewportChanged = options.syncVisibleViewportRows() || didReveal;
      if (update.docChanged || viewportChanged) {
        options.syncVisibleLanguageDecorations();
      }
    }

    if (viewportChanged) {
      void options.ensureVisibleHighlightCoverage();
    }

    if (update.docChanged) {
      void options.syncLanguage({
        changes: transaction.changes ?? [],
        forceDocumentSync: transactionRequiresFullDocumentLanguageSync(transaction),
        refreshHighlights: true,
        refreshDiagnostics: true,
        refreshLineChanges: true
      });
    }

    for (const listener of options.listeners) {
      listener(update);
    }
  };

  const dispatch = (transaction: Transaction) => {
    const prevState = getState();
    options.setState(applyTransaction(prevState, transaction));
    notify(prevState, getState(), transaction);
  };

  const applyHistoryEntry = (entry: HistoryEntry | null, effectType: string) => {
    if (!entry) {
      return false;
    }

    const prevState = getState();
    options.setState(restoreEditorState(prevState, entry));
    notify(
      prevState,
      getState(),
      { effects: [{ type: effectType }] },
      { recordHistory: false }
    );
    return true;
  };

  const emitPresentationUpdate = (effectType = "presentation.update") => {
    const state = getState();
    notify(state, state, { effects: [{ type: effectType }] }, { recordHistory: false });
  };

  const schedulePresentationUpdate = (effectType = "presentation.update") => {
    deferredPresentationEffectType = effectType;

    if (pendingDeferredPresentationUpdate) {
      return;
    }

    pendingDeferredPresentationUpdate = true;
    queueMicrotask(() => {
      pendingDeferredPresentationUpdate = false;
      const nextEffectType = deferredPresentationEffectType;
      deferredPresentationEffectType = "presentation.update";
      emitPresentationUpdate(nextEffectType);
    });
  };

  return {
    notify,
    dispatch,
    emitPresentationUpdate,
    schedulePresentationUpdate,
    updatePresentationStateValue(updater, effectType = "presentation.update", runtimeOptions = {}) {
      updater(options.presentation);
      if (runtimeOptions.defer) {
        schedulePresentationUpdate(effectType);
      } else {
        emitPresentationUpdate(effectType);
      }
    },
    historyControls: {
      undo: () => applyHistoryEntry(options.history?.undo(getState()) ?? null, "history.undo"),
      redo: () => applyHistoryEntry(options.history?.redo(getState()) ?? null, "history.redo"),
      checkpoint: () => options.history?.checkpoint() ?? false
    }
  };
}
