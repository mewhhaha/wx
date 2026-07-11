interface CreateViewportRuntimeOptions {
  viewport: {
    visibleRowCapacity: number;
    wrapColumns: number;
    softWrap: boolean;
  };
  resetViewportModelCache(): void;
  rebuildViewportModel(): void;
  revealSelectionWithinViewport(): boolean;
  scrollViewportWindow(rowsDelta: number): boolean;
  alignSelectionWithinViewport(position: "top" | "center" | "bottom"): boolean;
  syncVisibleViewportRows(): boolean;
  syncVisibleLanguageDecorations(): void;
  emitPresentationUpdate(effectType?: string): void;
  ensureVisibleHighlightCoverage(): Promise<void>;
}

export interface ViewportRuntime {
  setViewportMetrics(metrics: { visibleRowCapacity: number; wrapColumns: number; softWrap: boolean }): void;
  scrollViewportBy(rowsDelta: number): boolean;
  alignViewport(position: "top" | "center" | "bottom", effectType: string): boolean;
  revealSelection(effectType?: string): void;
}

export function createViewportRuntime(options: CreateViewportRuntimeOptions): ViewportRuntime {
  const {
    viewport,
    resetViewportModelCache,
    rebuildViewportModel,
    revealSelectionWithinViewport,
    scrollViewportWindow,
    alignSelectionWithinViewport,
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations,
    emitPresentationUpdate,
    ensureVisibleHighlightCoverage
  } = options;

  const finalizeViewportChange = (effectType: string, changed: boolean) => {
    syncVisibleLanguageDecorations();
    emitPresentationUpdate(effectType);
    if (changed) void ensureVisibleHighlightCoverage();
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
      if (rowsDelta === 0) return true;
      const changed = scrollViewportWindow(rowsDelta);
      if (changed) finalizeViewportChange("viewport.scroll", syncVisibleViewportRows());
      return true;
    },
    alignViewport(position, effectType) {
      const changed = alignSelectionWithinViewport(position);
      finalizeViewportChange(effectType, syncVisibleViewportRows() || changed);
      return true;
    },
    revealSelection(effectType = "viewport.reveal") {
      const didReveal = revealSelectionWithinViewport();
      finalizeViewportChange(effectType, syncVisibleViewportRows() || didReveal);
    }
  };
}
