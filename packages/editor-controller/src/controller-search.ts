import type { EditorState } from "@wx/editor-core";

import { collectSearchMatches } from "@wx/editor-core";
import type { EditorPresentationState, EditorSearchState } from "./types";

interface CreateControllerSearchRuntimeOptions {
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  syncVisibleLanguageDecorations(): boolean;
  emitPresentationUpdate(effectType?: string): void;
}

export interface ControllerSearchRuntime {
  readonly searchState: EditorSearchState;
  getSearchMatchCache(): readonly { from: number; to: number }[];
  refreshSearchMatchCache(targetState?: EditorState): void;
  applySearchState(next: Partial<EditorSearchState>, effectType?: string): void;
  setSearchState(next: Partial<EditorSearchState>, effectType?: string): void;
  clearSearchState(): void;
}

export function createControllerSearchRuntime(options: CreateControllerSearchRuntimeOptions): ControllerSearchRuntime {
  const presentation = options.getPresentation();
  const searchState = presentation.search;
  let searchMatchCache = [...presentation.search.matches];

  const refreshSearchMatchCache = (targetState: EditorState = options.getState()) => {
    searchMatchCache = collectSearchMatches(targetState.doc.text, searchState.query);
    presentation.search.matches = searchMatchCache;
  };

  const applySearchState = (next: Partial<EditorSearchState>, effectType = "search.update") => {
    Object.assign(searchState, next);
    refreshSearchMatchCache();
    options.syncVisibleLanguageDecorations();
    options.emitPresentationUpdate(effectType);
  };

  return {
    searchState,
    getSearchMatchCache() {
      return searchMatchCache;
    },
    refreshSearchMatchCache,
    applySearchState,
    setSearchState(next, effectType = "search.update") {
      applySearchState(next, effectType);
      if (typeof next.query === "string") {
        presentation.registers.search = next.query;
      }
    },
    clearSearchState() {
      applySearchState(
        {
          query: "",
          direction: "forward",
          lastMatch: null
        },
        "search.clear"
      );
    }
  };
}
