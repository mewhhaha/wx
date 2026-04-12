import {
  mapOffsetThroughChanges,
  type EditorState,
  type TextChange
} from "@wx/editor-core";
import type {
  EditorDiagnostic,
  EditorLineRange,
  HighlightSpan
} from "@wx/editor-language";

import {
  buildHighlightCache,
  diagnosticsEqual,
  highlightMapsEqual,
  lineChangesEqual,
  remapHighlightSpans,
  spansEqual
} from "./language-state";
import type {
  LanguageHighlighter,
  LanguageHighlightsRuntime,
  LanguageRuntimeContext
} from "./language-runtime-types";

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

interface CreateLanguageHighlightsRuntimeOptions {
  context: LanguageRuntimeContext;
  getHighlighter(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageHighlighter | undefined;
}

export function createLanguageHighlightsRuntime(options: CreateLanguageHighlightsRuntimeOptions): LanguageHighlightsRuntime {
  let inFlightVisibleHighlightRequestKey: string | null = null;
  let inFlightVisibleHighlightRequest: Promise<void> | null = null;

  const syncVisibleLanguageDecorations = (): boolean => {
    const state = options.context.getState();
    const presentation = options.context.getPresentation();
    const searchMatchCache = options.context.getSearchMatchCache();
    const viewport = options.context.getVisibleLineViewport();
    const visibleHighlights: HighlightSpan[] = [];
    const visibleHighlightsByLine = new Map<number, HighlightSpan[]>();
    const visibleDiagnostics: EditorDiagnostic[] = [];
    const visibleLineChanges: Array<{ line: number; kind: "added" | "modified" | "deleted" }> = [];
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
          if (visibleDiagnostics.length === 0 || visibleDiagnostics[visibleDiagnostics.length - 1] !== diagnostic) {
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
    const presentation = options.context.getPresentation();

    for (let lineIndex = viewport.fromLine; lineIndex <= viewport.toLine; lineIndex += 1) {
      if (!presentation.language.highlightCoverage.has(lineIndex)) {
        return true;
      }
    }

    return false;
  };

  const getChangedHighlightViewport = (nextState: EditorState, changes: readonly TextChange[]): EditorLineRange | null => {
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
    const presentation = options.context.getPresentation();
    for (let index = viewport.fromLine; index <= viewport.toLine; index += 1) {
      presentation.language.highlightCoverage.delete(index);
    }
  };

  const replaceHighlightCache = (spans: HighlightSpan[], viewport: EditorLineRange): boolean => {
    const state = options.context.getState();
    const presentation = options.context.getPresentation();
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

    const presentation = options.context.getPresentation();
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

    const presentation = options.context.getPresentation();
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

  const refreshHighlights = async (viewport: EditorLineRange, force = false): Promise<void> => {
    const snapshot = options.context.getSnapshot();
    const presentation = options.context.getPresentation();
    const highlighter = options.getHighlighter(presentation);

    if (!highlighter || presentation.language.languageRevision < 0) {
      if (presentation.language.highlightCache.size > 0) {
        presentation.language.highlightCache.clear();
        presentation.language.highlightCoverage.clear();
        presentation.language.visibleHighlightsByLine.clear();
        syncVisibleLanguageDecorations();
        options.context.emitPresentationUpdate("language.highlights.clear");
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
      options.context.emitPresentationUpdate("language.highlights");
    }
  };

  const ensureVisibleHighlightCoverage = (force = false): Promise<void> => {
    const snapshot = options.context.getSnapshot();
    const presentation = options.context.getPresentation();
    const highlighter = options.getHighlighter(presentation);

    if (!highlighter || presentation.language.languageRevision < 0) {
      return Promise.resolve();
    }

    if (presentation.language.languageRevision !== snapshot.revision) {
      return Promise.resolve();
    }

    const viewport = options.context.getVisibleHighlightViewport();
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

  const syncLanguageHighlights = async (
    runtimeOptions: {
      changes?: readonly TextChange[];
      forceDocumentSync?: boolean;
      highlightViewport?: EditorLineRange;
      refreshHighlights?: boolean;
    } = {}
  ) => {
    const snapshot = options.context.getSnapshot();
    const presentation = options.context.getPresentation();
    const changes = runtimeOptions.changes ?? [];
    const forceDocumentSync = runtimeOptions.forceDocumentSync ?? false;
    const shouldRefreshHighlights = runtimeOptions.refreshHighlights ?? true;
    const highlightViewport = runtimeOptions.highlightViewport ?? options.context.getVisibleHighlightViewport();

    if (changes.length > 0) {
      invalidateHighlightViewport(highlightViewport);
    }

    const highlighter = options.getHighlighter(presentation);
    if (!highlighter || !shouldRefreshHighlights) {
      return;
    }

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
  };

  const handleDocumentChange = (previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]) => {
    const presentation = options.context.getPresentation();
    presentation.language.lastHighlightedRevision = -1;

    if (changes.length > 0) {
      presentation.language.visibleHighlights = remapHighlightSpans(
        nextState.doc,
        presentation.language.visibleHighlights,
        changes
      );
      remapHighlightCacheForChanges(previousState, nextState, changes);
      remapHighlightCoverageForChanges(previousState, nextState, changes);
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

  const clearHighlightState = () => {
    const presentation = options.context.getPresentation();
    presentation.language.highlightCache.clear();
    presentation.language.highlightCoverage.clear();
    presentation.language.visibleHighlights = [];
    presentation.language.visibleHighlightsByLine = new Map();
    presentation.search.visibleMatchesByLine = new Map();
  };

  const resetHighlightTracking = () => {
    const presentation = options.context.getPresentation();
    presentation.language.languageRevision = -1;
    presentation.language.lastHighlightedRevision = -1;
    presentation.language.highlightRequestId = 0;
    inFlightVisibleHighlightRequestKey = null;
    inFlightVisibleHighlightRequest = null;
  };

  return {
    syncVisibleLanguageDecorations,
    handleDocumentChange,
    clearHighlightState,
    resetHighlightTracking,
    ensureVisibleHighlightCoverage,
    syncLanguageHighlights
  };
}
