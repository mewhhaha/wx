import type { EditorState } from "@mewhhaha/wx-core";
import type { CreateEditorControllerOptions, EditorPresentationState } from "./types";

export function createPresentationState(
  state: EditorState,
  options: CreateEditorControllerOptions
): EditorPresentationState {
  return {
    filePath: options.filePath ?? null,
    bufferTitle: options.filePath ?? "[scratch]",
    fileStatus: {
      dirty: false,
      externalChanged: false
    },
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
      totalVisualRows: Math.max(1, state.doc.lineCount),
      totalVisualRowsExact: true,
      layoutWork: {
        reason: "init",
        rowsVisited: 0,
        rowsRebuilt: 0,
        mappingEntriesBuilt: 0,
        mappingCacheHits: 0
      },
      wrapRevision: -1
    },
    language: {
      services: [],
      serviceStatus: {
        state: "disabled",
        message: null,
        retryable: false,
        generation: 0
      },
      host: null,
      languageRevision: -1,
      lastHighlightedRevision: -1,
      highlightRequestId: 0,
      diagnosticsRequestId: 0,
      lineChangesRequestId: 0,
      hoverRequestId: 0,
      completionRequestId: 0,
      signatureHelpRequestId: 0,
      navigationRequestId: 0,
      renameRequestId: 0,
      symbolsRequestId: 0,
      work: {
        priorityPolicy: [
          { class: "input-cursor", priority: 0, policy: "immediate", delayMs: 0 },
          { class: "visible-highlights", priority: 1, policy: "latest", delayMs: 0 },
          { class: "completion-hover", priority: 2, policy: "latest", delayMs: 0 },
          { class: "diagnostics", priority: 3, policy: "debounce", delayMs: 40 },
          { class: "vcs-line-changes", priority: 4, policy: "debounce", delayMs: 80 },
          { class: "background", priority: 5, policy: "idle", delayMs: 120 }
        ],
        document: {
          requested: 0, started: 0, completed: 0, cancelled: 0, staleDropped: 0,
          inFlight: 0, queued: 0, maxQueueDepth: 0,
          latestRequestedRevision: -1, latestCompletedRevision: -1, coalesced: 0
        },
        highlights: { requested: 0, started: 0, completed: 0, cancelled: 0, staleDropped: 0, inFlight: 0, queued: 0, maxQueueDepth: 0 },
        diagnostics: { requested: 0, started: 0, completed: 0, cancelled: 0, staleDropped: 0, inFlight: 0, queued: 0, maxQueueDepth: 0 },
        lineChanges: { requested: 0, started: 0, completed: 0, cancelled: 0, staleDropped: 0, inFlight: 0, queued: 0, maxQueueDepth: 0 },
        hover: { requested: 0, started: 0, completed: 0, cancelled: 0, staleDropped: 0, inFlight: 0, queued: 0, maxQueueDepth: 0 },
        completion: { requested: 0, started: 0, completed: 0, cancelled: 0, staleDropped: 0, inFlight: 0, queued: 0, maxQueueDepth: 0 }
      },
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
      signatureHelp: { active: false, loading: false, anchorOffset: null, signatures: [], selectedIndex: 0, error: null },
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
        inputMode: "search",
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
      lastRepeatableMotion: null,
      lastRepeatableEdit: null
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
      unnamedKind: state.yankKind,
      search: null,
      named: {},
      namedKinds: {},
      selected: null
    }
  };
}
