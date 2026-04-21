import {
  createCharacterSelection,
  createSelection,
  getActiveCharacterOffset,
  getCursorOffset,
  type EditorState,
  type Transaction
} from "@mewhhaha/wx-core";

import type { EditorPresentationState } from "./types";

interface CreateControllerContextOptions {
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getDocumentRevision(): number;
  dispatch(transaction: Transaction): void;
}

export interface ControllerContextRuntime {
  getSnapshot(): { revision: number; doc: EditorState["doc"] };
  getActiveOffset(): number;
  getCommentToggler(): EditorPresentationState["language"]["services"][number]["comments"] | undefined;
  getSyntaxSelector(): EditorPresentationState["language"]["services"][number]["syntaxSelector"] | undefined;
  getSyntaxTextobjectProvider():
    | EditorPresentationState["language"]["services"][number]["syntaxTextobjects"]
    | undefined;
  getSyntaxNavigationProvider():
    | EditorPresentationState["language"]["services"][number]["syntaxNavigation"]
    | undefined;
  applySelectionRange(from: number, to: number): void;
  dispatchOffsetSelection(targetOffset: number, preferredColumn: number | null): boolean;
}

export function createControllerContextRuntime(options: CreateControllerContextOptions): ControllerContextRuntime {
  const getPresentation = () => options.getPresentation();
  const getState = () => options.getState();

  return {
    getSnapshot() {
      return {
        revision: options.getDocumentRevision(),
        doc: getState().doc
      };
    },
    getActiveOffset() {
      const state = getState();
      return state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    },
    getCommentToggler() {
      return getPresentation().language.services.find((services) => services.comments)?.comments;
    },
    getSyntaxSelector() {
      return getPresentation().language.services.find((services) => services.syntaxSelector)?.syntaxSelector;
    },
    getSyntaxTextobjectProvider() {
      return getPresentation().language.services.find((services) => services.syntaxTextobjects)?.syntaxTextobjects;
    },
    getSyntaxNavigationProvider() {
      return getPresentation().language.services.find((services) => services.syntaxNavigation)?.syntaxNavigation;
    },
    applySelectionRange(from, to) {
      const state = getState();

      if (state.mode === "visual") {
        const anchor = state.selection.ranges[state.selection.primaryIndex]?.anchor ?? from;
        options.dispatch({
          selection: createSelection(anchor, Math.max(from, to - 1)),
          mode: "visual"
        });
        return;
      }

      options.dispatch({
        selection: createSelection(from, Math.max(from, to - 1)),
        mode: "normal"
      });
    },
    dispatchOffsetSelection(targetOffset, preferredColumn) {
      const state = getState();

      if (state.mode === "insert") {
        options.dispatch({
          selection: createSelection(targetOffset, targetOffset, preferredColumn)
        });
        return true;
      }

      if (state.mode === "visual") {
        const anchor = state.selection.ranges[state.selection.primaryIndex]?.anchor ?? targetOffset;
        options.dispatch({
          selection: createSelection(anchor, targetOffset, preferredColumn),
          mode: "visual"
        });
        return true;
      }

      options.dispatch({
        selection: createCharacterSelection(state.doc, targetOffset, preferredColumn)
      });
      return true;
    }
  };
}
