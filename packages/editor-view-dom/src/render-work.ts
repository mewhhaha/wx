export interface EditorRenderWorkInput {
  hasDocumentChanges: boolean;
  selectionChanged: boolean;
  modeChanged: boolean;
  insertModeTransition: boolean;
  viewportChanged: boolean;
  digitsChanged: boolean;
  isPresentationOnlyUpdate: boolean;
  hasDirtyLines: boolean;
  effectTypes: readonly string[];
  themeChanged: boolean;
  statusChanged: boolean;
  bottomBarChanged: boolean;
  tooltipChanged: boolean;
}

export interface EditorRenderWork {
  refreshGutterMetrics: boolean;
  syncTheme: boolean;
  renderVisibleRows: boolean;
  trySimpleCursorPatch: boolean;
  tryDirtyRowPatch: boolean;
  patchStatus: boolean;
  patchBottomRow: boolean;
  patchTooltip: boolean;
}

function effectTouchesRows(effectType: string): boolean {
  return (
    effectType.startsWith("language.") ||
    effectType.startsWith("search.") ||
    effectType.startsWith("flash.") ||
    effectType === "viewport.metrics" ||
    effectType === "viewport.scroll" ||
    effectType === "viewport.align" ||
    effectType === "viewport.reveal"
  );
}

export function computeRenderWork(input: EditorRenderWorkInput): EditorRenderWork {
  const rowEffect = input.effectTypes.some(effectTouchesRows);

  if (input.hasDocumentChanges) {
    return {
      refreshGutterMetrics: input.digitsChanged,
      syncTheme: input.themeChanged,
      renderVisibleRows: true,
      trySimpleCursorPatch: false,
      tryDirtyRowPatch: false,
      patchStatus: input.statusChanged,
      patchBottomRow: input.bottomBarChanged,
      patchTooltip: input.tooltipChanged
    };
  }

  if (input.viewportChanged) {
    return {
      refreshGutterMetrics: input.digitsChanged,
      syncTheme: input.themeChanged,
      renderVisibleRows: true,
      trySimpleCursorPatch: false,
      tryDirtyRowPatch: false,
      patchStatus: input.statusChanged,
      patchBottomRow: input.bottomBarChanged,
      patchTooltip: input.tooltipChanged
    };
  }

  if (input.isPresentationOnlyUpdate) {
    return {
      refreshGutterMetrics: false,
      syncTheme: input.themeChanged,
      renderVisibleRows: rowEffect,
      trySimpleCursorPatch: false,
      tryDirtyRowPatch: false,
      patchStatus: input.statusChanged,
      patchBottomRow: input.bottomBarChanged,
      patchTooltip: input.tooltipChanged
    };
  }

  if (input.hasDirtyLines && !input.insertModeTransition) {
    return {
      refreshGutterMetrics: input.digitsChanged,
      syncTheme: input.themeChanged,
      renderVisibleRows: false,
      trySimpleCursorPatch: true,
      tryDirtyRowPatch: true,
      patchStatus: input.statusChanged,
      patchBottomRow: input.bottomBarChanged,
      patchTooltip: input.tooltipChanged
    };
  }

  return {
    refreshGutterMetrics: input.digitsChanged,
    syncTheme: input.themeChanged,
    renderVisibleRows: true,
    trySimpleCursorPatch: false,
    tryDirtyRowPatch: false,
    patchStatus: input.statusChanged,
    patchBottomRow: input.bottomBarChanged,
    patchTooltip: input.tooltipChanged
  };
}
