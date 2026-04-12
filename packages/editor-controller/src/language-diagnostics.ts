import {
  mapOffsetThroughChanges,
  type EditorState,
  type TextChange
} from "@wx/editor-core";
import type { EditorDiagnostic } from "@wx/editor-language";

import { buildDiagnosticsCache, buildLineChangesMap } from "./language-state";
import type {
  DiagnosticsMap,
  LanguageDiagnosticsRuntime,
  LanguageDiagnosticsSource,
  LanguageRuntimeContext,
  LineChangeHostServices,
  LineChangesMap
} from "./language-runtime-types";
import type { EditorLineChangeState } from "./types";

interface CreateLanguageDiagnosticsRuntimeOptions {
  context: LanguageRuntimeContext;
  getDiagnosticsSource(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageDiagnosticsSource | undefined;
  getHostServices(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LineChangeHostServices | null;
  syncVisibleLanguageDecorations(): boolean;
}

export function createLanguageDiagnosticsRuntime(
  options: CreateLanguageDiagnosticsRuntimeOptions
): LanguageDiagnosticsRuntime {
  const remapDiagnosticsForChanges = (
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ) => {
    const presentation = options.context.getPresentation();

    if (changes.length === 0 || presentation.language.diagnostics.length === 0) {
      return;
    }

    presentation.language.diagnostics = presentation.language.diagnostics
      .map((diagnostic) => {
        const from = Math.max(
          0,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(diagnostic.from, changes, "left"))
        );
        const to = Math.max(
          from,
          Math.min(
            nextState.doc.length,
            mapOffsetThroughChanges(Math.max(diagnostic.from + 1, diagnostic.to), changes, "right")
          )
        );

        if (to <= from) {
          return null;
        }

        return {
          ...diagnostic,
          from,
          to
        };
      })
      .filter((diagnostic): diagnostic is EditorDiagnostic => diagnostic !== null);

    presentation.language.diagnosticsByLine = buildDiagnosticsCache(nextState.doc, presentation.language.diagnostics);
    options.syncVisibleLanguageDecorations();
  };

  const refreshDiagnostics = async (): Promise<void> => {
    const state = options.context.getState();
    const presentation = options.context.getPresentation();
    const diagnosticsSource = options.getDiagnosticsSource(presentation);
    const requestId = ++presentation.language.diagnosticsRequestId;

    if (!diagnosticsSource) {
      if (presentation.language.diagnostics.length > 0 || presentation.language.diagnosticsByLine.size > 0) {
        presentation.language.diagnostics = [];
        presentation.language.diagnosticsByLine.clear();
        options.syncVisibleLanguageDecorations();
        options.context.emitPresentationUpdate("language.diagnostics.clear");
      }
      return;
    }

    try {
      const nextDiagnostics = await diagnosticsSource.diagnostics(options.context.getSnapshot());

      if (requestId !== presentation.language.diagnosticsRequestId) {
        return;
      }

      presentation.language.diagnostics = nextDiagnostics;
      presentation.language.diagnosticsByLine = buildDiagnosticsCache(state.doc, nextDiagnostics);
      options.syncVisibleLanguageDecorations();
      options.context.emitPresentationUpdate("language.diagnostics");
    } catch {
      if (requestId !== presentation.language.diagnosticsRequestId) {
        return;
      }

      presentation.language.diagnostics = [];
      presentation.language.diagnosticsByLine = new Map() as DiagnosticsMap;
      options.syncVisibleLanguageDecorations();
      options.context.emitPresentationUpdate("language.diagnostics.error");
    }
  };

  const refreshLineChanges = async (): Promise<void> => {
    const state = options.context.getState();
    const presentation = options.context.getPresentation();
    const getLineChanges = options.getHostServices(presentation)?.getLineChanges;
    const requestId = ++presentation.language.lineChangesRequestId;

    if (!getLineChanges) {
      if (presentation.language.lineChangesByLine.size > 0) {
        presentation.language.lineChangesByLine.clear();
        options.syncVisibleLanguageDecorations();
        options.context.emitPresentationUpdate("language.line-changes.clear");
      }
      return;
    }

    try {
      const changes = await getLineChanges({
        filePath: presentation.filePath,
        text: state.doc.text
      });

      if (requestId !== presentation.language.lineChangesRequestId) {
        return;
      }

      presentation.language.lineChangesByLine = buildLineChangesMap(changes);
      options.syncVisibleLanguageDecorations();
      options.context.emitPresentationUpdate("language.line-changes");
    } catch {
      if (requestId !== presentation.language.lineChangesRequestId) {
        return;
      }

      presentation.language.lineChangesByLine = new Map<number, EditorLineChangeState>() as LineChangesMap;
      options.syncVisibleLanguageDecorations();
      options.context.emitPresentationUpdate("language.line-changes.error");
    }
  };

  const clearDiagnosticsState = () => {
    const presentation = options.context.getPresentation();
    presentation.language.diagnostics = [];
    presentation.language.diagnosticsByLine.clear();
    presentation.language.visibleDiagnostics = [];
    presentation.language.lineChangesByLine.clear();
    presentation.language.visibleLineChanges = [];
  };

  const resetDiagnosticsTracking = () => {
    const presentation = options.context.getPresentation();
    presentation.language.diagnosticsRequestId = 0;
    presentation.language.lineChangesRequestId = 0;
  };

  return {
    refreshDiagnostics,
    refreshLineChanges,
    clearDiagnosticsState,
    resetDiagnosticsTracking,
    remapDiagnosticsForChanges
  };
}
