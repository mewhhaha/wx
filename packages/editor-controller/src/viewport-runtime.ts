interface CreateViewportRuntimeOptions {
  viewport: {
    visibleRowCapacity: number;
    wrapColumns: number;
    softWrap: boolean;
    topVisualRow: number;
    visualRows: readonly unknown[];
  };
  resetViewportModelCache(): void;
  rebuildViewportModel(): void;
  revealSelectionWithinViewport(): boolean;
  syncVisibleViewportRows(): boolean;
  syncVisibleLanguageDecorations(): void;
  emitPresentationUpdate(effectType?: string): void;
  ensureVisibleHighlightCoverage(): Promise<void>;
}

export interface ViewportRuntime {
  setViewportMetrics(metrics: { visibleRowCapacity: number; wrapColumns: number; softWrap: boolean }): void;
  scrollViewportBy(rowsDelta: number): boolean;
  alignViewport(applyAlignment: () => number, effectType: string): boolean;
  revealSelection(effectType?: string): void;
}

export function createViewportRuntime(options: CreateViewportRuntimeOptions): ViewportRuntime {
  const {
    viewport,
    resetViewportModelCache,
    rebuildViewportModel,
    revealSelectionWithinViewport,
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations,
    emitPresentationUpdate,
    ensureVisibleHighlightCoverage
  } = options;

  const finalizeViewportChange = (effectType: string, changed: boolean) => {
    syncVisibleLanguageDecorations();
    emitPresentationUpdate(effectType);
    if (changed) {
      void ensureVisibleHighlightCoverage();
    }
  };

  return {
    setViewportMetrics(metrics) {
      viewport.visibleRowCapacity = Math.max(1, metrics.visibleRowCapacity);
      viewport.wrapColumns = Math.max(1, metrics.wrapColumns);
      viewport.softWrap = metrics.softWrap;
      resetViewportModelCache();
      rebuildViewportModel();
      const didReveal = revealSelectionWithinViewport();
      finalizeViewportChange("viewport.metrics", syncVisibleViewportRows() || didReveal);
    },
    scrollViewportBy(rowsDelta) {
      if (rowsDelta === 0) {
        return true;
      }

      rebuildViewportModel();
      const maxTop = Math.max(0, viewport.visualRows.length - viewport.visibleRowCapacity);
      const nextTop = Math.max(0, Math.min(maxTop, viewport.topVisualRow + rowsDelta));

      if (nextTop === viewport.topVisualRow) {
        return true;
      }

      viewport.topVisualRow = nextTop;
      finalizeViewportChange("viewport.scroll", syncVisibleViewportRows());
      return true;
    },
    alignViewport(applyAlignment, effectType) {
      rebuildViewportModel();
      const nextTop = applyAlignment();
      const changed = nextTop !== viewport.topVisualRow;
      viewport.topVisualRow = nextTop;
      finalizeViewportChange(effectType, syncVisibleViewportRows() || changed);
      return true;
    },
    revealSelection(effectType = "viewport.reveal") {
      const didReveal = revealSelectionWithinViewport();
      finalizeViewportChange(effectType, syncVisibleViewportRows() || didReveal);
    }
  };
}
