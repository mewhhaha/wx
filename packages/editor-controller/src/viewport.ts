import type { EditorState } from "@mewhhaha/wx-core";
import type { EditorDiagnostic, EditorLineRange, HighlightSpan } from "@mewhhaha/wx-language";
import {
  buildVisualRows,
  getVisualRowForOffset,
  type EditorVisualRow
} from "@mewhhaha/wx-layout";
import type { EditorLineChange, EditorPendingAction, EditorPresentationState } from "./types";

function getLayoutPendingAction(pendingAction: EditorPendingAction): EditorPendingAction {
  return pendingAction?.kind === "g" ||
    pendingAction?.kind === "[" ||
    pendingAction?.kind === "]" ||
    pendingAction?.kind === "m" ||
    pendingAction?.kind === "?" ||
    pendingAction?.kind === "space" ||
    pendingAction?.kind === "flash-target" ||
    pendingAction?.kind === "z"
    ? pendingAction
    : null;
}

export function syncVisibleViewportRows(presentation: EditorPresentationState): boolean {
  const visualRows = presentation.viewport.visualRows;

  if (visualRows.length === 0) {
    const changed = presentation.viewport.visibleVisualRows.length > 0;
    presentation.viewport.visibleVisualRows = [];
    return changed;
  }

  const fromRowIndex = Math.max(0, Math.min(visualRows.length - 1, presentation.viewport.topVisualRow));
  const toRowIndex = Math.max(
    fromRowIndex,
    Math.min(visualRows.length - 1, fromRowIndex + presentation.viewport.visibleRowCapacity - 1)
  );
  const nextVisibleRows = visualRows.slice(fromRowIndex, toRowIndex + 1);
  const changed =
    nextVisibleRows.length !== presentation.viewport.visibleVisualRows.length ||
    nextVisibleRows.some((row, index) => presentation.viewport.visibleVisualRows[index] !== row);

  presentation.viewport.visibleVisualRows = nextVisibleRows;
  return changed;
}

export function rebuildViewportPresentation(
  state: EditorState,
  presentation: EditorPresentationState
): void {
  const nextInput = {
    state,
    filePath: presentation.filePath,
    bufferTitle: presentation.bufferTitle,
    searchState: presentation.search,
    highlights: [] as HighlightSpan[],
    diagnostics: [] as EditorDiagnostic[],
    lineChanges: [] as EditorLineChange[],
    commandLine: presentation.ui.commandLine,
    bottomMessage: presentation.ui.bottomMessage,
    picker: presentation.ui.picker,
    hover: presentation.ui.hover,
    flash: presentation.ui.flash,
    pendingAction: getLayoutPendingAction(presentation.ui.pendingAction),
    pendingCount: presentation.ui.pendingCount,
    viewport: {
      cols: Math.max(1, presentation.viewport.wrapColumns),
      rows: Math.max(1, presentation.viewport.visibleRowCapacity),
      topVisualRow: presentation.viewport.topVisualRow
    },
    softWrap: presentation.viewport.softWrap,
    indentGuides: {
      render: false,
      character: "│",
      skipLevels: 0,
      indentWidth: 2
    }
  };
  const { visualRows, lineVisualRanges } = buildVisualRows(nextInput);
  presentation.viewport.visualRows = visualRows;
  presentation.viewport.lineVisualRanges = lineVisualRanges;
  presentation.viewport.wrapRevision = state.revision;
  const maxTop = Math.max(0, visualRows.length - presentation.viewport.visibleRowCapacity);
  presentation.viewport.topVisualRow = Math.max(0, Math.min(maxTop, presentation.viewport.topVisualRow));
  syncVisibleViewportRows(presentation);
}

export function getVisibleLineViewport(state: EditorState, presentation: EditorPresentationState): EditorLineRange {
  const visualRows = presentation.viewport.visibleVisualRows;

  if (visualRows.length === 0) {
    return { fromLine: 0, toLine: Math.max(0, state.doc.lineCount - 1) };
  }

  const fromRow = visualRows[0];
  const toRow = visualRows[visualRows.length - 1];

  return {
    fromLine: fromRow?.docLine ?? 0,
    toLine: toRow?.docLine ?? Math.max(0, state.doc.lineCount - 1)
  };
}

export function getVisibleHighlightViewport(state: EditorState, presentation: EditorPresentationState): EditorLineRange {
  const viewport = getVisibleLineViewport(state, presentation);
  const contextLines = Math.max(4, presentation.viewport.visibleRowCapacity);

  return {
    fromLine: Math.max(0, viewport.fromLine - contextLines),
    toLine: Math.min(state.doc.lineCount - 1, viewport.toLine + contextLines)
  };
}

export function revealSelectionTopVisualRow(
  state: EditorState,
  presentation: EditorPresentationState,
  activeOffset: number
): number {
  const visual = getVisualRowForOffset(
    state,
    presentation.viewport.visualRows,
    presentation.viewport.lineVisualRanges,
    activeOffset,
    presentation.viewport.softWrap,
    presentation.viewport.wrapColumns
  );
  const visibleCount = Math.max(1, presentation.viewport.visibleRowCapacity);
  const scrolloff = Math.max(0, Math.min(presentation.viewport.scrolloffRows, Math.floor((visibleCount - 1) / 2)));
  const maxTop = Math.max(0, presentation.viewport.visualRows.length - visibleCount);
  const minRow = presentation.viewport.topVisualRow + scrolloff;
  const maxRow = presentation.viewport.topVisualRow + visibleCount - 1 - scrolloff;

  if (visual.rowIndex < minRow) {
    return Math.max(0, visual.rowIndex - scrolloff);
  }

  if (visual.rowIndex > maxRow) {
    return Math.min(maxTop, Math.max(0, visual.rowIndex + scrolloff - visibleCount + 1));
  }

  return presentation.viewport.topVisualRow;
}

export function alignSelectionTopVisualRow(
  state: EditorState,
  presentation: EditorPresentationState,
  activeOffset: number,
  position: "top" | "center" | "bottom"
): number {
  const visual = getVisualRowForOffset(
    state,
    presentation.viewport.visualRows,
    presentation.viewport.lineVisualRanges,
    activeOffset,
    presentation.viewport.softWrap,
    presentation.viewport.wrapColumns
  );
  const visibleCount = Math.max(1, presentation.viewport.visibleRowCapacity);
  const maxTop = Math.max(0, presentation.viewport.visualRows.length - visibleCount);
  const nextTop =
    position === "top"
      ? visual.rowIndex
      : position === "bottom"
        ? visual.rowIndex - visibleCount + 1
        : visual.rowIndex - Math.floor(visibleCount / 2);

  return Math.max(0, Math.min(maxTop, nextTop));
}

export function getVisualRowAtIndex(
  presentation: EditorPresentationState,
  visualRowIndex: number
): EditorVisualRow {
  return presentation.viewport.visualRows[
    Math.max(0, Math.min(presentation.viewport.visualRows.length - 1, visualRowIndex))
  ] ?? {
    docLine: 0,
    visualRowIndex: 0,
    segmentStart: 0,
    segmentEnd: 0,
    startColumn: 0,
    isContinuation: false,
    isLastSegment: true
  };
}
