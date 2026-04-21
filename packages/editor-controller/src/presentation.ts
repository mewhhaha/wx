import type { EditorState } from "@mewhhaha/wx-core";
import type { CreateEditorControllerOptions, EditorPresentationState } from "./types";

export function createPresentationState(
  state: EditorState,
  options: CreateEditorControllerOptions
): EditorPresentationState {
  return {
    filePath: options.filePath ?? null,
    bufferTitle: options.filePath ?? "[scratch]",
    themeName: options.theme ?? null,
    viewport: {
      topVisualRow: 0,
      visibleRowCapacity: 1,
      scrolloffRows: 3,
      wrapColumns: Number.MAX_SAFE_INTEGER,
      softWrap: false,
      visualRows: [],
      visibleVisualRows: [],
      lineVisualRanges: [],
      wrapRevision: -1
    },
    language: {
      services: [],
      host: null,
      languageRevision: -1,
      lastHighlightedRevision: -1,
      highlightRequestId: 0,
      diagnosticsRequestId: 0,
      lineChangesRequestId: 0,
      hoverRequestId: 0,
      completionRequestId: 0,
      navigationRequestId: 0,
      renameRequestId: 0,
      symbolsRequestId: 0,
      highlightCache: new Map(),
      highlightCoverage: new Set(),
      diagnostics: [],
      diagnosticsByLine: new Map(),
      lineChangesByLine: new Map(),
      visibleHighlights: [],
      visibleHighlightsByLine: new Map(),
      visibleDiagnostics: [],
      visibleLineChanges: []
    },
    ui: {
      commandLine: { active: false, value: "", prompt: ":" },
      commandCompletionIndex: 0,
      commandCompletionItems: [],
      completion: {
        active: false,
        loading: false,
        anchorOffset: null,
        items: [],
        selectedIndex: 0,
        error: null
      },
      rename: {
        active: false,
        anchorOffset: null,
        value: "",
        error: null
      },
      picker: {
        active: false,
        loading: false,
        title: "",
        items: [],
        selectedIndex: 0,
        error: null,
        query: "",
        variant: "bar",
        previewTitle: "",
        previewContent: "",
        previewLoading: false
      },
      bottomMessage: null,
      hover: {
        active: false,
        pinned: false,
        offset: null,
        content: "",
        tone: "info"
      },
      flash: {
        active: false,
        target: "",
        input: "",
        hints: []
      },
      pendingAction: null,
      pendingCount: "",
      stickyViewMode: false,
      previewTheme: null,
      lastRepeatableMotion: null
    },
    search: {
      query: "",
      direction: "forward",
      lastMatch: null,
      matches: [],
      visibleMatchesByLine: new Map()
    },
    jumps: {
      items: [],
      cursor: 0
    },
    registers: {
      unnamed: state.yankBuffer,
      search: null,
      named: {},
      selected: null
    }
  };
}
