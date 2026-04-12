import { getCursorOffset, type EditorState } from "@wx/editor-core";
import { getVisualRowForOffset, type EditorVisualRow } from "@wx/editor-layout";

import {
  getVisibleHighlightViewport as getVisibleHighlightViewportFromPresentation,
  getVisibleLineViewport as getVisibleLineViewportFromPresentation,
  getVisualRowAtIndex,
  rebuildViewportPresentation,
  revealSelectionTopVisualRow
} from "./viewport";
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
  getVisibleLineViewportValue(): { fromLine: number; toLine: number };
  getVisibleHighlightViewportValue(): { fromLine: number; toLine: number };
  getVisibleLineCount(): number;
  moveByVisualRows(delta: number): boolean;
  gotoVisibleRow(position: "top" | "center" | "bottom"): boolean;
  revealSelectionWithinViewport(): boolean;
}

export function createViewportModelRuntime(options: CreateViewportModelRuntimeOptions): ViewportModelRuntime {
  const { presentation } = options;
  let viewportModelRevision = -1;
  let viewportModelWrapColumns = presentation.viewport.wrapColumns;
  let viewportModelSoftWrap = presentation.viewport.softWrap;

  const getState = () => options.getState();

  const getVisualRow = (visualRowIndex: number): EditorVisualRow => {
    return getVisualRowAtIndex(presentation, visualRowIndex);
  };

  const rebuildViewportModel = () => {
    const state = getState();
    if (
      viewportModelRevision === state.revision &&
      viewportModelWrapColumns === presentation.viewport.wrapColumns &&
      viewportModelSoftWrap === presentation.viewport.softWrap &&
      presentation.viewport.visualRows.length > 0
    ) {
      return;
    }

    rebuildViewportPresentation(state, presentation);
    viewportModelRevision = state.revision;
    viewportModelWrapColumns = presentation.viewport.wrapColumns;
    viewportModelSoftWrap = presentation.viewport.softWrap;
  };

  return {
    resetViewportModelCache() {
      viewportModelRevision = -1;
    },
    rebuildViewportModel,
    getVisibleLineViewportValue() {
      rebuildViewportModel();
      return getVisibleLineViewportFromPresentation(getState(), presentation);
    },
    getVisibleHighlightViewportValue() {
      rebuildViewportModel();
      return getVisibleHighlightViewportFromPresentation(getState(), presentation);
    },
    getVisibleLineCount() {
      return Math.max(1, presentation.viewport.visibleVisualRows.length || presentation.viewport.visibleRowCapacity);
    },
    moveByVisualRows(delta) {
      const state = getState();
      rebuildViewportModel();
      const activeOffset = options.getActiveOffset();
      const current = getVisualRowForOffset(
        state,
        presentation.viewport.visualRows,
        presentation.viewport.lineVisualRanges,
        activeOffset,
        presentation.viewport.softWrap,
        presentation.viewport.wrapColumns
      );
      const preferredColumn = state.selection.ranges[state.selection.primaryIndex]?.preferredColumn ?? current.column;
      const targetRowIndex = Math.max(0, Math.min(presentation.viewport.visualRows.length - 1, current.rowIndex + delta));
      const targetRow = getVisualRow(targetRowIndex);
      const segmentLength = targetRow.segmentEnd - targetRow.segmentStart;
      const maxColumn = state.mode === "insert" ? segmentLength : Math.max(0, segmentLength - 1);
      const targetColumn = Math.max(0, Math.min(preferredColumn, maxColumn));
      const targetOffset = segmentLength === 0 ? targetRow.segmentStart : targetRow.segmentStart + targetColumn;
      return options.dispatchOffsetSelection(targetOffset, preferredColumn);
    },
    gotoVisibleRow(position) {
      rebuildViewportModel();
      const rows = presentation.viewport.visibleVisualRows;
      const targetRow =
        rows.length === 0
          ? getVisualRow(0)
          : position === "top"
            ? rows[0]
            : position === "bottom"
              ? rows[rows.length - 1]
              : rows[Math.floor(rows.length / 2)] ?? rows[0];
      return options.dispatchOffsetSelection(targetRow.segmentStart, 0);
    },
    revealSelectionWithinViewport() {
      const state = getState();
      rebuildViewportModel();
      const previousTop = presentation.viewport.topVisualRow;
      presentation.viewport.topVisualRow = revealSelectionTopVisualRow(state, presentation, options.getActiveOffset());
      return presentation.viewport.topVisualRow !== previousTop;
    }
  };
}
