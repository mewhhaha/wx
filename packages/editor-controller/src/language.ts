import type { EditorState, TextChange } from "@wx/editor-core";

import { createLanguageActionsRuntime } from "./language-actions";
import { createLanguageDiagnosticsRuntime } from "./language-diagnostics";
import { createLanguageHighlightsRuntime } from "./language-highlights";
import type {
  LanguageActionsRuntime,
  LanguageCodeActionSource,
  LanguageDiagnosticsRuntime,
  LanguageDiagnosticsSource,
  LanguageFormatter,
  LanguageHighlighter,
  LanguageHoverSource,
  LanguageRuntime,
  LanguageRuntimeContext,
  LineChangeHostServices
} from "./language-runtime-types";
import type { EditorPresentationState } from "./types";

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

function getFormatter(presentation: EditorPresentationState): LanguageFormatter | undefined {
  return presentation.language.services.find((services) => services.formatter)?.formatter;
}

function getHostServices(presentation: EditorPresentationState): LineChangeHostServices | null {
  return presentation.language.host;
}

export type { LanguageRuntime } from "./language-runtime-types";

export function createLanguageRuntime(context: LanguageRuntimeContext): LanguageRuntime {
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
    formatDocument: actionsRuntime.formatDocument,
    saveDocument: actionsRuntime.saveDocument
  };
}
