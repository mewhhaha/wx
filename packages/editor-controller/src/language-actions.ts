import {
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets
} from "@wx/editor-core";
import type {
  EditorCodeAction,
  EditorDiagnostic
} from "@wx/editor-language";

import type {
  LanguageActionsRuntime,
  LanguageCodeActionSource,
  LanguageFormatter,
  LanguageHoverSource,
  LanguageRuntimeContext,
  LineChangeHostServices
} from "./language-runtime-types";

interface CreateLanguageActionsRuntimeOptions {
  context: LanguageRuntimeContext;
  getHoverSource(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageHoverSource | undefined;
  getCodeActionSource(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageCodeActionSource | undefined;
  getFormatter(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageFormatter | undefined;
  getHostServices(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LineChangeHostServices | null;
  refreshLineChanges(): Promise<void>;
}

function getActiveOffset(state: ReturnType<LanguageRuntimeContext["getState"]>): number {
  return state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
}

export function createLanguageActionsRuntime(options: CreateLanguageActionsRuntimeOptions): LanguageActionsRuntime {
  const requestRawHover = (offset: number) => {
    const snapshot = options.context.getSnapshot();
    const presentation = options.context.getPresentation();
    const hoverSource = options.getHoverSource(presentation);

    if (!hoverSource) {
      return Promise.resolve(null);
    }

    const requestId = ++presentation.language.hoverRequestId;
    const revision = snapshot.revision;
    return hoverSource.hover(snapshot, offset).then((nextHover) => {
      if (requestId !== presentation.language.hoverRequestId || revision !== options.context.getSnapshot().revision) {
        return null;
      }

      return nextHover;
    });
  };

  const getCodeActionContext = () => {
    const state = options.context.getState();
    const presentation = options.context.getPresentation();
    const selection = getSelectionOffsets(state);
    const overlappingDiagnostics = presentation.language.diagnostics.filter(
      (entry) => entry.from < selection.to && entry.to > selection.from
    );
    const activeLine = state.doc.positionAt(getActiveOffset(state)).line;
    const fallbackDiagnostics =
      overlappingDiagnostics.length > 0
        ? overlappingDiagnostics
        : presentation.language.diagnosticsByLine.get(activeLine) ?? [];

    return {
      document: options.context.getSnapshot(),
      selection,
      diagnostics: fallbackDiagnostics
    };
  };

  const requestCodeActions = () => {
    const codeActionSource = options.getCodeActionSource(options.context.getPresentation());

    if (!codeActionSource) {
      return Promise.resolve([]);
    }

    return codeActionSource.getCodeActions(getCodeActionContext()).catch(() => []);
  };

  const resolveCodeActionChanges = async (action: EditorCodeAction) => {
    if (action.changes && action.changes.length > 0) {
      return action.changes;
    }

    return (await action.apply?.(getCodeActionContext())) ?? null;
  };

  const applyCodeAction = (action: EditorCodeAction) => {
    if (action.changes && action.changes.length > 0) {
      options.context.dispatch({
        changes: action.changes,
        effects: [{ type: "language.code-action", value: action.title }]
      });
      return Promise.resolve(true);
    }

    return resolveCodeActionChanges(action).then((changes) => {
      if (!changes || changes.length === 0) {
        return false;
      }

      options.context.dispatch({
        changes,
        effects: [{ type: "language.code-action", value: action.title }]
      });
      return true;
    });
  };

  const formatDocument = () => {
    const state = options.context.getState();
    const formatter = options.getFormatter(options.context.getPresentation());

    if (!formatter) {
      return Promise.resolve(false);
    }

    return formatter
      .format({
        document: options.context.getSnapshot(),
        selection: getSelectionOffsets(state)
      })
      .then((changes) => {
        if (!changes || changes.length === 0) {
          return false;
        }

        options.context.dispatch({
          changes,
          effects: [{ type: "language.format" }]
        });
        return true;
      })
      .catch(() => false);
  };

  const saveDocument = (targetPath?: string | null) => {
    const state = options.context.getState();
    const presentation = options.context.getPresentation();
    const nextPath = targetPath ?? presentation.filePath;
    const writeFile = options.getHostServices(presentation)?.writeFile;

    if (!nextPath || !writeFile) {
      return Promise.resolve(false);
    }

    const savedText = state.doc.text;
    return writeFile({
      filePath: nextPath,
      text: savedText
    })
      .then(() => {
        presentation.filePath = nextPath;
        presentation.bufferTitle = nextPath;
        options.context.emitPresentationUpdate("presentation.file-path");
        void options.refreshLineChanges();
        queueMicrotask(() => {
          void Promise.resolve(
            options.getHostServices(presentation)?.didWriteFile?.({
              filePath: nextPath,
              text: savedText
            })
          ).catch(() => undefined);
        });
        return true;
      })
      .catch(() => false);
  };

  const resetActionTracking = () => {
    const presentation = options.context.getPresentation();
    presentation.language.hoverRequestId = 0;
  };

  return {
    requestRawHover,
    requestCodeActions,
    applyCodeAction,
    formatDocument,
    saveDocument,
    resetActionTracking
  };
}
