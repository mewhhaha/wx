import {
  mapOffsetThroughChanges,
  type EditorState,
  type TextChange
} from "@mewhhaha/wx-core";
import type { EditorDiagnostic } from "@mewhhaha/wx-language";

import { buildDiagnosticsCache, buildLineChangesMap } from "./language-state";
import type {
  DiagnosticsMap,
  LanguageDiagnosticsRuntime,
  LanguageDiagnosticsSource,
  LanguageRuntimeContext,
  LineChangeHostServices,
  LineChangesMap
} from "./language-runtime-types";
import type { EditorLanguageWorkCounter, EditorLineChangeState } from "./types";

interface CreateLanguageDiagnosticsRuntimeOptions {
  context: LanguageRuntimeContext;
  getDiagnosticsSource(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageDiagnosticsSource | undefined;
  getHostServices(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LineChangeHostServices | null;
  syncVisibleLanguageDecorations(): boolean;
}

interface ScheduledJob {
  controller: AbortController;
  generation: number;
  waiters: Array<() => void>;
  settled: boolean;
}

function priorityDelay(
  presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>,
  workClass: "diagnostics" | "vcs-line-changes"
): number {
  return presentation.language.work.priorityPolicy.find((entry) => entry.class === workClass)?.delayMs ?? 0;
}

function createDebouncedLatestRunner(options: {
  delay(): number;
  stats(): EditorLanguageWorkCounter;
  run(signal: AbortSignal, generation: number): Promise<void>;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 1;
  let queuedWaiters: Array<() => void> = [];
  let active: ScheduledJob | null = null;

  const updateDepth = () => {
    const stats = options.stats();
    stats.inFlight = active ? 1 : 0;
    stats.queued = timer || queuedWaiters.length > 0 ? 1 : 0;
    stats.maxQueueDepth = Math.max(stats.maxQueueDepth, stats.inFlight + stats.queued);
  };

  const settle = (waiters: Array<() => void>) => {
    for (const resolve of waiters.splice(0)) resolve();
  };

  const arm = () => {
    if (active || queuedWaiters.length === 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const job: ScheduledJob = {
        controller: new AbortController(),
        generation,
        waiters: queuedWaiters,
        settled: false
      };
      queuedWaiters = [];
      active = job;
      const stats = options.stats();
      stats.started += 1;
      updateDepth();
      void options.run(job.controller.signal, job.generation).finally(() => {
        if (!job.settled) {
          job.settled = true;
          settle(job.waiters);
        }
        if (active !== job) return;
        active = null;
        options.stats().completed += 1;
        updateDepth();
        arm();
      });
      updateDepth();
    }, options.delay());
    updateDepth();
  };

  return {
    schedule(): Promise<void> {
      const stats = options.stats();
      stats.requested += 1;
      return new Promise<void>((resolve) => {
        queuedWaiters.push(resolve);
        if (active && !active.controller.signal.aborted) {
          active.controller.abort();
          stats.cancelled += 1;
        }
        if (!active) arm();
        updateDepth();
      });
    },
    isCurrent(runGeneration: number): boolean { return runGeneration === generation; },
    reset(): void {
      generation += 1;
      if (timer) clearTimeout(timer);
      timer = null;
      settle(queuedWaiters);
      queuedWaiters = [];
      if (active) {
        active.controller.abort();
        if (!active.settled) {
          active.settled = true;
          settle(active.waiters);
        }
      }
      active = null;
      updateDepth();
    }
  };
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

    if (changes.length === 0 || presentation.language.diagnostics.length === 0) return;

    presentation.language.diagnostics = presentation.language.diagnostics
      .map((diagnostic) => {
        const from = Math.max(0, Math.min(nextState.doc.length, mapOffsetThroughChanges(diagnostic.from, changes, "left")));
        const to = Math.max(
          from,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(Math.max(diagnostic.from + 1, diagnostic.to), changes, "right"))
        );
        return to <= from ? null : { ...diagnostic, from, to };
      })
      .filter((diagnostic): diagnostic is EditorDiagnostic => diagnostic !== null);

    presentation.language.diagnosticsByLine = buildDiagnosticsCache(nextState.doc, presentation.language.diagnostics);
    options.syncVisibleLanguageDecorations();
  };

  let diagnosticsRunner: ReturnType<typeof createDebouncedLatestRunner>;
  let lineChangesRunner: ReturnType<typeof createDebouncedLatestRunner>;

  const runDiagnostics = async (signal: AbortSignal, runnerGeneration: number): Promise<void> => {
    const presentation = options.context.getPresentation();
    const diagnosticsSource = options.getDiagnosticsSource(presentation);
    const snapshot = options.context.getSnapshot();
    const requestId = ++presentation.language.diagnosticsRequestId;
    const serviceGeneration = presentation.language.serviceStatus.generation;

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
      const nextDiagnostics = await diagnosticsSource.diagnostics(snapshot, signal);
      const nextPresentation = options.context.getPresentation();
      if (
        signal.aborted ||
        !diagnosticsRunner.isCurrent(runnerGeneration) ||
        requestId !== nextPresentation.language.diagnosticsRequestId ||
        serviceGeneration !== nextPresentation.language.serviceStatus.generation ||
        snapshot.revision !== options.context.getSnapshot().revision
      ) {
        nextPresentation.language.work.diagnostics.staleDropped += 1;
        return;
      }
      nextPresentation.language.diagnostics = nextDiagnostics;
      nextPresentation.language.diagnosticsByLine = buildDiagnosticsCache(snapshot.doc, nextDiagnostics);
      options.syncVisibleLanguageDecorations();
      options.context.emitPresentationUpdate("language.diagnostics");
    } catch {
      const nextPresentation = options.context.getPresentation();
      if (signal.aborted || !diagnosticsRunner.isCurrent(runnerGeneration) || requestId !== nextPresentation.language.diagnosticsRequestId) {
        nextPresentation.language.work.diagnostics.staleDropped += 1;
        return;
      }
      nextPresentation.language.diagnostics = [];
      nextPresentation.language.diagnosticsByLine = new Map() as DiagnosticsMap;
      options.syncVisibleLanguageDecorations();
      options.context.emitPresentationUpdate("language.diagnostics.error");
    }
  };

  const runLineChanges = async (signal: AbortSignal, runnerGeneration: number): Promise<void> => {
    const presentation = options.context.getPresentation();
    const getLineChanges = options.getHostServices(presentation)?.getLineChanges;
    const snapshot = options.context.getSnapshot();
    const requestId = ++presentation.language.lineChangesRequestId;
    const serviceGeneration = presentation.language.serviceStatus.generation;
    const filePath = presentation.filePath;

    if (!getLineChanges || !filePath) {
      if (presentation.language.lineChangesByLine.size > 0) {
        presentation.language.lineChangesByLine.clear();
        options.syncVisibleLanguageDecorations();
        options.context.emitPresentationUpdate("language.line-changes.clear");
      }
      return;
    }

    try {
      const changes = await getLineChanges({ filePath, text: snapshot.doc.text, signal });
      const nextPresentation = options.context.getPresentation();
      if (
        signal.aborted ||
        !lineChangesRunner.isCurrent(runnerGeneration) ||
        requestId !== nextPresentation.language.lineChangesRequestId ||
        serviceGeneration !== nextPresentation.language.serviceStatus.generation ||
        snapshot.revision !== options.context.getSnapshot().revision ||
        filePath !== nextPresentation.filePath
      ) {
        nextPresentation.language.work.lineChanges.staleDropped += 1;
        return;
      }
      nextPresentation.language.lineChangesByLine = buildLineChangesMap(changes);
      options.syncVisibleLanguageDecorations();
      options.context.emitPresentationUpdate("language.line-changes");
    } catch {
      const nextPresentation = options.context.getPresentation();
      if (signal.aborted || !lineChangesRunner.isCurrent(runnerGeneration) || requestId !== nextPresentation.language.lineChangesRequestId) {
        nextPresentation.language.work.lineChanges.staleDropped += 1;
        return;
      }
      nextPresentation.language.lineChangesByLine = new Map<number, EditorLineChangeState>() as LineChangesMap;
      options.syncVisibleLanguageDecorations();
      options.context.emitPresentationUpdate("language.line-changes.error");
    }
  };

  diagnosticsRunner = createDebouncedLatestRunner({
    delay: () => priorityDelay(options.context.getPresentation(), "diagnostics"),
    stats: () => options.context.getPresentation().language.work.diagnostics,
    run: runDiagnostics
  });
  lineChangesRunner = createDebouncedLatestRunner({
    delay: () => priorityDelay(options.context.getPresentation(), "vcs-line-changes"),
    stats: () => options.context.getPresentation().language.work.lineChanges,
    run: runLineChanges
  });

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
    presentation.language.diagnosticsRequestId += 1;
    presentation.language.lineChangesRequestId += 1;
    diagnosticsRunner.reset();
    lineChangesRunner.reset();
  };

  return {
    refreshDiagnostics: () => diagnosticsRunner.schedule(),
    refreshLineChanges: () => lineChangesRunner.schedule(),
    clearDiagnosticsState,
    resetDiagnosticsTracking,
    remapDiagnosticsForChanges
  };
}
