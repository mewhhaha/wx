import type { EditorState, TextChange } from "@mewhhaha/wx-core";
import type { EditorVisualRow } from "@mewhhaha/wx-layout";

import {
  getVisibleHighlightViewport as getVisibleHighlightViewportFromPresentation,
  getVisibleLineViewport as getVisibleLineViewportFromPresentation
} from "./viewport";
import { ViewportWindowModel } from "./viewport-window";
import type { EditorPresentationState } from "./types";

interface CreateViewportModelRuntimeOptions {
  getState(): EditorState;
  presentation: EditorPresentationState;
  getActiveOffset(): number;
  dispatchOffsetSelection(targetOffset: number, preferredColumn: number | null): boolean;
}

export interface ViewportModelRuntime {
  resetViewportModelCache(): void;
  rebuildViewportModel(): void;
  handleDocumentChange(previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]): void;
  getVisibleLineViewportValue(): { fromLine: number; toLine: number };
  getVisibleHighlightViewportValue(): { fromLine: number; toLine: number };
  getVisibleLineCount(): number;
  moveByVisualRows(delta: number): boolean;
  gotoVisibleRow(position: "top" | "center" | "bottom"): boolean;
  revealSelectionWithinViewport(): boolean;
  scrollViewportBy(rowsDelta: number): boolean;
  alignSelectionWithinViewport(position: "top" | "center" | "bottom"): boolean;
}

export function createViewportModelRuntime(options: CreateViewportModelRuntimeOptions): ViewportModelRuntime {
  const { presentation } = options;
  let state = options.getState();
  let documentRevision = 0;
  let forceReconfigure = false;
  let model = new ViewportWindowModel({
    doc: state.doc,
    documentRevision,
    visibleRowCapacity: presentation.viewport.visibleRowCapacity,
    softWrap: presentation.viewport.softWrap,
    wrapColumns: presentation.viewport.wrapColumns,
    topAnchorOffset: 0
  });
  let indexedDoc = state.doc;
  let indexedCapacity = presentation.viewport.visibleRowCapacity;
  let indexedWrapColumns = presentation.viewport.wrapColumns;
  let indexedSoftWrap = presentation.viewport.softWrap;

  const getState = () => options.getState();

  const recordWork = (reason: string, rowsRebuilt: number) => {
    const counters = model.visualIndex.counters;
    presentation.viewport.layoutWork = {
      reason,
      rowsVisited: counters.rowsVisited,
      rowsRebuilt,
      mappingEntriesBuilt: counters.mappingEntriesBuilt,
      mappingCacheHits: counters.mappingCacheHits
    };
  };

  const syncPresentation = () => {
    const window = model.window;
    const rows = window.rows.map((row, index) => ({
      ...row,
      // Wrapped global ordinals are deliberately not computed. This bounded
      // local index is unique; `id` remains the stable geometry identity.
      visualRowIndex: presentation.viewport.softWrap ? index : row.docLine
    })) as EditorVisualRow[];
    const visibleRows = rows.slice(window.visibleOffset, window.visibleOffset + window.visibleCount);
    presentation.viewport.visualRows = rows;
    presentation.viewport.visibleVisualRows = visibleRows;
    // Window rows carry their line and segment directly. Keeping this empty
    // avoids a sparse array whose length grows with the document; layout's
    // offset resolver searches the bounded row window first.
    presentation.viewport.lineVisualRanges = [];
    presentation.viewport.totalVisualRows = window.total.value;
    presentation.viewport.totalVisualRowsExact = window.total.exact;
    presentation.viewport.topVisualRow = visibleRows[0]?.visualRowIndex ?? 0;
    presentation.viewport.wrapRevision = getState().revision;
  };

  const rebuildViewportModel = () => {
    state = getState();
    const docChanged = indexedDoc !== state.doc;
    const metricsChanged =
      indexedCapacity !== presentation.viewport.visibleRowCapacity ||
      indexedWrapColumns !== presentation.viewport.wrapColumns ||
      indexedSoftWrap !== presentation.viewport.softWrap;

    if (!forceReconfigure && !docChanged && !metricsChanged && presentation.viewport.visibleVisualRows.length > 0) {
      model.visualIndex.resetCounters();
      recordWork("cache-hit", 0);
      return;
    }

    model.visualIndex.resetCounters();
    if (docChanged) documentRevision += 1;
    model.configure({
      doc: state.doc,
      documentRevision,
      visibleRowCapacity: presentation.viewport.visibleRowCapacity,
      softWrap: presentation.viewport.softWrap,
      wrapColumns: presentation.viewport.wrapColumns
    });
    indexedDoc = state.doc;
    indexedCapacity = presentation.viewport.visibleRowCapacity;
    indexedWrapColumns = presentation.viewport.wrapColumns;
    indexedSoftWrap = presentation.viewport.softWrap;
    forceReconfigure = false;
    syncPresentation();
    recordWork(metricsChanged ? "metrics" : docChanged ? "document-fallback" : "rebuild", presentation.viewport.visibleVisualRows.length);
  };

  const handleDocumentChange = (
    _previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ) => {
    model.visualIndex.resetCounters();
    documentRevision += 1;
    model.configure({
      doc: nextState.doc,
      documentRevision,
      visibleRowCapacity: presentation.viewport.visibleRowCapacity,
      softWrap: presentation.viewport.softWrap,
      wrapColumns: presentation.viewport.wrapColumns,
      changes
    });
    indexedDoc = nextState.doc;
    indexedCapacity = presentation.viewport.visibleRowCapacity;
    indexedWrapColumns = presentation.viewport.wrapColumns;
    indexedSoftWrap = presentation.viewport.softWrap;
    forceReconfigure = false;
    syncPresentation();
    recordWork("document", presentation.viewport.visibleVisualRows.length);
  };

  syncPresentation();
  recordWork("init", presentation.viewport.visibleVisualRows.length);

  return {
    resetViewportModelCache() {
      forceReconfigure = true;
    },
    rebuildViewportModel,
    handleDocumentChange,
    getVisibleLineViewportValue() {
      rebuildViewportModel();
      return getVisibleLineViewportFromPresentation(getState(), presentation);
    },
    getVisibleHighlightViewportValue() {
      rebuildViewportModel();
      return getVisibleHighlightViewportFromPresentation(getState(), presentation);
    },
    getVisibleLineCount() {
      rebuildViewportModel();
      return Math.max(1, presentation.viewport.visibleVisualRows.length || presentation.viewport.visibleRowCapacity);
    },
    moveByVisualRows(delta) {
      const currentState = getState();
      rebuildViewportModel();
      const activeOffset = options.getActiveOffset();
      const currentPosition = currentState.doc.positionAt(activeOffset);
      const preferredColumn =
        currentState.selection.ranges[currentState.selection.primaryIndex]?.preferredColumn ?? currentPosition.column;
      const targetRow = model.moveFromOffset(activeOffset, delta);
      const segmentLength = targetRow.segmentEnd - targetRow.segmentStart;
      const maxColumn = currentState.mode === "insert" ? segmentLength : Math.max(0, segmentLength - 1);
      const targetColumn = Math.max(0, Math.min(preferredColumn, maxColumn));
      const targetOffset = segmentLength === 0 ? targetRow.segmentStart : targetRow.segmentStart + targetColumn;
      return options.dispatchOffsetSelection(targetOffset, preferredColumn);
    },
    gotoVisibleRow(position) {
      rebuildViewportModel();
      const rows = presentation.viewport.visibleVisualRows;
      const targetRow =
        rows.length === 0
          ? model.visualIndex.first()
          : position === "top"
            ? rows[0]!
            : position === "bottom"
              ? rows[rows.length - 1]!
              : rows[Math.floor(rows.length / 2)] ?? rows[0]!;
      return options.dispatchOffsetSelection(targetRow.segmentStart, 0);
    },
    revealSelectionWithinViewport() {
      rebuildViewportModel();
      model.visualIndex.resetCounters();
      const changed = model.reveal(options.getActiveOffset(), presentation.viewport.scrolloffRows);
      if (changed) syncPresentation();
      recordWork("reveal", changed ? presentation.viewport.visibleVisualRows.length : 0);
      return changed;
    },
    scrollViewportBy(rowsDelta) {
      rebuildViewportModel();
      model.visualIndex.resetCounters();
      const changed = model.scroll(rowsDelta);
      if (changed) syncPresentation();
      recordWork("scroll", changed ? presentation.viewport.visibleVisualRows.length : 0);
      return changed;
    },
    alignSelectionWithinViewport(position) {
      rebuildViewportModel();
      model.visualIndex.resetCounters();
      const changed = model.align(options.getActiveOffset(), position);
      if (changed) syncPresentation();
      recordWork("align", changed ? presentation.viewport.visibleVisualRows.length : 0);
      return changed;
    }
  };
}
