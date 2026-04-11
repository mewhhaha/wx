import {
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets,
  mapOffsetThroughChanges,
  type EditorState,
  type TextChange,
  type Transaction
} from "@wx/editor-core";
import type {
  EditorCodeAction,
  EditorDiagnostic,
  EditorHover,
  EditorLineRange,
  HighlightSpan
} from "@wx/editor-language";
import {
  buildDiagnosticsCache,
  buildHighlightCache,
  buildLineChangesMap,
  diagnosticsEqual,
  highlightMapsEqual,
  lineChangesEqual,
  remapHighlightSpans,
  spansEqual
} from "./language-state";
import type {
  EditorLineChange,
  EditorLineChangeState,
  EditorPresentationState
} from "./types";

interface Snapshot {
  revision: number;
  doc: EditorState["doc"];
}

interface LanguageRuntimeContext {
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getSearchMatchCache(): readonly { from: number; to: number }[];
  getVisibleLineViewport(): EditorLineRange;
  getVisibleHighlightViewport(): EditorLineRange;
  getSnapshot(): Snapshot;
  emitPresentationUpdate(effectType?: string): void;
  dispatch(transaction: Transaction): void;
}

function getActiveOffset(state: EditorState): number {
  return state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
}

function getHighlighter(presentation: EditorPresentationState) {
  return presentation.language.services.find((services) => services.highlighter)?.highlighter;
}

function getHoverSource(presentation: EditorPresentationState) {
  return presentation.language.services.find((services) => services.hover)?.hover;
}

function getDiagnosticsSource(presentation: EditorPresentationState) {
  return presentation.language.services.find((services) => services.diagnostics)?.diagnostics;
}

function getCodeActionSource(presentation: EditorPresentationState) {
  return presentation.language.services.find((services) => services.codeActions)?.codeActions;
}

function getFormatter(presentation: EditorPresentationState) {
  return presentation.language.services.find((services) => services.formatter)?.formatter;
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

export function createLanguageRuntime(context: LanguageRuntimeContext): LanguageRuntime {
  let inFlightVisibleHighlightRequestKey: string | null = null;
  let inFlightVisibleHighlightRequest: Promise<void> | null = null;

  const syncVisibleLanguageDecorations = (): boolean => {
    const state = context.getState();
    const presentation = context.getPresentation();
    const searchMatchCache = context.getSearchMatchCache();
    const viewport = context.getVisibleLineViewport();
    const visibleHighlights: HighlightSpan[] = [];
    const visibleHighlightsByLine = new Map<number, HighlightSpan[]>();
    const visibleDiagnostics: EditorDiagnostic[] = [];
    const visibleLineChanges: EditorLineChange[] = [];
    const visibleSearchMatchesByLine = new Map<number, { from: number; to: number }[]>();

    for (let lineIndex = viewport.fromLine; lineIndex <= viewport.toLine; lineIndex += 1) {
      const highlights = presentation.language.highlightCache.get(lineIndex);
      if (highlights && highlights.length > 0) {
        visibleHighlights.push(...highlights);
        visibleHighlightsByLine.set(lineIndex, highlights);
      }

      const lineDiagnostics = presentation.language.diagnosticsByLine.get(lineIndex);
      if (lineDiagnostics && lineDiagnostics.length > 0) {
        for (const diagnostic of lineDiagnostics) {
          if (
            visibleDiagnostics.length === 0 ||
            visibleDiagnostics[visibleDiagnostics.length - 1] !== diagnostic
          ) {
            visibleDiagnostics.push(diagnostic);
          }
        }
      }

      const lineChange = presentation.language.lineChangesByLine.get(lineIndex);
      const line = state.doc.lineAt(lineIndex);
      const lineEnd = line.start + line.text.length;
      const lineSearchMatches = searchMatchCache.filter((entry) => entry.from < lineEnd && entry.to > line.start);

      if (lineSearchMatches.length > 0) {
        visibleSearchMatchesByLine.set(lineIndex, lineSearchMatches);
      }

      if (!lineChange) {
        continue;
      }

      if (lineChange.kind) {
        visibleLineChanges.push({ line: lineIndex, kind: lineChange.kind });
      }

      if (lineChange.deleted) {
        visibleLineChanges.push({ line: lineIndex, kind: "deleted" });
      }
    }

    const highlightsChanged = !spansEqual(presentation.language.visibleHighlights, visibleHighlights);
    const highlightsByLineChanged = !highlightMapsEqual(
      presentation.language.visibleHighlightsByLine,
      visibleHighlightsByLine
    );
    const diagnosticsChanged = !diagnosticsEqual(presentation.language.visibleDiagnostics, visibleDiagnostics);
    const lineChangesChanged = !lineChangesEqual(presentation.language.visibleLineChanges, visibleLineChanges);
    const searchChanged = !searchMatchesByLineEqual(
      presentation.search.visibleMatchesByLine,
      visibleSearchMatchesByLine
    );

    presentation.language.visibleHighlights = visibleHighlights;
    presentation.language.visibleHighlightsByLine = visibleHighlightsByLine;
    presentation.language.visibleDiagnostics = visibleDiagnostics;
    presentation.language.visibleLineChanges = visibleLineChanges;
    presentation.search.visibleMatchesByLine = visibleSearchMatchesByLine;

    return highlightsChanged || highlightsByLineChanged || diagnosticsChanged || lineChangesChanged || searchChanged;
  };

  const hasMissingHighlightCoverage = (viewport: EditorLineRange): boolean => {
    const presentation = context.getPresentation();

    for (let lineIndex = viewport.fromLine; lineIndex <= viewport.toLine; lineIndex += 1) {
      if (!presentation.language.highlightCoverage.has(lineIndex)) {
        return true;
      }
    }

    return false;
  };

  const getChangedHighlightViewport = (
    nextState: EditorState,
    changes: readonly TextChange[]
  ): EditorLineRange | null => {
    if (changes.length === 0) {
      return null;
    }

    let fromLine = Number.POSITIVE_INFINITY;
    let toLine = 0;

    for (const change of changes) {
      const nextStartLine = nextState.doc.positionAt(change.from).line;
      const nextEndOffset = change.insert.length > 0 ? change.from + change.insert.length - 1 : change.from;
      const nextEndLine = nextState.doc.positionAt(Math.min(nextEndOffset, nextState.doc.length)).line;
      fromLine = Math.min(fromLine, nextStartLine);
      toLine = Math.max(toLine, nextEndLine);
    }

    if (!Number.isFinite(fromLine)) {
      return null;
    }

    return {
      fromLine: Math.max(0, fromLine - 2),
      toLine: Math.min(nextState.doc.lineCount - 1, toLine + 2)
    };
  };

  const invalidateHighlightViewport = (viewport: EditorLineRange) => {
    const presentation = context.getPresentation();

    for (let index = viewport.fromLine; index <= viewport.toLine; index += 1) {
      presentation.language.highlightCoverage.delete(index);
    }
  };

  const replaceHighlightCache = (spans: HighlightSpan[], viewport: EditorLineRange): boolean => {
    const state = context.getState();
    const presentation = context.getPresentation();
    const nextCache = buildHighlightCache(state.doc, spans);
    let hasVisibleDirty = false;

    for (let index = viewport.fromLine; index <= viewport.toLine; index += 1) {
      presentation.language.highlightCoverage.add(index);
      const previous = presentation.language.highlightCache.get(index) ?? [];
      const next = nextCache.get(index) ?? [];

      if (!spansEqual(previous, next)) {
        hasVisibleDirty = true;
      }

      if (next.length > 0) {
        presentation.language.highlightCache.set(index, next);
      } else {
        presentation.language.highlightCache.delete(index);
      }
    }

    return hasVisibleDirty;
  };

  const remapHighlightCacheForChanges = (
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ) => {
    if (changes.length === 0) {
      return;
    }

    const presentation = context.getPresentation();
    const nextCache = new Map<number, HighlightSpan[]>();

    for (const spans of presentation.language.highlightCache.values()) {
      for (const span of spans) {
        const originalLength = Math.max(0, span.to - span.from);
        const hasOverlappingChange = changes.some((change) => change.from < span.to && change.to > span.from);
        const startAffinity = changes.some(
          (change) => change.from === span.from && change.to === span.from && change.insert.length > 0
        )
          ? "right"
          : "left";
        const mappedFrom = Math.max(
          0,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(span.from, changes, startAffinity))
        );
        const nextTo = Math.max(
          mappedFrom,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(span.to, changes, "right"))
        );
        const mappedTo = hasOverlappingChange
          ? nextTo
          : Math.max(mappedFrom, Math.min(nextState.doc.length, mappedFrom + originalLength));

        if (mappedTo <= mappedFrom) {
          continue;
        }

        const startLine = nextState.doc.positionAt(mappedFrom).line;
        const endLine = nextState.doc.positionAt(Math.max(mappedFrom, mappedTo - 1)).line;

        for (let line = startLine; line <= endLine; line += 1) {
          const lineInfo = nextState.doc.lineAt(line);
          const from = Math.max(mappedFrom, lineInfo.start);
          const to = Math.min(mappedTo, lineInfo.end);

          if (to <= from) {
            continue;
          }

          const entry = nextCache.get(line);
          const clipped = { from, to, role: span.role };

          if (entry) {
            entry.push(clipped);
          } else {
            nextCache.set(line, [clipped]);
          }
        }
      }
    }

    presentation.language.highlightCache = nextCache;
    syncVisibleLanguageDecorations();
  };

  const remapHighlightCoverageForChanges = (
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ) => {
    if (changes.length === 0) {
      return;
    }

    const presentation = context.getPresentation();
    const nextCoverage = new Set<number>();

    for (const lineIndex of presentation.language.highlightCoverage) {
      const previousLine = previousState.doc.lineAt(lineIndex);
      const mappedOffset = Math.max(
        0,
        Math.min(nextState.doc.length, mapOffsetThroughChanges(previousLine.start, changes, "left"))
      );
      nextCoverage.add(nextState.doc.positionAt(mappedOffset).line);
    }

    presentation.language.highlightCoverage = nextCoverage;
  };

  const remapDiagnosticsForChanges = (
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ) => {
    const presentation = context.getPresentation();

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
          Math.min(nextState.doc.length, mapOffsetThroughChanges(Math.max(diagnostic.from + 1, diagnostic.to), changes, "right"))
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
    syncVisibleLanguageDecorations();
  };

  const refreshHighlights = async (viewport: EditorLineRange, force = false): Promise<void> => {
    const snapshot = context.getSnapshot();
    const presentation = context.getPresentation();
    const highlighter = getHighlighter(presentation);

    if (!highlighter || presentation.language.languageRevision < 0) {
      if (presentation.language.highlightCache.size > 0) {
        presentation.language.highlightCache.clear();
        presentation.language.highlightCoverage.clear();
        presentation.language.visibleHighlightsByLine.clear();
        syncVisibleLanguageDecorations();
        context.emitPresentationUpdate("language.highlights.clear");
      }
      return;
    }

    if (presentation.language.languageRevision !== snapshot.revision) {
      return;
    }

    const needsViewportHighlights =
      force ||
      presentation.language.lastHighlightedRevision !== presentation.language.languageRevision ||
      hasMissingHighlightCoverage(viewport);

    if (!needsViewportHighlights) {
      return;
    }

    const requestId = ++presentation.language.highlightRequestId;
    const next = await highlighter.getHighlights(viewport, presentation.language.languageRevision);

    if (requestId !== presentation.language.highlightRequestId) {
      return;
    }

    const changed = replaceHighlightCache(next, viewport);
    presentation.language.lastHighlightedRevision = presentation.language.languageRevision;
    const visibleChanged = syncVisibleLanguageDecorations();

    if (changed || visibleChanged) {
      context.emitPresentationUpdate("language.highlights");
    }
  };

  const ensureVisibleHighlightCoverage = (force = false): Promise<void> => {
    const snapshot = context.getSnapshot();
    const presentation = context.getPresentation();
    const highlighter = getHighlighter(presentation);

    if (!highlighter || presentation.language.languageRevision < 0) {
      return Promise.resolve();
    }

    if (presentation.language.languageRevision !== snapshot.revision) {
      return Promise.resolve();
    }

    const viewport = context.getVisibleHighlightViewport();
    const needsViewportHighlights =
      force ||
      presentation.language.lastHighlightedRevision !== presentation.language.languageRevision ||
      hasMissingHighlightCoverage(viewport);

    if (!needsViewportHighlights) {
      return Promise.resolve();
    }

    const requestKey = `${presentation.language.languageRevision}:${viewport.fromLine}:${viewport.toLine}:${force ? 1 : 0}`;

    if (inFlightVisibleHighlightRequestKey === requestKey) {
      return inFlightVisibleHighlightRequest ?? Promise.resolve();
    }

    inFlightVisibleHighlightRequestKey = requestKey;
    inFlightVisibleHighlightRequest = refreshHighlights(viewport, force).finally(() => {
      if (inFlightVisibleHighlightRequestKey === requestKey) {
        inFlightVisibleHighlightRequestKey = null;
        inFlightVisibleHighlightRequest = null;
      }
    });
    return inFlightVisibleHighlightRequest;
  };

  const refreshDiagnostics = async (): Promise<void> => {
    const state = context.getState();
    const presentation = context.getPresentation();
    const diagnosticsSource = getDiagnosticsSource(presentation);
    const requestId = ++presentation.language.diagnosticsRequestId;

    if (!diagnosticsSource) {
      if (presentation.language.diagnostics.length > 0 || presentation.language.diagnosticsByLine.size > 0) {
        presentation.language.diagnostics = [];
        presentation.language.diagnosticsByLine.clear();
        syncVisibleLanguageDecorations();
        context.emitPresentationUpdate("language.diagnostics.clear");
      }
      return;
    }

    try {
      const nextDiagnostics = await diagnosticsSource.diagnostics(context.getSnapshot());

      if (requestId !== presentation.language.diagnosticsRequestId) {
        return;
      }

      presentation.language.diagnostics = nextDiagnostics;
      presentation.language.diagnosticsByLine = buildDiagnosticsCache(state.doc, nextDiagnostics);
      syncVisibleLanguageDecorations();
      context.emitPresentationUpdate("language.diagnostics");
    } catch {
      if (requestId !== presentation.language.diagnosticsRequestId) {
        return;
      }

      presentation.language.diagnostics = [];
      presentation.language.diagnosticsByLine = new Map();
      syncVisibleLanguageDecorations();
      context.emitPresentationUpdate("language.diagnostics.error");
    }
  };

  const refreshLineChanges = async (): Promise<void> => {
    const state = context.getState();
    const presentation = context.getPresentation();
    const getLineChanges = presentation.language.host?.getLineChanges;
    const requestId = ++presentation.language.lineChangesRequestId;

    if (!getLineChanges) {
      if (presentation.language.lineChangesByLine.size > 0) {
        presentation.language.lineChangesByLine.clear();
        syncVisibleLanguageDecorations();
        context.emitPresentationUpdate("language.line-changes.clear");
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
      syncVisibleLanguageDecorations();
      context.emitPresentationUpdate("language.line-changes");
    } catch {
      if (requestId !== presentation.language.lineChangesRequestId) {
        return;
      }

      presentation.language.lineChangesByLine = new Map<number, EditorLineChangeState>();
      syncVisibleLanguageDecorations();
      context.emitPresentationUpdate("language.line-changes.error");
    }
  };

  const syncLanguage = async (options: {
    changes?: readonly TextChange[];
    forceDocumentSync?: boolean;
    highlightViewport?: EditorLineRange;
    refreshHighlights?: boolean;
    refreshDiagnostics?: boolean;
    refreshLineChanges?: boolean;
  } = {}): Promise<void> => {
    const snapshot = context.getSnapshot();
    const presentation = context.getPresentation();
    const changes = options.changes ?? [];
    const forceDocumentSync = options.forceDocumentSync ?? false;
    const shouldRefreshHighlights = options.refreshHighlights ?? true;
    const shouldRefreshDiagnostics = options.refreshDiagnostics ?? true;
    const shouldRefreshLineChanges = options.refreshLineChanges ?? true;
    const highlightViewport = options.highlightViewport ?? context.getVisibleHighlightViewport();

    if (changes.length > 0) {
      invalidateHighlightViewport(highlightViewport);
    }

    const highlighter = getHighlighter(presentation);

    if (highlighter && shouldRefreshHighlights) {
      if (forceDocumentSync || presentation.language.languageRevision < 0) {
        await highlighter.open(snapshot);
        presentation.language.languageRevision = snapshot.revision;
        presentation.language.lastHighlightedRevision = -1;
        await refreshHighlights(highlightViewport, true);
      } else if (changes.length > 0) {
        await highlighter.update(snapshot, changes);
        presentation.language.languageRevision = snapshot.revision;
        presentation.language.lastHighlightedRevision = -1;
        await refreshHighlights(highlightViewport, true);
      } else if (presentation.language.languageRevision === snapshot.revision) {
        await refreshHighlights(highlightViewport, false);
      }

      await ensureVisibleHighlightCoverage(false);
    }

    if (shouldRefreshDiagnostics) {
      void refreshDiagnostics();
    }

    if (shouldRefreshLineChanges) {
      void refreshLineChanges();
    }
  };

  const handleDocumentChange = (
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ) => {
    const presentation = context.getPresentation();
    presentation.language.lastHighlightedRevision = -1;

    if (changes.length > 0) {
      presentation.language.visibleHighlights = remapHighlightSpans(
        nextState.doc,
        presentation.language.visibleHighlights,
        changes
      );
      remapHighlightCacheForChanges(previousState, nextState, changes);
      remapHighlightCoverageForChanges(previousState, nextState, changes);
      remapDiagnosticsForChanges(previousState, nextState, changes);
      const changedViewport = getChangedHighlightViewport(nextState, changes);
      if (changedViewport) {
        invalidateHighlightViewport(changedViewport);
      }
      return;
    }

    presentation.language.highlightCoverage.clear();
    presentation.language.visibleHighlights = [];
    presentation.language.visibleHighlightsByLine = new Map();
    presentation.language.visibleDiagnostics = [];
    presentation.language.visibleLineChanges = [];
  };

  const clearLanguageState = () => {
    const presentation = context.getPresentation();
    presentation.language.highlightCache.clear();
    presentation.language.highlightCoverage.clear();
    presentation.language.visibleHighlights = [];
    presentation.language.visibleHighlightsByLine = new Map();
    presentation.language.diagnostics = [];
    presentation.language.diagnosticsByLine.clear();
    presentation.language.visibleDiagnostics = [];
    presentation.language.lineChangesByLine.clear();
    presentation.language.visibleLineChanges = [];
    presentation.search.visibleMatchesByLine = new Map();
  };

  const resetRequestTracking = () => {
    const presentation = context.getPresentation();
    presentation.language.languageRevision = -1;
    presentation.language.lastHighlightedRevision = -1;
    presentation.language.highlightRequestId = 0;
    presentation.language.diagnosticsRequestId = 0;
    presentation.language.lineChangesRequestId = 0;
    presentation.language.hoverRequestId = 0;
    inFlightVisibleHighlightRequestKey = null;
    inFlightVisibleHighlightRequest = null;
  };

  const requestRawHover = (offset: number) => {
    const snapshot = context.getSnapshot();
    const presentation = context.getPresentation();
    const hoverSource = getHoverSource(presentation);

    if (!hoverSource) {
      return Promise.resolve(null);
    }

    const requestId = ++presentation.language.hoverRequestId;
    const revision = snapshot.revision;
    return hoverSource.hover(snapshot, offset).then((nextHover) => {
      if (requestId !== presentation.language.hoverRequestId || revision !== context.getSnapshot().revision) {
        return null;
      }

      return nextHover;
    });
  };

  const getCodeActionContext = () => {
    const state = context.getState();
    const presentation = context.getPresentation();
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
      document: context.getSnapshot(),
      selection,
      diagnostics: fallbackDiagnostics
    };
  };

  const requestCodeActions = () => {
    const codeActionSource = getCodeActionSource(context.getPresentation());

    if (!codeActionSource) {
      return Promise.resolve([]);
    }

    return codeActionSource.getCodeActions(getCodeActionContext()).catch(() => []);
  };

  const resolveCodeActionChanges = async (action: EditorCodeAction): Promise<readonly TextChange[] | null> => {
    if (action.changes && action.changes.length > 0) {
      return action.changes;
    }

    return (await action.apply?.(getCodeActionContext())) ?? null;
  };

  const applyCodeAction = (action: EditorCodeAction) => {
    if (action.changes && action.changes.length > 0) {
      context.dispatch({
        changes: action.changes,
        effects: [{ type: "language.code-action", value: action.title }]
      });
      return Promise.resolve(true);
    }

    return resolveCodeActionChanges(action).then((changes) => {
      if (!changes || changes.length === 0) {
        return false;
      }

      context.dispatch({
        changes,
        effects: [{ type: "language.code-action", value: action.title }]
      });
      return true;
    });
  };

  const formatDocument = () => {
    const state = context.getState();
    const formatter = getFormatter(context.getPresentation());

    if (!formatter) {
      return Promise.resolve(false);
    }

    return formatter
      .format({
        document: context.getSnapshot(),
        selection: getSelectionOffsets(state)
      })
      .then((changes) => {
        if (!changes || changes.length === 0) {
          return false;
        }

        context.dispatch({
          changes,
          effects: [{ type: "language.format" }]
        });
        return true;
      })
      .catch(() => false);
  };

  const saveDocument = (targetPath?: string) => {
    const state = context.getState();
    const presentation = context.getPresentation();
    const nextPath = targetPath ?? presentation.filePath;
    const writeFile = presentation.language.host?.writeFile;

    if (!writeFile) {
      return Promise.resolve(false);
    }

    const savedText = state.doc.text;
    return writeFile({
      filePath: nextPath,
      text: savedText
    })
      .then(() => {
        presentation.filePath = nextPath;
        context.emitPresentationUpdate("presentation.file-path");
        void refreshLineChanges();
        queueMicrotask(() => {
          void Promise.resolve(
            presentation.language.host?.didWriteFile?.({
              filePath: nextPath,
              text: savedText
            })
          ).catch(() => undefined);
        });
        return true;
      })
      .catch(() => false);
  };

  return {
    syncVisibleLanguageDecorations,
    handleDocumentChange,
    clearLanguageState,
    resetRequestTracking,
    requestRawHover,
    ensureVisibleHighlightCoverage,
    syncLanguage,
    refreshLineChanges,
    requestCodeActions,
    applyCodeAction,
    formatDocument,
    saveDocument
  };
}

function searchMatchesEqual(
  left: readonly { from: number; to: number }[],
  right: readonly { from: number; to: number }[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    return !!other && entry.from === other.from && entry.to === other.to;
  });
}

function searchMatchesByLineEqual(
  left: ReadonlyMap<number, readonly { from: number; to: number }[]>,
  right: ReadonlyMap<number, readonly { from: number; to: number }[]>
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [line, matches] of left) {
    const other = right.get(line);
    if (!other || !searchMatchesEqual(matches, other)) {
      return false;
    }
  }

  return true;
}
