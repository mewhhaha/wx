import {
  collectSearchMatches,
  createSelectionSet,
  getSelectionOffsets,
  getSelectionRanges,
  type EditorState,
  type SelectionRange,
  type Transaction
} from "@wx/editor-core";

import { escapeRegex } from "./search";
import type { EditorSearchState } from "./types";

interface CreateMultiSelectionRuntimeOptions {
  getState(): EditorState;
  getSearchState(): EditorSearchState;
  dispatch(transaction: Transaction): void;
}

export interface MultiSelectionRuntime {
  selectNextOccurrence(reverse?: boolean): boolean;
  selectAllOccurrences(): boolean;
  splitSelectionsByLine(): boolean;
  collapseSelections(): boolean;
  removePrimarySelection(): boolean;
}

function rangeKey(range: { from: number; to: number }): string {
  return `${range.from}:${range.to}`;
}

function selectionRangeFromMatch(match: { from: number; to: number }): SelectionRange {
  return {
    anchor: match.from,
    head: Math.max(match.from, match.to - 1),
    preferredColumn: null
  };
}

function currentSelectionQuery(state: EditorState, searchState: EditorSearchState): string | null {
  const selection = getSelectionOffsets(state);
  const selectedText = state.doc.slice(selection.from, selection.to);

  if (selectedText.length > 0) {
    return selectedText;
  }

  return searchState.query.trim() || null;
}

function collectOccurrenceMatches(state: EditorState, searchState: EditorSearchState): Array<{ from: number; to: number }> {
  const query = currentSelectionQuery(state, searchState);

  if (!query) {
    return [];
  }

  return collectSearchMatches(state.doc.text, escapeRegex(query));
}

export function createMultiSelectionRuntime(options: CreateMultiSelectionRuntimeOptions): MultiSelectionRuntime {
  return {
    selectNextOccurrence(reverse = false) {
      const state = options.getState();
      const matches = collectOccurrenceMatches(state, options.getSearchState());

      if (matches.length === 0) {
        return false;
      }

      const selectedRanges = getSelectionRanges(state);
      const selectedKeys = new Set(selectedRanges.map(rangeKey));
      const activeOffset = selectedRanges[state.selection.primaryIndex]?.to ?? selectedRanges[0]?.to ?? 0;
      const orderedMatches = reverse ? [...matches].reverse() : matches;
      const nextMatch =
        orderedMatches.find((match) =>
          !selectedKeys.has(rangeKey(match)) &&
          (reverse ? match.to - 1 < activeOffset : match.from >= activeOffset)
        ) ??
        orderedMatches.find((match) => !selectedKeys.has(rangeKey(match)));

      if (!nextMatch) {
        return false;
      }

      const nextSelection = createSelectionSet(
        [...selectedRanges, nextMatch].map(selectionRangeFromMatch),
        selectedRanges.length
      );

      options.dispatch({
        selection: nextSelection,
        mode: state.mode === "insert" ? "normal" : state.mode
      });
      return true;
    },
    selectAllOccurrences() {
      const state = options.getState();
      const matches = collectOccurrenceMatches(state, options.getSearchState());

      if (matches.length === 0) {
        return false;
      }

      const currentSelection = getSelectionOffsets(state);
      const primaryIndex = Math.max(
        0,
        matches.findIndex((match) => match.from === currentSelection.from && match.to === currentSelection.to)
      );

      options.dispatch({
        selection: createSelectionSet(matches.map(selectionRangeFromMatch), primaryIndex),
        mode: state.mode === "insert" ? "normal" : state.mode
      });
      return true;
    },
    splitSelectionsByLine() {
      const state = options.getState();
      const selections = getSelectionRanges(state);
      const nextRanges: SelectionRange[] = [];
      let nextPrimaryIndex = 0;

      selections.forEach((selection, selectionIndex) => {
        const fromLine = state.doc.positionAt(selection.from).line;
        const toLine = state.doc.positionAt(Math.max(selection.from, selection.to - 1)).line;

        for (let lineIndex = fromLine; lineIndex <= toLine; lineIndex += 1) {
          const line = state.doc.lineAt(lineIndex);
          const from = Math.max(selection.from, line.start);
          const to = Math.min(selection.to, Math.max(line.start + 1, line.end));

          if (to <= from) {
            continue;
          }

          if (selectionIndex === state.selection.primaryIndex && nextRanges.length > 0) {
            nextPrimaryIndex = nextRanges.length;
          }

          nextRanges.push(selectionRangeFromMatch({ from, to }));
        }
      });

      if (nextRanges.length === 0) {
        return false;
      }

      options.dispatch({
        selection: createSelectionSet(nextRanges, nextPrimaryIndex),
        mode: state.mode === "insert" ? "normal" : state.mode
      });
      return true;
    },
    collapseSelections() {
      const state = options.getState();
      const primary = state.selection.ranges[state.selection.primaryIndex];

      if (!primary || state.selection.ranges.length <= 1) {
        return false;
      }

      options.dispatch({
        selection: createSelectionSet([primary], 0)
      });
      return true;
    },
    removePrimarySelection() {
      const state = options.getState();

      if (state.selection.ranges.length <= 1) {
        return false;
      }

      const nextRanges = state.selection.ranges.filter((_, index) => index !== state.selection.primaryIndex);
      const nextPrimaryIndex = Math.max(0, Math.min(state.selection.primaryIndex, nextRanges.length - 1));

      options.dispatch({
        selection: createSelectionSet(nextRanges, nextPrimaryIndex)
      });
      return true;
    }
  };
}
