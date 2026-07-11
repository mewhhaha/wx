import {
  applyFormatterChanges,
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets,
  getSelectionOffsetsForRange
} from "@mewhhaha/wx-core";
import type {
  EditorCodeAction,
  EditorDiagnostic
} from "@mewhhaha/wx-language";

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
  interface HoverJob {
    offset: number;
    snapshot: ReturnType<LanguageRuntimeContext["getSnapshot"]>;
    source: LanguageHoverSource;
    requestId: number;
    generation: number;
    serviceGeneration: number;
    controller: AbortController;
    resolve(value: Awaited<ReturnType<LanguageHoverSource["hover"]>>): void;
    settled: boolean;
  }
  let hoverGeneration = 1;
  let activeHover: HoverJob | null = null;
  let pendingHover: HoverJob | null = null;

  const updateHoverDepth = () => {
    const stats = options.context.getPresentation().language.work.hover;
    stats.inFlight = activeHover ? 1 : 0;
    stats.queued = pendingHover ? 1 : 0;
    stats.maxQueueDepth = Math.max(stats.maxQueueDepth, stats.inFlight + stats.queued);
  };

  const settleHover = (job: HoverJob, value: Awaited<ReturnType<LanguageHoverSource["hover"]>>) => {
    if (job.settled) return;
    job.settled = true;
    job.resolve(value);
  };

  const pumpHover = () => {
    if (activeHover || !pendingHover) return;
    const job = pendingHover;
    pendingHover = null;
    activeHover = job;
    const stats = options.context.getPresentation().language.work.hover;
    stats.started += 1;
    updateHoverDepth();
    void job.source.hover(job.snapshot, job.offset, job.controller.signal).then((nextHover) => {
      const presentation = options.context.getPresentation();
      if (
        job.controller.signal.aborted ||
        job.generation !== hoverGeneration ||
        job.requestId !== presentation.language.hoverRequestId ||
        job.serviceGeneration !== presentation.language.serviceStatus.generation ||
        job.snapshot.revision !== options.context.getSnapshot().revision
      ) {
        stats.staleDropped += 1;
        settleHover(job, null);
        return;
      }
      settleHover(job, nextHover);
    }).catch(() => settleHover(job, null)).finally(() => {
      if (activeHover !== job) return;
      activeHover = null;
      stats.completed += 1;
      updateHoverDepth();
      pumpHover();
    });
  };

  const requestRawHover = (offset: number) => {
    const snapshot = options.context.getSnapshot();
    const presentation = options.context.getPresentation();
    const hoverSource = options.getHoverSource(presentation);
    if (!hoverSource) return Promise.resolve(null);

    const stats = presentation.language.work.hover;
    stats.requested += 1;
    const requestId = ++presentation.language.hoverRequestId;
    return new Promise<Awaited<ReturnType<LanguageHoverSource["hover"]>>>((resolve) => {
      const job: HoverJob = {
        offset,
        snapshot,
        source: hoverSource,
        requestId,
        generation: hoverGeneration,
        serviceGeneration: presentation.language.serviceStatus.generation,
        controller: new AbortController(),
        resolve,
        settled: false
      };
      if (pendingHover) {
        settleHover(pendingHover, null);
        stats.cancelled += 1;
      }
      pendingHover = job;
      if (activeHover && !activeHover.controller.signal.aborted) {
        activeHover.controller.abort();
        stats.cancelled += 1;
      }
      updateHoverDepth();
      pumpHover();
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
    const snapshot = options.context.getSnapshot();
    const formatter = options.getFormatter(options.context.getPresentation());

    if (!formatter) {
      return Promise.resolve(false);
    }

    const requests = state.selection.ranges.map((range) => formatter.format({
      document: snapshot,
      selection: getSelectionOffsetsForRange(state, range)
    }));
    const applyResults = (results: readonly (readonly import("@mewhhaha/wx-core").TextChange[] | null | undefined)[]) => {
        if (options.context.getSnapshot().revision !== snapshot.revision) {
          return false;
        }
        const changes = results.flatMap((result) => result ?? []);
        const transaction = applyFormatterChanges(state, changes);
        if (!transaction.changes?.length) return false;
        options.context.dispatch({ ...transaction, effects: [{ type: "language.format" }] });
        return true;
      };
    return (requests.length === 1
      ? requests[0]!.then((result) => applyResults([result]))
      : Promise.all(requests).then(applyResults)).catch(() => false);
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
    hoverGeneration += 1;
    presentation.language.hoverRequestId += 1;
    if (activeHover) {
      activeHover.controller.abort();
      settleHover(activeHover, null);
    }
    if (pendingHover) settleHover(pendingHover, null);
    activeHover = null;
    pendingHover = null;
    updateHoverDepth();
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
