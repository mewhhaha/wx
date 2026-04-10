import {
  addSurround,
  applyTransaction,
  changeSelection,
  createCharacterSelection,
  createEditorState,
  createSelection,
  deleteSelection,
  deleteSurround,
  findNextChar,
  findPrevChar,
  findTillNextChar,
  findTillPrevChar,
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets,
  gotoFirstNonWhitespace,
  gotoLineEnd,
  gotoLineStart,
  gotoMatchingBracket,
  gotoNextParagraph,
  gotoPrevParagraph,
  gotoWindowBottom,
  gotoWindowCenter,
  gotoWindowTop,
  halfPageDown,
  halfPageUp,
  insertText,
  mapOffsetThroughChanges,
  moveDown,
  moveUp,
  pageDown,
  pageUp,
  pasteAfter,
  replaceSurround,
  selectTextobject,
  yankSelection,
  type Command,
  type CommandContext,
  type EditorState,
  type SelectionSet,
  type TextChange,
  type Transaction
} from "@wx/editor-core";
import type {
  EditorCodeAction,
  EditorDiagnostic,
  EditorHover,
  EditorLineRange,
  HighlightSpan,
  SyntaxTextobjectMode
} from "@wx/editor-language";
import {
  buildVisualRows,
  getVisualRowForOffset,
  type EditorVisualRow
} from "../../editor-layout/src/index";
import { buildFlashLabels } from "./flash-labels";
import {
  commandForBracketPrefix,
  commandForGotoPrefix,
  commandForInsertMode,
  commandForNormalMode,
  commandForVisualMode
} from "./keymap";
import { createSnapshotHistory, restoreEditorState } from "./history";
import {
  buildDiagnosticsCache,
  buildHighlightCache,
  buildLineChangesMap,
  diagnosticsEqual,
  highlightMapsEqual,
  lineChangesEqual,
  remapHighlightSpans,
  spansEqual
} from "./language-state";
import { createPresentationState } from "./presentation";
import { collectSearchMatches, escapeRegex, searchMatchesByLineEqual } from "./search";
import {
  createJumpEntry,
  jumpEntryEquals,
  normalizeLanguageServices,
  normalizeRegisterName,
  selectionEquals,
  transactionRequiresFullDocumentLanguageSync
} from "./session";
import type {
  CreateEditorControllerOptions,
  EditorBottomMessageState,
  EditorCommandCompletionItem,
  EditorCommandLineKeyOptions,
  EditorCommandLineKeyResult,
  EditorController,
  EditorFlashHintState,
  EditorHostServices,
  EditorJumpEntry,
  EditorKeyInputOptions,
  EditorKeyInputResult,
  EditorLineChange,
  EditorPendingAction,
  EditorPickerState,
  EditorPresentationState,
  EditorRepeatableMotion,
  EditorSearchState,
  EditorUpdate,
  EditorUpdateListener,
  HistoryEntry,
  HistoryPlugin
} from "./types";
export type {
  CreateEditorControllerOptions,
  EditorBottomMessageState,
  EditorCommandCompletionItem,
  EditorCommandLineKeyOptions,
  EditorCommandLineKeyResult,
  EditorCommandLineState,
  EditorController,
  EditorFlashHintState,
  EditorFlashState,
  EditorHostServices,
  EditorHoverState,
  EditorJumpEntry,
  EditorKeyInput,
  EditorKeyInputOptions,
  EditorKeyInputResult,
  EditorLanguagePresentationState,
  EditorLineChange,
  EditorLineChangeKind,
  EditorLineChangeState,
  EditorPendingAction,
  EditorPickerItemState,
  EditorPickerState,
  EditorPresentationState,
  EditorRegisterState,
  EditorRepeatableMotion,
  EditorSearchPresentationState,
  EditorSearchState,
  EditorUiPresentationState,
  EditorUpdate,
  EditorUpdateListener,
  EditorViewportPresentationState,
  HistoryEntry,
  HistoryPlugin
} from "./types";

interface PickerActionItem {
  label: string;
  detail?: string;
  run: () => Promise<void> | void;
}

export { createSnapshotHistory };

export function createEditorController(options: CreateEditorControllerOptions = {}): EditorController {
  let state =
    options.state ??
    createEditorState({
      value: options.value,
      selection: options.selection,
      mode: options.mode,
      language: options.language,
      theme: options.theme
    });
  const presentation = createPresentationState(state, options);
  const listeners = new Set<EditorUpdateListener>();
  const history = options.history === false ? null : options.history ?? createSnapshotHistory();
  const searchState = presentation.search;
  const jumpList = presentation.jumps.items as EditorJumpEntry[];
  let jumpCursor = presentation.jumps.cursor;
  const registers = presentation.registers;
  let searchMatchCache = [...presentation.search.matches];
  let viewportModelRevision = -1;
  let viewportModelWrapColumns = presentation.viewport.wrapColumns;
  let viewportModelSoftWrap = presentation.viewport.softWrap;
  let inFlightVisibleHighlightRequestKey: string | null = null;
  let inFlightVisibleHighlightRequest: Promise<void> | null = null;
  let pickerActions: readonly PickerActionItem[] = [];
  let controller!: EditorController;
  let searchPreviewState:
    | null
    | {
        active: true;
        direction: "forward" | "backward";
        selection: SelectionSet;
        mode: EditorState["mode"];
        search: EditorSearchState;
        startOffset: number;
      } = null;
  let pendingDeferredPresentationUpdate = false;
  let deferredPresentationEffectType = "presentation.update";

  const refreshSearchMatchCache = (targetState: EditorState = state) => {
    searchMatchCache = collectSearchMatches(targetState.doc.text, presentation.search.query);
    presentation.search.matches = searchMatchCache;
  };

  const applySearchState = (next: Partial<EditorSearchState>, effectType = "search.update") => {
    Object.assign(searchState, next);
    refreshSearchMatchCache();
    syncVisibleLanguageDecorations();
    emitPresentationUpdate(effectType);
  };

  const applyRegisterValue = (name: string | null, value: string | null, effectType = "register.update") => {
    const normalized = normalizeRegisterName(name);

    if (!normalized) {
      registers.unnamed = value;
    } else if (normalized === "/") {
      registers.search = value;
    } else if (value === null) {
      delete registers.named[normalized];
    } else {
      registers.named[normalized] = value;
    }

    emitPresentationUpdate(effectType);
  };

  const syncVisibleViewportRows = (): boolean => {
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
  };

  const notify = (
    prevState: EditorState,
    nextState: EditorState,
    transaction: Transaction,
    options: { recordHistory?: boolean } = {}
  ) => {
    const update: EditorUpdate = {
      prevState,
      nextState,
      transaction,
      docChanged: prevState.doc.text !== nextState.doc.text,
      selectionChanged: !selectionEquals(prevState.selection, nextState.selection),
      modeChanged: prevState.mode !== nextState.mode
    };

    const shouldCheckpointHistory = prevState.mode === "insert" && nextState.mode !== "insert";

    if (options.recordHistory !== false && (update.docChanged || shouldCheckpointHistory)) {
      history?.record(update, { checkpoint: shouldCheckpointHistory });
    }

    if (update.docChanged) {
      presentation.language.lastHighlightedRevision = -1;
      const changes = transaction.changes ?? [];
      refreshSearchMatchCache(nextState);

      if (changes.length > 0) {
        presentation.language.visibleHighlights = remapHighlightSpans(
          nextState.doc,
          presentation.language.visibleHighlights,
          changes
        );
        remapHighlightCacheForChanges(prevState, nextState, changes);
        remapHighlightCoverageForChanges(prevState, nextState, changes);
        remapDiagnosticsForChanges(prevState, nextState, changes);
        const changedViewport = getChangedHighlightViewport(prevState, nextState, changes);
        if (changedViewport) {
          invalidateHighlightViewport(changedViewport);
        }
      } else {
        presentation.language.highlightCoverage.clear();
        presentation.language.visibleHighlights = [];
        presentation.language.visibleHighlightsByLine = new Map();
        presentation.language.visibleDiagnostics = [];
        presentation.language.visibleLineChanges = [];
      }
    }

    if (update.nextState.yankBuffer !== update.prevState.yankBuffer) {
      registers.unnamed = update.nextState.yankBuffer;
      const selected = normalizeRegisterName(registers.selected);

      if (selected && selected !== "/") {
        if (registers.unnamed === null) {
          delete registers.named[selected];
        } else {
          registers.named[selected] = registers.unnamed;
        }
      }
    }

    let viewportChanged = false;

    if (update.selectionChanged || update.modeChanged || update.docChanged) {
      rebuildViewportModel();
      const didReveal = revealSelectionWithinViewport();
      viewportChanged = syncVisibleViewportRows() || didReveal;
      if (update.docChanged || viewportChanged) {
        syncVisibleLanguageDecorations();
      }
    }

    if (viewportChanged) {
      ensureVisibleHighlightCoverage();
    }

    if (update.docChanged) {
      void syncLanguage({
        changes: transaction.changes ?? [],
        forceDocumentSync: transactionRequiresFullDocumentLanguageSync(transaction),
        refreshHighlights: true,
        refreshDiagnostics: true,
        refreshLineChanges: true
      });
    }

    for (const listener of listeners) {
      listener(update);
    }
  };

  const dispatch = (transaction: Transaction) => {
    const prevState = state;
    state = applyTransaction(state, transaction);
    notify(prevState, state, transaction);
  };

  const applyHistoryEntry = (entry: HistoryEntry | null, effectType: string) => {
    if (!entry) {
      return false;
    }

    const prevState = state;
    state = restoreEditorState(state, entry);
    notify(prevState, state, {
      effects: [{ type: effectType }]
    }, { recordHistory: false });
    return true;
  };

  const historyControls: NonNullable<CommandContext["history"]> = {
    undo: () => applyHistoryEntry(history?.undo(state) ?? null, "history.undo"),
    redo: () => applyHistoryEntry(history?.redo(state) ?? null, "history.redo"),
    checkpoint: () => history?.checkpoint() ?? false
  };

  const emitPresentationUpdate = (effectType = "presentation.update") => {
    notify(state, state, { effects: [{ type: effectType }] }, { recordHistory: false });
  };

  const schedulePresentationUpdate = (effectType = "presentation.update") => {
    deferredPresentationEffectType = effectType;

    if (pendingDeferredPresentationUpdate) {
      return;
    }

    pendingDeferredPresentationUpdate = true;
    queueMicrotask(() => {
      pendingDeferredPresentationUpdate = false;
      const nextEffectType = deferredPresentationEffectType;
      deferredPresentationEffectType = "presentation.update";
      emitPresentationUpdate(nextEffectType);
    });
  };

  const rebuildViewportModel = () => {
    if (
      viewportModelRevision === state.revision &&
      viewportModelWrapColumns === presentation.viewport.wrapColumns &&
      viewportModelSoftWrap === presentation.viewport.softWrap &&
      presentation.viewport.visualRows.length > 0
    ) {
      return;
    }

    const nextInput = {
      state,
      filePath: presentation.filePath,
      searchState: presentation.search,
      highlights: [] as HighlightSpan[],
      diagnostics: [] as EditorDiagnostic[],
      lineChanges: [] as EditorLineChange[],
      commandLine: presentation.ui.commandLine,
      bottomMessage: presentation.ui.bottomMessage,
      picker: presentation.ui.picker,
      hover: presentation.ui.hover,
      flash: presentation.ui.flash,
      pendingAction:
        presentation.ui.pendingAction?.kind === "g" ||
        presentation.ui.pendingAction?.kind === "[" ||
        presentation.ui.pendingAction?.kind === "]" ||
        presentation.ui.pendingAction?.kind === "m" ||
        presentation.ui.pendingAction?.kind === "space" ||
        presentation.ui.pendingAction?.kind === "flash-target" ||
        presentation.ui.pendingAction?.kind === "z"
          ? presentation.ui.pendingAction
          : null,
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
    viewportModelRevision = state.revision;
    viewportModelWrapColumns = presentation.viewport.wrapColumns;
    viewportModelSoftWrap = presentation.viewport.softWrap;
    const maxTop = Math.max(0, visualRows.length - presentation.viewport.visibleRowCapacity);
    presentation.viewport.topVisualRow = Math.max(0, Math.min(maxTop, presentation.viewport.topVisualRow));
    syncVisibleViewportRows();
  };

  const getVisibleLineViewport = (): EditorLineRange => {
    rebuildViewportModel();
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
  };

  const getVisibleHighlightViewport = (): EditorLineRange => {
    const viewport = getVisibleLineViewport();
    const contextLines = Math.max(4, presentation.viewport.visibleRowCapacity);

    return {
      fromLine: Math.max(0, viewport.fromLine - contextLines),
      toLine: Math.min(state.doc.lineCount - 1, viewport.toLine + contextLines)
    };
  };

  const syncVisibleLanguageDecorations = (): boolean => {
    const viewport = getVisibleLineViewport();
    const visibleHighlights: HighlightSpan[] = [];
    const visibleHighlightsByLine = new Map<number, HighlightSpan[]>();
    const visibleDiagnostics: EditorDiagnostic[] = [];
    const visibleLineChanges: EditorLineChange[] = [];
    const visibleSearchMatchesByLine = new Map<number, { from: number; to: number }[]>();

    for (let lineIndex = viewport.fromLine; lineIndex <= viewport.toLine; lineIndex += 1) {
      const highlights = presentation.language.highlightCache.get(lineIndex);
      if (highlights && highlights.length > 0) {
        visibleHighlights.push(...highlights);
        visibleHighlightsByLine.set(lineIndex, highlights);
      }

      const lineDiagnostics = presentation.language.diagnosticsByLine.get(lineIndex);
      if (lineDiagnostics && lineDiagnostics.length > 0) {
        for (const diagnostic of lineDiagnostics) {
          if (
            visibleDiagnostics.length === 0 ||
            visibleDiagnostics[visibleDiagnostics.length - 1] !== diagnostic
          ) {
            visibleDiagnostics.push(diagnostic);
          }
        }
      }

      const lineChange = presentation.language.lineChangesByLine.get(lineIndex);
      if (!lineChange) {
        const line = state.doc.lineAt(lineIndex);
        const lineEnd = line.start + line.text.length;
        const lineSearchMatches = searchMatchCache.filter((entry) => entry.from < lineEnd && entry.to > line.start);
        if (lineSearchMatches.length > 0) {
          visibleSearchMatchesByLine.set(lineIndex, lineSearchMatches);
        }
        continue;
      }

      if (lineChange.kind) {
        visibleLineChanges.push({ line: lineIndex, kind: lineChange.kind });
      }

      if (lineChange.deleted) {
        visibleLineChanges.push({ line: lineIndex, kind: "deleted" });
      }

      const line = state.doc.lineAt(lineIndex);
      const lineEnd = line.start + line.text.length;
      const lineSearchMatches = searchMatchCache.filter((entry) => entry.from < lineEnd && entry.to > line.start);
      if (lineSearchMatches.length > 0) {
        visibleSearchMatchesByLine.set(lineIndex, lineSearchMatches);
      }
    }

    const highlightsChanged = !spansEqual(presentation.language.visibleHighlights, visibleHighlights);
    const highlightsByLineChanged = !highlightMapsEqual(
      presentation.language.visibleHighlightsByLine,
      visibleHighlightsByLine
    );
    const diagnosticsChanged = !diagnosticsEqual(presentation.language.visibleDiagnostics, visibleDiagnostics);
    const lineChangesChanged = !lineChangesEqual(presentation.language.visibleLineChanges, visibleLineChanges);
    const searchChanged = !searchMatchesByLineEqual(presentation.search.visibleMatchesByLine, visibleSearchMatchesByLine);

    presentation.language.visibleHighlights = visibleHighlights;
    presentation.language.visibleHighlightsByLine = visibleHighlightsByLine;
    presentation.language.visibleDiagnostics = visibleDiagnostics;
    presentation.language.visibleLineChanges = visibleLineChanges;
    presentation.search.visibleMatchesByLine = visibleSearchMatchesByLine;

    return highlightsChanged || highlightsByLineChanged || diagnosticsChanged || lineChangesChanged || searchChanged;
  };

  const getSnapshot = () => ({
    revision: state.revision,
    doc: state.doc
  });

  const getHighlighter = () => presentation.language.services.find((services) => services.highlighter)?.highlighter;
  const getHoverSource = () => presentation.language.services.find((services) => services.hover)?.hover;
  const getDiagnosticsSource = () => presentation.language.services.find((services) => services.diagnostics)?.diagnostics;
  const getCodeActionSource = () => presentation.language.services.find((services) => services.codeActions)?.codeActions;
  const getFormatter = () => presentation.language.services.find((services) => services.formatter)?.formatter;
  const getCommentToggler = () => presentation.language.services.find((services) => services.comments)?.comments;
  const getSyntaxSelector = () => presentation.language.services.find((services) => services.syntaxSelector)?.syntaxSelector;
  const getSyntaxTextobjectProvider = () =>
    presentation.language.services.find((services) => services.syntaxTextobjects)?.syntaxTextobjects;
  const getSyntaxNavigationProvider = () =>
    presentation.language.services.find((services) => services.syntaxNavigation)?.syntaxNavigation;

  const getActiveOffset = () => (state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state));

  const setBottomMessage = (message: EditorBottomMessageState | null, effectType = "ui.bottom-message") => {
    const current = presentation.ui.bottomMessage;

    if (
      current?.tone === message?.tone &&
      current?.text === message?.text &&
      (!!current === !!message)
    ) {
      return;
    }

    presentation.ui.bottomMessage = message;
    emitPresentationUpdate(effectType);
  };

  const setCommandLineState = (next: EditorCommandLineState, effectType = "ui.command-line") => {
    const current = presentation.ui.commandLine;
    if (current.active === next.active && current.value === next.value && current.prompt === next.prompt) {
      return;
    }

    presentation.ui.commandLine = next;
    emitPresentationUpdate(effectType);
  };

  const setCommandCompletionIndex = (next: number, effectType = "ui.command-completion-index") => {
    if (presentation.ui.commandCompletionIndex === next) {
      return;
    }

    presentation.ui.commandCompletionIndex = next;
    emitPresentationUpdate(effectType);
  };

  const setPendingActionState = (next: EditorPendingAction, effectType = "ui.pending-action") => {
    if (presentation.ui.pendingAction === next) {
      return;
    }

    presentation.ui.pendingAction = next;
    emitPresentationUpdate(effectType);
  };

  const setPendingCountState = (next: string, effectType = "ui.pending-count") => {
    if (presentation.ui.pendingCount === next) {
      return;
    }

    presentation.ui.pendingCount = next;
    emitPresentationUpdate(effectType);
  };

  const clearPendingCount = () => {
    setPendingCountState("");
  };

  const readPendingCount = () => {
    if (!presentation.ui.pendingCount) {
      return 1;
    }

    const parsed = Number.parseInt(presentation.ui.pendingCount, 10);
    presentation.ui.pendingCount = "";
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  const setStickyViewMode = (next: boolean, effectType = "ui.sticky-view-mode") => {
    if (presentation.ui.stickyViewMode === next) {
      return;
    }

    presentation.ui.stickyViewMode = next;
    emitPresentationUpdate(effectType);
  };

  const setLastRepeatableMotion = (next: EditorRepeatableMotion | null, effectType = "ui.repeatable-motion") => {
    presentation.ui.lastRepeatableMotion = next;
    emitPresentationUpdate(effectType);
  };

  const setPreviewThemeName = (next: string | null, effectType = "ui.preview-theme") => {
    if (presentation.ui.previewTheme === next) {
      return;
    }

    presentation.ui.previewTheme = next;
    emitPresentationUpdate(effectType);
  };

  const setPickerState = (
    next: Omit<EditorPickerState, "items"> & { items: readonly PickerActionItem[] },
    effectType = "ui.picker"
  ) => {
    const previous = presentation.ui.picker;
    const itemsChanged =
      previous.items.length !== next.items.length ||
      previous.items.some(
        (item, index) => item.label !== next.items[index]?.label || item.detail !== next.items[index]?.detail
      );

    if (
      !itemsChanged &&
      previous.active === next.active &&
      previous.loading === next.loading &&
      previous.title === next.title &&
      previous.selectedIndex === next.selectedIndex &&
      previous.error === next.error
    ) {
      return;
    }

    pickerActions = next.items;
    presentation.ui.picker = {
      active: next.active,
      loading: next.loading,
      title: next.title,
      items: next.items.map((item, index) => ({
        label: item.label,
        detail: item.detail,
        selected: index === next.selectedIndex
      })),
      selectedIndex: next.selectedIndex,
      error: next.error
    };
    emitPresentationUpdate(effectType);
  };

  const closePicker = (effectType = "ui.picker.close") => {
    setPickerState(
      {
        active: false,
        loading: false,
        title: "",
        items: [],
        selectedIndex: 0,
        error: null
      },
      effectType
    );
  };

  const clearFlashState = (effectType = "ui.flash") => {
    if (!presentation.ui.flash.active) {
      return;
    }

    presentation.ui.flash = {
      active: false,
      target: "",
      input: "",
      hints: []
    };
    emitPresentationUpdate(effectType);
  };

  const findSearchMatch = (
    matches: readonly { from: number; to: number }[],
    offset: number,
    direction: "forward" | "backward",
    reverse = false
  ): { from: number; to: number } | null => {
    const forward = reverse ? direction === "backward" : direction === "forward";

    return forward
      ? matches.find((entry) => entry.from > offset || (entry.from <= offset && offset < entry.to)) ?? matches[0] ?? null
      : [...matches].reverse().find((entry) => entry.to - 1 < offset || (entry.from <= offset && offset < entry.to)) ??
          matches[matches.length - 1] ??
          null;
  };

  const applySelectionRange = (from: number, to: number) => {
    if (state.mode === "visual") {
      const anchor = state.selection.ranges[state.selection.primaryIndex]?.anchor ?? from;
      dispatch({
        selection: createSelection(anchor, Math.max(from, to - 1)),
        mode: "visual"
      });
      return;
    }

    dispatch({
      selection: createSelection(from, Math.max(from, to - 1)),
      mode: "normal"
    });
  };

  const restoreSearchPreview = () => {
    if (!searchPreviewState?.active) {
      searchPreviewState = null;
      return;
    }

    applySearchState(searchPreviewState.search, "search.restore");
    dispatch({
      selection: searchPreviewState.selection,
      mode: searchPreviewState.mode
    });
    searchPreviewState = null;
  };

  const runSearch = (
    query: string,
    direction: "forward" | "backward",
    reverse = false,
    startOffset?: number
  ): boolean => {
    const previousSearch = { ...searchState };
    applySearchState(
      {
        query,
        direction,
        lastMatch: null
      },
      "search.update"
    );

    if (presentation.search.matches.length === 0) {
      applySearchState(previousSearch, "search.restore");
      setBottomMessage({ tone: "warning", text: `No matches for ${query}` });
      return false;
    }

    const offset = startOffset ?? getActiveOffset();
    const match = findSearchMatch(presentation.search.matches, offset, direction, reverse);

    if (!match) {
      applySearchState(previousSearch, "search.restore");
      return false;
    }

    applySearchState({
      query,
      direction,
      lastMatch: match
    }, "search.match");
    applyRegisterValue("/", query, "register.search");
    applySelectionRange(match.from, match.to);
    revealSelectionWithinViewport();
    syncVisibleViewportRows();
    syncVisibleLanguageDecorations();
    ensureVisibleHighlightCoverage();
    setBottomMessage(null);
    return true;
  };

  const repeatSearch = (reverseAgainstDirection = false): boolean => {
    if (!searchState.query) {
      setBottomMessage({ tone: "warning", text: "No active search" });
      return false;
    }

    const baseOffset = searchState.lastMatch
      ? reverseAgainstDirection
        ? searchState.lastMatch.from - 1
        : searchState.lastMatch.to
      : undefined;

    return runSearch(searchState.query, searchState.direction, reverseAgainstDirection, baseOffset);
  };

  const dispatchOffsetSelection = (targetOffset: number, preferredColumn: number | null): boolean => {
    if (state.mode === "insert") {
      dispatch({
        selection: createSelection(targetOffset, targetOffset, preferredColumn)
      });
      return true;
    }

    if (state.mode === "visual") {
      const anchor = state.selection.ranges[state.selection.primaryIndex]?.anchor ?? targetOffset;
      dispatch({
        selection: createSelection(anchor, targetOffset, preferredColumn),
        mode: "visual"
      });
      return true;
    }

    dispatch({
      selection: createCharacterSelection(state.doc, targetOffset, preferredColumn)
    });
    return true;
  };

  const getVisualRow = (visualRowIndex: number): EditorVisualRow => {
    return presentation.viewport.visualRows[Math.max(0, Math.min(presentation.viewport.visualRows.length - 1, visualRowIndex))] ?? {
      docLine: 0,
      visualRowIndex: 0,
      segmentStart: 0,
      segmentEnd: 0,
      startColumn: 0,
      isContinuation: false,
      isLastSegment: true
    };
  };

  const getVisibleLineCount = () => Math.max(1, presentation.viewport.visibleVisualRows.length || presentation.viewport.visibleRowCapacity);

  const moveByVisualRows = (delta: number): boolean => {
    rebuildViewportModel();
    const activeOffset = getActiveOffset();
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
    return dispatchOffsetSelection(targetOffset, preferredColumn);
  };

  const gotoVisibleRow = (position: "top" | "center" | "bottom"): boolean => {
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
    return dispatchOffsetSelection(targetRow.segmentStart, 0);
  };

  const restoreJump = (entry: EditorJumpEntry | null): boolean => {
    if (!entry) {
      return false;
    }

    dispatch({
      selection: entry.selection,
      mode: entry.mode
    });
    revealSelectionWithinViewport();
    syncVisibleViewportRows();
    syncVisibleLanguageDecorations();
    return true;
  };

  const primeRegisterForPaste = () => {
    const selected = registers.selected;
    registers.selected = null;
    if (!selected) {
      return;
    }

    const value = controller.getRegister(selected);
    dispatch({
      yankBuffer: value
    });
  };

  const executeEditorCommand = (command: Command): boolean => {
    setBottomMessage(null);
    clearFlashState("flash.clear");
    closePicker("ui.picker.close");
    const selectedRegister = registers.selected;

    if (command === pasteAfter) {
      primeRegisterForPaste();
    }

    if (presentation.viewport.softWrap) {
      if (command === moveUp) {
        return moveByVisualRows(-1);
      }

      if (command === moveDown) {
        return moveByVisualRows(1);
      }

      if (command === pageUp) {
        return moveByVisualRows(-(Math.max(1, getVisibleLineCount() - 1)));
      }

      if (command === pageDown) {
        return moveByVisualRows(Math.max(1, getVisibleLineCount() - 1));
      }

      if (command === halfPageUp) {
        return moveByVisualRows(-Math.max(1, Math.floor(getVisibleLineCount() / 2)));
      }

      if (command === halfPageDown) {
        return moveByVisualRows(Math.max(1, Math.floor(getVisibleLineCount() / 2)));
      }

      if (command === gotoWindowTop) {
        return gotoVisibleRow("top");
      }

      if (command === gotoWindowCenter) {
        return gotoVisibleRow("center");
      }

      if (command === gotoWindowBottom) {
        return gotoVisibleRow("bottom");
      }
    }

    const viewport = getVisibleLineViewport();
    const didRun = command(state, dispatch, {
      history: historyControls,
      viewport: {
        fromLine: viewport.fromLine,
        toLine: viewport.toLine,
        visibleLineCount: Math.max(1, viewport.toLine - viewport.fromLine + 1)
      }
    });

    if (didRun && [yankSelection, deleteSelection, changeSelection].includes(command)) {
      if (selectedRegister) {
        controller.setRegister(selectedRegister, controller.getState().yankBuffer);
      }
      controller.selectRegister(null);
    }

    return didRun;
  };

  const executeCommandWithCount = async (
    command: Command,
    options: EditorKeyInputOptions = {}
  ): Promise<boolean> => {
    const count = readPendingCount();
    const selectedRegister = controller.getSelectedRegister();

    if (command === pasteAfter && selectedRegister === "+" && options.readClipboardText) {
      const value = await options.readClipboardText();
      controller.selectRegister(null);

      if (!value) {
        setBottomMessage({ tone: "warning", text: 'Register "+" is empty' });
        return false;
      }

      dispatch({ yankBuffer: value });
    }

    let applied = false;
    for (let index = 0; index < count; index += 1) {
      const previousMode = state.mode;
      const previousRevision = state.revision;
      const didRun = executeEditorCommand(command);

      if (!didRun) {
        break;
      }

      applied = true;

      if (state.mode !== previousMode || state.revision === previousRevision) {
        break;
      }
    }

    return applied;
  };

  const executeCommandWithCountSync = (command: Command): boolean => {
    const count = readPendingCount();
    let applied = false;

    for (let index = 0; index < count; index += 1) {
      const previousMode = state.mode;
      const previousRevision = state.revision;
      const didRun = executeEditorCommand(command);

      if (!didRun) {
        break;
      }

      applied = true;

      if (state.mode !== previousMode || state.revision === previousRevision) {
        break;
      }
    }

    return applied;
  };

  const runRepeatableMotion = async (motion: EditorRepeatableMotion, options: EditorKeyInputOptions = {}): Promise<boolean> => {
    switch (motion.kind) {
      case "find":
        return executeEditorCommand(
          motion.variant === "f"
            ? findNextChar(motion.target)
            : motion.variant === "F"
              ? findPrevChar(motion.target)
              : motion.variant === "t"
                ? findTillNextChar(motion.target)
                : findTillPrevChar(motion.target)
        );
      case "matching-bracket":
        return executeEditorCommand(gotoMatchingBracket);
      case "paragraph":
        return executeEditorCommand(motion.direction === "next" ? gotoNextParagraph : gotoPrevParagraph);
      case "textobject":
        return executeEditorCommand(selectTextobject(motion.mode, motion.object));
      case "search":
        return repeatSearch(motion.reverse);
    }

    return false;
  };

  const recordRepeatableMotion = (candidate: EditorRepeatableMotion, didChange: boolean) => {
    if (didChange) {
      setLastRepeatableMotion(candidate);
    }
  };

  const searchFromSelection = (reverse = false): boolean => {
    const selection = getSelectionOffsets(state);
    const query = escapeRegex(state.doc.slice(selection.from, selection.to));

    if (!query) {
      return false;
    }

    return runSearch(query, reverse ? "backward" : "forward");
  };

  const navigateDiagnostic = (direction: "next" | "prev", extreme = false): boolean => {
    if (presentation.language.diagnostics.length === 0) {
      setBottomMessage({ tone: "warning", text: "No diagnostics" });
      return false;
    }

    const activeOffset = getActiveOffset();
    const ordered = [...presentation.language.diagnostics].sort((left, right) => left.from - right.from);
    const target =
      direction === "next"
        ? extreme
          ? ordered[ordered.length - 1]
          : ordered.find((entry) => entry.from > activeOffset) ?? ordered[0]
        : extreme
          ? ordered[0]
          : [...ordered].reverse().find((entry) => entry.to - 1 < activeOffset) ?? ordered[ordered.length - 1];

    if (!target) {
      return false;
    }

    pushJumpEntry(createJumpEntry(state));
    applySelectionRange(target.from, target.to);
    revealSelectionWithinViewport();
    syncVisibleViewportRows();
    syncVisibleLanguageDecorations();
    emitPresentationUpdate("diagnostic.navigate");
    return true;
  };

  const toggleComments = async (mode: "smart" | "line" | "block" = "line"): Promise<boolean> => {
    const toggler = getCommentToggler();

    if (!toggler) {
      setBottomMessage({ tone: "warning", text: "No comment provider" });
      return false;
    }

    let changes: readonly TextChange[];

    try {
      const context = {
        document: getSnapshot(),
        selection: getSelectionOffsets(state)
      };

      changes =
        mode === "smart"
          ? toggler.toggleComments
            ? await toggler.toggleComments(context)
            : await toggler.toggleLineComments(context)
          : mode === "block"
            ? toggler.toggleBlockComments
              ? await toggler.toggleBlockComments(context)
              : toggler.toggleComments
                ? await toggler.toggleComments(context)
                : await toggler.toggleLineComments(context)
            : await toggler.toggleLineComments(context);
    } catch {
      setBottomMessage({ tone: "error", text: "Comment toggle failed" });
      return false;
    }

    if (changes.length === 0) {
      setBottomMessage({ tone: "info", text: "Nothing to comment" });
      return false;
    }

    dispatch({
      changes,
      effects: [{ type: "language.comment-toggle" }]
    });
    setBottomMessage({ tone: "info", text: "Toggled comments" });
    return true;
  };

  const selectTextobjectWithFallback = async (mode: SyntaxTextobjectMode, object: string): Promise<boolean> => {
    if (["w", "W", "p", "'", "\"", "`", "(", ")", "[", "]", "{", "}", "<", ">"].includes(object)) {
      return executeEditorCommand(selectTextobject(mode, object));
    }

    const provider = getSyntaxTextobjectProvider();
    if (!provider) {
      return false;
    }

    const next = await provider.selectTextobject({
      document: getSnapshot(),
      selection: getSelectionOffsets(state),
      activeOffset: getActiveCharacterOffset(state),
      object,
      mode
    });

    if (!next) {
      return false;
    }

    applySelectionRange(next.from, next.to);
    return true;
  };

  const navigateSyntax = async (direction: "next" | "prev", kind: string): Promise<boolean> => {
    const provider = getSyntaxNavigationProvider();
    const navigate = direction === "next" ? provider?.gotoNext : provider?.gotoPrev;

    if (!navigate) {
      return false;
    }

    const next = await navigate({
      document: getSnapshot(),
      activeOffset: getActiveCharacterOffset(state),
      kind
    });

    if (!next) {
      return false;
    }

    pushJumpEntry(createJumpEntry(state));
    applySelectionRange(next.from, next.to);
    revealSelectionWithinViewport();
    syncVisibleViewportRows();
    syncVisibleLanguageDecorations();
    emitPresentationUpdate("syntax.navigate");
    return true;
  };

  const previewSearch = (rawQuery: string, direction: "forward" | "backward") => {
    if (!searchPreviewState?.active) {
      return;
    }

    const query = rawQuery.trim();

    if (!query) {
      applySearchState(searchPreviewState.search, "search.restore");
      dispatch({
        selection: searchPreviewState.selection,
        mode: searchPreviewState.mode
      });
      return;
    }

    applySearchState({
      query,
      direction,
      lastMatch: null
    }, "search.preview");

    const matches = presentation.search.matches;

    if (matches.length === 0) {
      applySearchState(searchPreviewState.search, "search.restore");
      dispatch({
        selection: searchPreviewState.selection,
        mode: searchPreviewState.mode
      });
      return;
    }

    const match = findSearchMatch(matches, searchPreviewState.startOffset, direction);
    if (!match) {
      applySearchState(searchPreviewState.search, "search.restore");
      dispatch({
        selection: searchPreviewState.selection,
        mode: searchPreviewState.mode
      });
      return;
    }

    applySearchState({
      query,
      direction,
      lastMatch: match
    }, "search.preview");
    applySelectionRange(match.from, match.to);
    revealSelectionWithinViewport();
    syncVisibleViewportRows();
    syncVisibleLanguageDecorations();
    ensureVisibleHighlightCoverage();
  };

  const getCommandCompletionItems = (themeNames: readonly string[] = []): EditorCommandCompletionItem[] => {
    const commandLine = presentation.ui.commandLine;

    if (!commandLine.active || commandLine.prompt !== ":") {
      return [];
    }

    const rawValue = commandLine.value;
    const trimmedStart = rawValue.trimStart();

    if (!trimmedStart) {
      return [
        { label: "theme", detail: "switch theme" },
        { label: "write", detail: "save document" },
        { label: "format", detail: "format document" },
        { label: "code-actions", detail: "show code actions" }
      ];
    }

    const parts = trimmedStart.split(/\s+/);
    const commandName = (parts[0] ?? "").toLowerCase();
    const hasArgumentSpace = /\s$/.test(rawValue);
    const commandArgument = trimmedStart.slice(parts[0]?.length ?? 0).trim();

    if (commandName === "theme") {
      return themeNames
        .filter((entry) => entry.toLowerCase().includes(commandArgument.toLowerCase()))
        .map((entry) => ({ label: entry, detail: "theme" }));
    }

    if (!hasArgumentSpace) {
      return [
        { label: "theme", detail: "switch theme" },
        { label: "write", detail: "save document" },
        { label: "format", detail: "format document" },
        { label: "code-actions", detail: "show code actions" }
      ].filter((entry) => entry.label.startsWith(commandName));
    }

    return [];
  };

  const syncCommandPreviewTheme = (themeNames: readonly string[] = []) => {
    const items = getCommandCompletionItems(themeNames);
    const rawValue = presentation.ui.commandLine.value.trimStart();
    const activeCommandName = rawValue.split(/\s+/)[0]?.toLowerCase() ?? "";
    const previousItems = presentation.ui.commandCompletionItems;
    let changed =
      previousItems.length !== items.length ||
      previousItems.some((item, index) => item.label !== items[index]?.label || item.detail !== items[index]?.detail);

    if (changed) {
      presentation.ui.commandCompletionItems = items;
    }

    if (
      items.length === 0 ||
      !presentation.ui.commandLine.active ||
      presentation.ui.commandLine.prompt !== ":" ||
      activeCommandName !== "theme"
    ) {
      if (presentation.ui.previewTheme !== null) {
        presentation.ui.previewTheme = null;
        changed = true;
      }
      if (presentation.ui.commandCompletionIndex !== 0 && items.length === 0) {
        presentation.ui.commandCompletionIndex = 0;
        changed = true;
      }
      return { themeName: presentation.themeName, changed };
    }

    const index = Math.max(0, Math.min(items.length - 1, presentation.ui.commandCompletionIndex));
    if (presentation.ui.commandCompletionIndex !== index) {
      presentation.ui.commandCompletionIndex = index;
      changed = true;
    }
    const nextTheme = themeNames.find((entry) => entry === items[index]?.label) ?? items[index]?.label ?? null;
    if (presentation.ui.previewTheme !== nextTheme) {
      presentation.ui.previewTheme = nextTheme;
      changed = true;
    }
    return { themeName: nextTheme ?? presentation.themeName, changed };
  };

  const applyCommandCompletion = async (themeNames: readonly string[] = []): Promise<EditorKeyInputResult | null> => {
    const items = getCommandCompletionItems(themeNames);
    if (items.length === 0) {
      return null;
    }

    const selected = items[Math.max(0, Math.min(items.length - 1, presentation.ui.commandCompletionIndex))];
    if (!selected) {
      return null;
    }

    if (presentation.ui.commandLine.prompt !== ":") {
      return null;
    }

    if (selected.detail === "theme" && presentation.ui.commandLine.value.trimStart().toLowerCase().startsWith("theme")) {
      setCommandLineState({ ...presentation.ui.commandLine, value: `theme ${selected.label}` }, "ui.command-line.input");
      const result = await controller.handleCommandLineKey("Enter", { themeNames });
      return { ...result, themeName: result.themeName ?? presentation.themeName };
    }

    const nextValue =
      selected.label === "theme" || selected.label === "write"
        ? `${selected.label} `
        : selected.label;
    setCommandLineState({ ...presentation.ui.commandLine, value: nextValue }, "ui.command-line.input");
    presentation.ui.commandCompletionIndex = 0;
    const { themeName } = syncCommandPreviewTheme(themeNames);
    emitPresentationUpdate("ui.command-line.completion");
    return { handled: true, themeName };
  };

  const hasRunnableCommandLineValue = (rawValue: string, themeNames: readonly string[] = []): boolean => {
    const trimmed = rawValue.trim();

    if (!trimmed) {
      return false;
    }

    const [commandName = "", ...argumentParts] = trimmed.split(/\s+/);
    const value = commandName.toLowerCase();
    const commandArgument = argumentParts.join(" ").trim();

    if (["format", "fmt", "w", "write", "code-actions", "codeaction", "ca", "q", "quit"].includes(value)) {
      return true;
    }

    if (value !== "theme") {
      return false;
    }

    if (!commandArgument) {
      return true;
    }

    const normalizedArgument = commandArgument.toLowerCase();
    return themeNames.some(
      (entry) => entry.toLowerCase() === normalizedArgument || entry.toLowerCase().startsWith(normalizedArgument)
    );
  };

  const openDiagnosticsPicker = () => {
    const items = presentation.language.diagnostics.map((entry) => {
      const position = state.doc.positionAt(entry.from);
      const lineText = state.doc.lineAt(position.line).text.trim();
      return {
        label: `${position.line + 1}:${position.column + 1} ${entry.message}`,
        detail: lineText,
        run: () => {
          pushJumpEntry(createJumpEntry(state));
          applySelectionRange(entry.from, entry.to);
          revealSelectionWithinViewport();
          syncVisibleViewportRows();
          syncVisibleLanguageDecorations();
          closePicker("ui.picker.close");
        }
      };
    });

    if (items.length === 0) {
      setBottomMessage({ tone: "warning", text: "No diagnostics" });
      return false;
    }

    setPickerState(
      {
        active: true,
        loading: false,
        title: "diagnostics",
        items,
        selectedIndex: 0,
        error: null
      },
      "ui.picker"
    );
    return true;
  };

  const openJumpListPicker = () => {
    const items = controller.getJumpList().map((entry, index) => {
      const offset = getCursorOffset(entry.selection);
      const position = state.doc.positionAt(offset);
      const lineText = state.doc.lineAt(position.line).text.trim();
      return {
        label: `${index + 1}:${position.line + 1}:${position.column + 1}`,
        detail: lineText,
        run: () => {
          restoreJump(entry);
          closePicker("ui.picker.close");
        }
      };
    });

    if (items.length === 0) {
      setBottomMessage({ tone: "warning", text: "Jump list is empty" });
      return false;
    }

    setPickerState(
      {
        active: true,
        loading: false,
        title: "jumps",
        items,
        selectedIndex: Math.max(0, items.length - 1),
        error: null
      },
      "ui.picker"
    );
    return true;
  };

  const loadCodeActions = async (): Promise<boolean> => {
    setPickerState(
      {
        active: true,
        loading: true,
        title: "code actions",
        items: [],
        selectedIndex: 0,
        error: null
      },
      "ui.picker"
    );

    let actions: readonly EditorCodeAction[];
    try {
      actions = await controller.requestCodeActions();
    } catch {
      closePicker("ui.picker.close");
      setBottomMessage({ tone: "error", text: "Code actions request failed" });
      return false;
    }

    const items = actions.map((action) => ({
      label: action.title,
      run: async () => {
        const applied = await controller.applyCodeAction(action);
        if (!applied) {
          setBottomMessage({ tone: "warning", text: `No edits for ${action.title}` });
          return;
        }

        closePicker("ui.picker.close");
        setBottomMessage({ tone: "info", text: `Applied ${action.title}` });
      }
    }));

    setPickerState(
      {
        active: true,
        loading: false,
        title: "code actions",
        items,
        selectedIndex: 0,
        error: items.length === 0 ? "No code actions" : null
      },
      "ui.picker"
    );

    if (items.length === 0) {
      closePicker("ui.picker.close");
      setBottomMessage({ tone: "warning", text: "No code actions available" });
    }

    return items.length > 0;
  };

  const isFlashJumpOffset = (offset: number, target: string) => {
    const character = state.doc.text[offset] ?? "";

    if (!character || character !== target) {
      return false;
    }

    return offset !== getActiveOffset();
  };

  const collectVisibleFlashHints = (target: string): readonly EditorFlashHintState[] => {
    const offsets: number[] = [];

    for (const visualRow of presentation.viewport.visibleVisualRows) {
      for (let offset = visualRow.segmentStart; offset < visualRow.segmentEnd; offset += 1) {
        if (isFlashJumpOffset(offset, target)) {
          offsets.push(offset);
        }
      }
    }

    const labels = buildFlashLabels(target, offsets.length);
    return offsets.map((offset, index) => ({
      offset,
      label: labels[index] ?? ""
    }));
  };

  const applyFlashJump = (targetOffset: number) => {
    clearFlashState("flash.clear");
    const targetPosition = state.doc.positionAt(targetOffset);
    dispatch({
      selection:
        state.mode === "insert"
          ? createSelection(targetOffset, targetOffset, targetPosition.column)
          : state.mode === "visual"
            ? createSelection(state.selection.ranges[state.selection.primaryIndex]?.anchor ?? targetOffset, targetOffset, targetPosition.column)
            : createCharacterSelection(state.doc, targetOffset, targetPosition.column)
    });
  };

  const hasMissingHighlightCoverage = (viewport: EditorLineRange): boolean => {
    for (let lineIndex = viewport.fromLine; lineIndex <= viewport.toLine; lineIndex += 1) {
      if (!presentation.language.highlightCoverage.has(lineIndex)) {
        return true;
      }
    }

    return false;
  };

  const getChangedHighlightViewport = (
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ): EditorLineRange | null => {
    if (changes.length === 0) {
      return null;
    }

    let fromLine = Number.POSITIVE_INFINITY;
    let toLine = 0;

    for (const change of changes) {
      const nextStartLine = nextState.doc.positionAt(change.from).line;
      const nextEndOffset = change.insert.length > 0 ? change.from + change.insert.length - 1 : change.from;
      const nextEndLine = nextState.doc.positionAt(Math.min(nextEndOffset, nextState.doc.length)).line;
      fromLine = Math.min(fromLine, nextStartLine);
      toLine = Math.max(toLine, nextEndLine);
    }

    if (!Number.isFinite(fromLine)) {
      return null;
    }

    return {
      fromLine: Math.max(0, fromLine - 2),
      toLine: Math.min(nextState.doc.lineCount - 1, toLine + 2)
    };
  };

  const replaceHighlightCache = (spans: HighlightSpan[], viewport: EditorLineRange): boolean => {
    const nextCache = buildHighlightCache(state.doc, spans);
    let hasVisibleDirty = false;

    for (let index = viewport.fromLine; index <= viewport.toLine; index += 1) {
      presentation.language.highlightCoverage.add(index);
      const previous = presentation.language.highlightCache.get(index) ?? [];
      const next = nextCache.get(index) ?? [];

      if (!spansEqual(previous, next)) {
        hasVisibleDirty = true;
      }

      if (next.length > 0) {
        presentation.language.highlightCache.set(index, next);
      } else {
        presentation.language.highlightCache.delete(index);
      }
    }

    return hasVisibleDirty;
  };

  const remapHighlightCacheForChanges = (previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]) => {
    if (changes.length === 0) {
      return;
    }

    const nextCache = new Map<number, HighlightSpan[]>();

    for (const spans of presentation.language.highlightCache.values()) {
      for (const span of spans) {
        const originalLength = Math.max(0, span.to - span.from);
        const hasOverlappingChange = changes.some((change) => change.from < span.to && change.to > span.from);
        const startAffinity = changes.some(
          (change) => change.from === span.from && change.to === span.from && change.insert.length > 0
        )
          ? "right"
          : "left";
        const mappedFrom = Math.max(
          0,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(span.from, changes, startAffinity))
        );
        const nextTo = Math.max(
          mappedFrom,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(span.to, changes, "right"))
        );
        const mappedTo = hasOverlappingChange
          ? nextTo
          : Math.max(mappedFrom, Math.min(nextState.doc.length, mappedFrom + originalLength));

        if (mappedTo <= mappedFrom) {
          continue;
        }

        const startLine = nextState.doc.positionAt(mappedFrom).line;
        const endLine = nextState.doc.positionAt(Math.max(mappedFrom, mappedTo - 1)).line;

        for (let line = startLine; line <= endLine; line += 1) {
          const lineInfo = nextState.doc.lineAt(line);
          const from = Math.max(mappedFrom, lineInfo.start);
          const to = Math.min(mappedTo, lineInfo.end);

          if (to <= from) {
            continue;
          }

          const entry = nextCache.get(line);
          const clipped = { from, to, role: span.role };

          if (entry) {
            entry.push(clipped);
          } else {
            nextCache.set(line, [clipped]);
          }
        }
      }
    }

    presentation.language.highlightCache = nextCache;
    syncVisibleLanguageDecorations();
  };

  const remapHighlightCoverageForChanges = (previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]) => {
    if (changes.length === 0) {
      return;
    }

    const nextCoverage = new Set<number>();

    for (const lineIndex of presentation.language.highlightCoverage) {
      const previousLine = previousState.doc.lineAt(lineIndex);
      const mappedOffset = Math.max(
        0,
        Math.min(nextState.doc.length, mapOffsetThroughChanges(previousLine.start, changes, "left"))
      );
      nextCoverage.add(nextState.doc.positionAt(mappedOffset).line);
    }

    presentation.language.highlightCoverage = nextCoverage;
  };

  const remapDiagnosticsForChanges = (previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]) => {
    if (changes.length === 0 || presentation.language.diagnostics.length === 0) {
      return;
    }

    presentation.language.diagnostics = presentation.language.diagnostics
      .map((diagnostic) => {
        const from = Math.max(
          0,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(diagnostic.from, changes, "left"))
        );
        const to = Math.max(
          from,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(Math.max(diagnostic.from + 1, diagnostic.to), changes, "right"))
        );

        if (to <= from) {
          return null;
        }

        return {
          ...diagnostic,
          from,
          to
        };
      })
      .filter((diagnostic): diagnostic is EditorDiagnostic => diagnostic !== null);

    presentation.language.diagnosticsByLine = buildDiagnosticsCache(state.doc, presentation.language.diagnostics);
    syncVisibleLanguageDecorations();
  };

  const invalidateHighlightViewport = (viewport: EditorLineRange) => {
    for (let index = viewport.fromLine; index <= viewport.toLine; index += 1) {
      presentation.language.highlightCoverage.delete(index);
    }
  };

  const refreshHighlights = async (viewport: EditorLineRange, force = false): Promise<void> => {
    const highlighter = getHighlighter();

    if (!highlighter || presentation.language.languageRevision < 0) {
      if (presentation.language.highlightCache.size > 0) {
        presentation.language.highlightCache.clear();
        presentation.language.highlightCoverage.clear();
        presentation.language.visibleHighlightsByLine.clear();
        syncVisibleLanguageDecorations();
        emitPresentationUpdate("language.highlights.clear");
      }
      return;
    }

    if (presentation.language.languageRevision !== state.revision) {
      return;
    }

    const needsViewportHighlights =
      force ||
      presentation.language.lastHighlightedRevision !== presentation.language.languageRevision ||
      hasMissingHighlightCoverage(viewport);

    if (!needsViewportHighlights) {
      return;
    }

    const requestId = ++presentation.language.highlightRequestId;
    const next = await highlighter.getHighlights(viewport, presentation.language.languageRevision);

    if (requestId !== presentation.language.highlightRequestId) {
      return;
    }

    const changed = replaceHighlightCache(next, viewport);
    presentation.language.lastHighlightedRevision = presentation.language.languageRevision;
    const visibleChanged = syncVisibleLanguageDecorations();

    if (changed || visibleChanged) {
      emitPresentationUpdate("language.highlights");
    }
  };

  const ensureVisibleHighlightCoverage = (force = false): Promise<void> => {
    const highlighter = getHighlighter();

    if (!highlighter || presentation.language.languageRevision < 0) {
      return Promise.resolve();
    }

    if (presentation.language.languageRevision !== state.revision) {
      return Promise.resolve();
    }

    const viewport = getVisibleHighlightViewport();
    const needsViewportHighlights =
      force ||
      presentation.language.lastHighlightedRevision !== presentation.language.languageRevision ||
      hasMissingHighlightCoverage(viewport);

    if (!needsViewportHighlights) {
      return Promise.resolve();
    }

    const requestKey = `${presentation.language.languageRevision}:${viewport.fromLine}:${viewport.toLine}:${force ? 1 : 0}`;

    if (inFlightVisibleHighlightRequestKey === requestKey) {
      return inFlightVisibleHighlightRequest ?? Promise.resolve();
    }

    inFlightVisibleHighlightRequestKey = requestKey;
    inFlightVisibleHighlightRequest = refreshHighlights(viewport, force).finally(() => {
      if (inFlightVisibleHighlightRequestKey === requestKey) {
        inFlightVisibleHighlightRequestKey = null;
        inFlightVisibleHighlightRequest = null;
      }
    });
    return inFlightVisibleHighlightRequest;
  };

  const refreshDiagnostics = async (): Promise<void> => {
    const diagnosticsSource = getDiagnosticsSource();
    const requestId = ++presentation.language.diagnosticsRequestId;

    if (!diagnosticsSource) {
      if (presentation.language.diagnostics.length > 0 || presentation.language.diagnosticsByLine.size > 0) {
        presentation.language.diagnostics = [];
        presentation.language.diagnosticsByLine.clear();
        syncVisibleLanguageDecorations();
        emitPresentationUpdate("language.diagnostics.clear");
      }
      return;
    }

    try {
      const nextDiagnostics = await diagnosticsSource.diagnostics(getSnapshot());

      if (requestId !== presentation.language.diagnosticsRequestId) {
        return;
      }

      presentation.language.diagnostics = nextDiagnostics;
      presentation.language.diagnosticsByLine = buildDiagnosticsCache(state.doc, nextDiagnostics);
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("language.diagnostics");
    } catch {
      if (requestId !== presentation.language.diagnosticsRequestId) {
        return;
      }

      presentation.language.diagnostics = [];
      presentation.language.diagnosticsByLine = new Map();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("language.diagnostics.error");
    }
  };

  const refreshLineChanges = async (): Promise<void> => {
    const getLineChanges = presentation.language.host?.getLineChanges;
    const requestId = ++presentation.language.lineChangesRequestId;

    if (!getLineChanges) {
      if (presentation.language.lineChangesByLine.size > 0) {
        presentation.language.lineChangesByLine.clear();
        syncVisibleLanguageDecorations();
        emitPresentationUpdate("language.line-changes.clear");
      }
      return;
    }

    try {
      const changes = await getLineChanges({
        filePath: presentation.filePath,
        text: state.doc.text
      });

      if (requestId !== presentation.language.lineChangesRequestId) {
        return;
      }

      presentation.language.lineChangesByLine = buildLineChangesMap(changes);
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("language.line-changes");
    } catch {
      if (requestId !== presentation.language.lineChangesRequestId) {
        return;
      }

      presentation.language.lineChangesByLine = new Map();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("language.line-changes.error");
    }
  };

  const syncLanguage = async (options: {
    changes?: readonly TextChange[];
    forceDocumentSync?: boolean;
    highlightViewport?: EditorLineRange;
    refreshHighlights?: boolean;
    refreshDiagnostics?: boolean;
    refreshLineChanges?: boolean;
  } = {}): Promise<void> => {
    const changes = options.changes ?? [];
    const forceDocumentSync = options.forceDocumentSync ?? false;
    const shouldRefreshHighlights = options.refreshHighlights ?? true;
    const shouldRefreshDiagnostics = options.refreshDiagnostics ?? true;
    const shouldRefreshLineChanges = options.refreshLineChanges ?? true;
    const highlightViewport = options.highlightViewport ?? getVisibleHighlightViewport();

    if (changes.length > 0) {
      invalidateHighlightViewport(highlightViewport);
    }

    const highlighter = getHighlighter();

    if (highlighter && shouldRefreshHighlights) {
      if (forceDocumentSync || presentation.language.languageRevision < 0) {
        await highlighter.open(getSnapshot());
        presentation.language.languageRevision = state.revision;
        presentation.language.lastHighlightedRevision = -1;
        await refreshHighlights(highlightViewport, true);
      } else if (changes.length > 0) {
        await highlighter.update(getSnapshot(), changes);
        presentation.language.languageRevision = state.revision;
        presentation.language.lastHighlightedRevision = -1;
        await refreshHighlights(highlightViewport, true);
      } else if (presentation.language.languageRevision === state.revision) {
        await refreshHighlights(highlightViewport, false);
      }

      await ensureVisibleHighlightCoverage(false);
    }

    if (shouldRefreshDiagnostics) {
      void refreshDiagnostics();
    }

    if (shouldRefreshLineChanges) {
      void refreshLineChanges();
    }
  };

  const getCodeActionContext = () => {
    const selection = getSelectionOffsets(state);
    const overlappingDiagnostics = presentation.language.diagnostics.filter(
      (entry) => entry.from < selection.to && entry.to > selection.from
    );
    const activeLine = state.doc.positionAt(getActiveOffset()).line;
    const fallbackDiagnostics =
      overlappingDiagnostics.length > 0
        ? overlappingDiagnostics
        : presentation.language.diagnosticsByLine.get(activeLine) ?? [];

    return {
      document: getSnapshot(),
      selection,
      diagnostics: fallbackDiagnostics
    };
  };

  const resolveCodeActionChanges = async (action: EditorCodeAction): Promise<readonly TextChange[] | null> => {
    if (action.changes && action.changes.length > 0) {
      return action.changes;
    }

    return (await action.apply?.(getCodeActionContext())) ?? null;
  };

  const revealSelectionWithinViewport = (): boolean => {
    rebuildViewportModel();
    const visual = getVisualRowForOffset(
      state,
      presentation.viewport.visualRows,
      presentation.viewport.lineVisualRanges,
      getActiveOffset(),
      presentation.viewport.softWrap,
      presentation.viewport.wrapColumns
    );
    const visibleCount = Math.max(1, presentation.viewport.visibleRowCapacity);
    const scrolloff = Math.max(0, Math.min(presentation.viewport.scrolloffRows, Math.floor((visibleCount - 1) / 2)));
    const maxTop = Math.max(0, presentation.viewport.visualRows.length - visibleCount);
    const minRow = presentation.viewport.topVisualRow + scrolloff;
    const maxRow = presentation.viewport.topVisualRow + visibleCount - 1 - scrolloff;
    const previousTop = presentation.viewport.topVisualRow;

    if (visual.rowIndex < minRow) {
      presentation.viewport.topVisualRow = Math.max(0, visual.rowIndex - scrolloff);
      return presentation.viewport.topVisualRow !== previousTop;
    }

    if (visual.rowIndex > maxRow) {
      presentation.viewport.topVisualRow = Math.min(maxTop, Math.max(0, visual.rowIndex + scrolloff - visibleCount + 1));
      return presentation.viewport.topVisualRow !== previousTop;
    }

    return false;
  };

  const trimJumpTail = () => {
    if (jumpCursor < jumpList.length) {
      jumpList.splice(jumpCursor);
    }
  };

  const pushJumpEntry = (entry: EditorJumpEntry): boolean => {
    trimJumpTail();
    const previous = jumpList[jumpList.length - 1];

    if (previous && jumpEntryEquals(previous, entry)) {
      jumpCursor = jumpList.length;
      presentation.jumps.cursor = jumpCursor;
      return false;
    }

    jumpList.push(entry);
    if (jumpList.length > 100) {
      jumpList.shift();
    }
    jumpCursor = jumpList.length;
    presentation.jumps.cursor = jumpCursor;
    return true;
  };

  refreshSearchMatchCache();
  rebuildViewportModel();
  syncVisibleLanguageDecorations();

  controller = {
    getState() {
      return state;
    },
    getPresentationState() {
      return presentation;
    },
    dispatch,
    replaceState(nextState, transaction = { effects: [{ type: "controller.replace-state" }] }) {
      const prevState = state;
      state = {
        ...nextState,
        revision: prevState.revision + 1
      };
      history?.clear();
      refreshSearchMatchCache(state);
      presentation.language.languageRevision = -1;
      presentation.language.lastHighlightedRevision = -1;
      presentation.language.highlightRequestId = 0;
      inFlightVisibleHighlightRequestKey = null;
      inFlightVisibleHighlightRequest = null;
      presentation.language.diagnosticsRequestId = 0;
      presentation.language.lineChangesRequestId = 0;
      presentation.language.hoverRequestId = 0;
      presentation.language.highlightCache.clear();
      presentation.language.highlightCoverage.clear();
      presentation.language.visibleHighlightsByLine.clear();
      presentation.language.diagnostics = [];
      presentation.language.diagnosticsByLine.clear();
      presentation.language.lineChangesByLine.clear();
      rebuildViewportModel();
      syncVisibleLanguageDecorations();
      notify(prevState, state, transaction, { recordHistory: false });
    },
    execute(command, context = {}) {
      return command(state, dispatch, {
        ...context,
        history: historyControls
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSearchState() {
      return searchState;
    },
    setSearchState(next) {
      applySearchState(next, "search.update");
      if (typeof next.query === "string") {
        registers.search = next.query;
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
    },
    pushJump() {
      const pushed = pushJumpEntry(createJumpEntry(state));
      presentation.jumps.cursor = jumpCursor;
      return pushed;
    },
    jumpBackward() {
      if (jumpList.length === 0) {
        return null;
      }

      if (jumpCursor === jumpList.length) {
        pushJumpEntry(createJumpEntry(state));
      }

      if (jumpCursor <= 1) {
        return null;
      }

      jumpCursor -= 2;
      const target = jumpList[jumpCursor] ?? null;
      jumpCursor += 1;
      presentation.jumps.cursor = jumpCursor;
      return target;
    },
    jumpForward() {
      if (jumpCursor >= jumpList.length) {
        return null;
      }

      const target = jumpList[jumpCursor] ?? null;
      if (!target) {
        return null;
      }

      jumpCursor += 1;
      presentation.jumps.cursor = jumpCursor;
      return target;
    },
    getJumpList() {
      return [...jumpList];
    },
    getRegister(name = null) {
      const normalized = normalizeRegisterName(name ?? registers.selected);
      if (!normalized || normalized === "\"") {
        return registers.unnamed;
      }
      if (normalized === "/") {
        return registers.search;
      }
      return registers.named[normalized] ?? null;
    },
    setRegister(name, value) {
      applyRegisterValue(name, value, "register.update");
    },
    selectRegister(name) {
      registers.selected = normalizeRegisterName(name);
      emitPresentationUpdate("register.select");
    },
    getSelectedRegister() {
      return registers.selected;
    },
    updatePresentationState(updater, effectType = "presentation.update", options = {}) {
      updater(presentation);
      if (options.defer) {
        schedulePresentationUpdate(effectType);
      } else {
        emitPresentationUpdate(effectType);
      }
    },
    setViewportMetrics(metrics) {
      presentation.viewport.visibleRowCapacity = Math.max(1, metrics.visibleRowCapacity);
      presentation.viewport.wrapColumns = Math.max(1, metrics.wrapColumns);
      presentation.viewport.softWrap = metrics.softWrap;
      viewportModelRevision = -1;
      rebuildViewportModel();
      const didReveal = revealSelectionWithinViewport();
      const viewportChanged = syncVisibleViewportRows() || didReveal;
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.metrics");
      if (viewportChanged) {
        ensureVisibleHighlightCoverage();
      }
    },
    scrollViewportBy(rowsDelta) {
      if (rowsDelta === 0) {
        return true;
      }

      rebuildViewportModel();
      const maxTop = Math.max(0, presentation.viewport.visualRows.length - presentation.viewport.visibleRowCapacity);
      presentation.viewport.topVisualRow = Math.max(0, Math.min(maxTop, presentation.viewport.topVisualRow + rowsDelta));
      const viewportChanged = syncVisibleViewportRows();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.scroll");
      if (viewportChanged) {
        ensureVisibleHighlightCoverage();
      }
      return true;
    },
    alignViewportToSelection(position) {
      rebuildViewportModel();
      const visual = getVisualRowForOffset(
        state,
        presentation.viewport.visualRows,
        presentation.viewport.lineVisualRanges,
        getActiveOffset(),
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
      presentation.viewport.topVisualRow = Math.max(0, Math.min(maxTop, nextTop));
      const viewportChanged = syncVisibleViewportRows();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.align");
      if (viewportChanged) {
        ensureVisibleHighlightCoverage();
      }
      return true;
    },
    revealSelection() {
      const didReveal = revealSelectionWithinViewport();
      const viewportChanged = syncVisibleViewportRows() || didReveal;
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.reveal");
      if (viewportChanged) {
        ensureVisibleHighlightCoverage();
      }
    },
    setLanguageServices(languageServices) {
      presentation.language.services = normalizeLanguageServices(languageServices);
      presentation.language.languageRevision = -1;
      presentation.language.lastHighlightedRevision = -1;
      presentation.language.highlightRequestId = 0;
      inFlightVisibleHighlightRequestKey = null;
      inFlightVisibleHighlightRequest = null;
      presentation.language.diagnosticsRequestId = 0;
      presentation.language.lineChangesRequestId = 0;
      presentation.language.hoverRequestId = 0;
      presentation.language.highlightCache.clear();
      presentation.language.highlightCoverage.clear();
      presentation.language.visibleHighlightsByLine.clear();
      presentation.language.diagnostics = [];
      presentation.language.diagnosticsByLine.clear();
      presentation.language.lineChangesByLine.clear();
      presentation.language.visibleHighlights = [];
      presentation.language.visibleHighlightsByLine = new Map();
      presentation.language.visibleDiagnostics = [];
      presentation.language.visibleLineChanges = [];
      presentation.search.matches = [];
      presentation.search.visibleMatchesByLine = new Map();
      emitPresentationUpdate("language.services");
      void syncLanguage({
        forceDocumentSync: true,
        refreshHighlights: true,
        refreshDiagnostics: true,
        refreshLineChanges: true
      });
    },
    setHostServices(host) {
      presentation.language.host = host;
      emitPresentationUpdate("host.services");
      void syncLanguage({
        refreshHighlights: false,
        refreshDiagnostics: false,
        refreshLineChanges: true
      });
    },
    setFilePath(filePath) {
      presentation.filePath = filePath;
      emitPresentationUpdate("presentation.file-path");
      void syncLanguage({
        refreshHighlights: false,
        refreshDiagnostics: false,
        refreshLineChanges: true
      });
    },
    setThemeName(themeName) {
      presentation.themeName = themeName;
      emitPresentationUpdate("presentation.theme-name");
    },
    async handleKeyInput(input, options = {}) {
      const key = input.key;
      const ctrl = !!input.ctrl;
      const alt = !!input.alt;
      const meta = !!input.meta;
      const shift = !!input.shift;

      if (presentation.ui.flash.active || presentation.ui.pendingAction?.kind === "flash-target") {
        const handled = controller.handleFlashKey(key);
        if (handled) {
          return { handled: true };
        }
      }

      if (presentation.ui.picker.active) {
        if (key === "Escape") {
          closePicker("ui.picker.close");
          return { handled: true };
        }

        if (key === "ArrowLeft" || key === "h" || key === "ArrowUp" || key === "k") {
          if (presentation.ui.picker.items.length > 0) {
            setPickerState(
              {
                active: true,
                loading: presentation.ui.picker.loading,
                title: presentation.ui.picker.title,
                items: pickerActions,
                selectedIndex: Math.max(0, presentation.ui.picker.selectedIndex - 1),
                error: presentation.ui.picker.error
              },
              "ui.picker"
            );
          }
          return { handled: true };
        }

        if (key === "ArrowRight" || key === "l" || key === "ArrowDown" || key === "j") {
          if (presentation.ui.picker.items.length > 0) {
            setPickerState(
              {
                active: true,
                loading: presentation.ui.picker.loading,
                title: presentation.ui.picker.title,
                items: pickerActions,
                selectedIndex: Math.min(presentation.ui.picker.items.length - 1, presentation.ui.picker.selectedIndex + 1),
                error: presentation.ui.picker.error
              },
              "ui.picker"
            );
          }
          return { handled: true };
        }

        if (key === "Enter") {
          const item = pickerActions[presentation.ui.picker.selectedIndex];
          if (item) {
            await item.run();
          } else {
            closePicker("ui.picker.close");
          }
          return { handled: true };
        }

        if (/^[1-9]$/.test(key)) {
          const item = pickerActions[Number(key) - 1];
          if (item) {
            await item.run();
          }
          return { handled: true };
        }

        return { handled: false };
      }

      if (presentation.ui.commandLine.active) {
        if (key === "Tab") {
          const completionItems = getCommandCompletionItems(options.themeNames ?? []);
          if (completionItems.length === 0) {
            return { handled: false };
          }

          const delta = shift ? -1 : 1;
          presentation.ui.commandCompletionIndex =
            (presentation.ui.commandCompletionIndex + delta + completionItems.length) % completionItems.length;
          const { themeName } = syncCommandPreviewTheme(options.themeNames ?? []);
          emitPresentationUpdate("ui.command-line.completion");
          return { handled: true, themeName };
        }

      if (key === "Enter") {
        const completionItems = getCommandCompletionItems(options.themeNames ?? []);
        const nextValue = presentation.ui.commandLine.value;
        const selectedCompletion = completionItems[presentation.ui.commandCompletionIndex];
        const shouldTakeThemeCompletion =
            !!selectedCompletion &&
            presentation.ui.commandLine.prompt === ":" &&
            /^\s*theme\s+$/i.test(nextValue);

        if (shouldTakeThemeCompletion) {
          const result = await applyCommandCompletion(options.themeNames ?? []);
          return result ?? { handled: true, themeName: presentation.themeName };
        }

        if (selectedCompletion && !hasRunnableCommandLineValue(nextValue, options.themeNames ?? [])) {
          const result = await applyCommandCompletion(options.themeNames ?? []);
          return result ?? { handled: true, themeName: presentation.themeName };
        }

          const result = await controller.handleCommandLineKey("Enter", options);
          return { ...result, themeName: result.themeName ?? presentation.themeName };
        }

        const result = await controller.handleCommandLineKey(key, options);
        if (key.length === 1 || key === "Backspace" || key === "Escape") {
          const { themeName, changed } = syncCommandPreviewTheme(options.themeNames ?? []);
          if (changed) {
            emitPresentationUpdate("ui.command-line.completion");
          }
          if (result.handled) {
            return { ...result, themeName: result.themeName ?? themeName };
          }
        }
        return result;
      }

      if (presentation.ui.hover.active && key === "Escape") {
        presentation.ui.hover = {
          ...presentation.ui.hover,
          active: false,
          pinned: false,
          offset: null,
          content: ""
        };
        emitPresentationUpdate("ui.hover.clear");
        clearPendingCount();
        return { handled: true };
      }

      if (presentation.ui.stickyViewMode && (state.mode === "normal" || state.mode === "visual")) {
        if (key === "Escape") {
          setStickyViewMode(false);
          return { handled: true };
        }

        if (key === "j" || key === "ArrowDown") {
          controller.scrollViewportBy(1);
          return { handled: true };
        }

        if (key === "k" || key === "ArrowUp") {
          controller.scrollViewportBy(-1);
          return { handled: true };
        }
      }

      if (alt && !meta && !ctrl && state.mode !== "insert" && (key === "ArrowUp" || key === "ArrowDown")) {
        const syntaxSelector = getSyntaxSelector();
        const syntaxSelection =
          key === "ArrowUp"
            ? syntaxSelector?.expandSelection?.bind(syntaxSelector)
            : syntaxSelector?.shrinkSelection?.bind(syntaxSelector);

        if (!syntaxSelection) {
          return { handled: false };
        }

        const revision = state.revision;
        const syntaxRevision = presentation.language.languageRevision;
        const selection = getSelectionOffsets(state);
        const activeOffset = getActiveCharacterOffset(state);
        const nextSelection = await syntaxSelection(selection, activeOffset, syntaxRevision);
        if (!nextSelection || state.revision !== revision || nextSelection.to <= nextSelection.from) {
          return { handled: true };
        }

        dispatch({
          selection: createSelection(nextSelection.from, Math.max(nextSelection.from, nextSelection.to - 1))
        });
        return { handled: true };
      }

      if (alt && !meta && !ctrl && state.mode !== "insert" && key === ".") {
        if (!presentation.ui.lastRepeatableMotion) {
          return { handled: false };
        }

        await runRepeatableMotion(presentation.ui.lastRepeatableMotion, options);
        return { handled: true };
      }

      if (alt && !meta && !ctrl && state.mode !== "insert" && key === "*") {
        searchFromSelection(true);
        return { handled: true };
      }

      if (ctrl && !meta && !alt && state.mode === "insert" && key === "s") {
        historyControls.checkpoint?.();
        return { handled: true };
      }

      if (ctrl && !meta && !alt && state.mode === "insert" && key === "r") {
        setPendingActionState({ kind: "register-select", insert: true });
        return { handled: true };
      }

      if (ctrl && !meta && !alt && state.mode !== "insert" && key === "s") {
        pushJumpEntry(createJumpEntry(state));
        setBottomMessage({ tone: "info", text: "Saved jump" });
        return { handled: true };
      }

      if (ctrl && !meta && !alt && state.mode !== "insert" && key === "o") {
        restoreJump(controller.jumpBackward());
        return { handled: true };
      }

      if (ctrl && !meta && !alt && state.mode !== "insert" && key === "i") {
        restoreJump(controller.jumpForward());
        return { handled: true };
      }

      if (ctrl && !meta && !alt && (state.mode !== "insert" || presentation.ui.stickyViewMode) && ["b", "d", "f", "u"].includes(key)) {
        if (presentation.ui.stickyViewMode) {
          const delta =
            key === "b"
              ? -(Math.max(1, getVisibleLineCount() - 1))
              : key === "f"
                ? Math.max(1, getVisibleLineCount() - 1)
                : key === "u"
                  ? -Math.max(1, Math.floor(getVisibleLineCount() / 2))
                  : Math.max(1, Math.floor(getVisibleLineCount() / 2));
          controller.scrollViewportBy(delta);
          return { handled: true };
        }

        const command = key === "b" ? pageUp : key === "f" ? pageDown : key === "u" ? halfPageUp : halfPageDown;
        executeCommandWithCountSync(command);
        return { handled: true };
      }

      if (presentation.ui.pendingAction) {
        const nextPending = presentation.ui.pendingAction;

        if (key === "Escape") {
          if (nextPending.kind === "flash-target") {
            controller.handleFlashKey("Escape");
          } else {
            setPendingActionState(null);
          }
          clearPendingCount();
          return { handled: true };
        }

        if (nextPending.kind !== "flash-target") {
          setPendingActionState(null);
        }

        if (nextPending.kind === "g") {
          if (key === "c") {
            await toggleComments("line");
            return { handled: true };
          }

          const chordCommand = commandForGotoPrefix(key);
          if (chordCommand) {
            executeCommandWithCountSync(chordCommand);
            return { handled: true };
          }
        }

        if (nextPending.kind === "[" || nextPending.kind === "]") {
          if (key === "d" || key === "D") {
            navigateDiagnostic(nextPending.kind === "]" ? "next" : "prev", key === "D");
            return { handled: true };
          }

          if (["f", "t", "a", "c", "T", "g", "x"].includes(key)) {
            await navigateSyntax(nextPending.kind === "]" ? "next" : "prev", key);
            return { handled: true };
          }

          const chordCommand = commandForBracketPrefix(nextPending.kind, key);
          if (chordCommand) {
            const previousRevision = state.revision;
            executeCommandWithCountSync(chordCommand);
            recordRepeatableMotion(
              { kind: "paragraph", direction: nextPending.kind === "]" ? "next" : "prev" },
              state.revision !== previousRevision
            );
            return { handled: true };
          }
        }

        if (nextPending.kind === "m") {
          if (key === "m") {
            const previousRevision = state.revision;
            executeEditorCommand(gotoMatchingBracket);
            recordRepeatableMotion({ kind: "matching-bracket" }, state.revision !== previousRevision);
            return { handled: true };
          }

          if (key === "a" || key === "i") {
            setPendingActionState({ kind: "textobject", mode: key === "a" ? "around" : "inside" });
            return { handled: true };
          }

          if (key === "s") {
            setPendingActionState({ kind: "surround-add" });
            return { handled: true };
          }

          if (key === "d") {
            setPendingActionState({ kind: "surround-delete" });
            return { handled: true };
          }

          if (key === "r") {
            setPendingActionState({ kind: "surround-replace-from" });
            return { handled: true };
          }
        }

        if (nextPending.kind === "space") {
          if (!ctrl && !meta && key.toLowerCase() === "c") {
            await toggleComments(alt ? "line" : shift ? "block" : "smart");
            return { handled: true };
          }

          if (key === "a") {
            await loadCodeActions();
            return { handled: true };
          }

          if (key === "d") {
            openDiagnosticsPicker();
            return { handled: true };
          }

          if (key === "j") {
            openJumpListPicker();
            return { handled: true };
          }

          if (key === "k") {
            const hoverOffset = getActiveOffset();
            const activeDiagnostic =
              presentation.language.diagnostics.find((entry) => hoverOffset >= entry.from && hoverOffset < entry.to) ?? null;

            if (activeDiagnostic) {
              presentation.ui.hover = {
                active: true,
                pinned: true,
                offset: activeDiagnostic.from,
                content: activeDiagnostic.message,
                source: activeDiagnostic.source,
                tone: activeDiagnostic.severity === "error" ? "error" : activeDiagnostic.severity === "warning" ? "warning" : "info",
                left: presentation.ui.hover.left,
                top: presentation.ui.hover.top
              };
              emitPresentationUpdate("ui.hover");
              return { handled: true };
            }

            const nextHover = await controller.requestHover(hoverOffset);
            if (!nextHover || !nextHover.content.trim()) {
              setBottomMessage({ tone: "info", text: "No hover information" });
              return { handled: true };
            }

            presentation.ui.hover = {
              active: true,
              pinned: true,
              offset: hoverOffset,
              content: nextHover.content,
              source: nextHover.source,
              tone: "info",
              left: presentation.ui.hover.left,
              top: presentation.ui.hover.top
            };
            emitPresentationUpdate("ui.hover");
            return { handled: true };
          }
        }

        if (nextPending.kind === "find") {
          const previousRevision = state.revision;
          executeEditorCommand(
            nextPending.variant === "f"
              ? findNextChar(key)
              : nextPending.variant === "F"
                ? findPrevChar(key)
                : nextPending.variant === "t"
                  ? findTillNextChar(key)
                  : findTillPrevChar(key)
          );
          recordRepeatableMotion(
            { kind: "find", variant: nextPending.variant, target: key },
            state.revision !== previousRevision
          );
          return { handled: true };
        }

        if (nextPending.kind === "textobject") {
          const previousRevision = state.revision;
          const didRun = await selectTextobjectWithFallback(nextPending.mode, key);
          recordRepeatableMotion(
            { kind: "textobject", mode: nextPending.mode, object: key },
            didRun || state.revision !== previousRevision
          );
          return { handled: true };
        }

        if (nextPending.kind === "surround-add") {
          executeEditorCommand(addSurround(key));
          return { handled: true };
        }

        if (nextPending.kind === "surround-delete") {
          executeEditorCommand(deleteSurround(key));
          return { handled: true };
        }

        if (nextPending.kind === "surround-replace-from") {
          setPendingActionState({ kind: "surround-replace-to", fromObject: key });
          return { handled: true };
        }

        if (nextPending.kind === "surround-replace-to") {
          executeEditorCommand(replaceSurround(nextPending.fromObject, key));
          return { handled: true };
        }

        if (nextPending.kind === "register-select") {
          if (nextPending.insert && state.mode === "insert") {
            const value = key === "+" ? await options.readClipboardText?.() ?? null : controller.getRegister(key);
            controller.selectRegister(null);

            if (!value) {
              setBottomMessage({ tone: "warning", text: `Register ${key} is empty` });
              return { handled: true };
            }

            executeEditorCommand(insertText(value));
          } else {
            controller.selectRegister(key);
            setBottomMessage({ tone: "info", text: `Register "${key}" selected` });
          }
          return { handled: true };
        }

        if (nextPending.kind === "z") {
          if (key === "Escape") {
            setStickyViewMode(false);
            return { handled: true };
          }

          if (key === "z" || key === "c" || key === "m") {
            controller.alignViewportToSelection("center");
          } else if (key === "t") {
            controller.alignViewportToSelection("top");
          } else if (key === "b") {
            controller.alignViewportToSelection("bottom");
          } else if (key === "j") {
            controller.scrollViewportBy(1);
          } else if (key === "k") {
            controller.scrollViewportBy(-1);
          }

          if (!nextPending.sticky) {
            setStickyViewMode(false);
          }
          return { handled: true };
        }
      }

      if (meta || ctrl || alt) {
        return { handled: false };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === ":") {
        clearPendingCount();
        controller.openCommandLine(":");
        const { themeName, changed } = syncCommandPreviewTheme(options.themeNames ?? []);
        if (changed) {
          emitPresentationUpdate("ui.command-line.completion");
        }
        return { handled: true, themeName };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "/") {
        clearPendingCount();
        controller.openCommandLine("/");
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "?") {
        clearPendingCount();
        controller.openCommandLine("?");
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "\"") {
        setPendingActionState({ kind: "register-select", insert: false });
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && /^[0-9]$/.test(key) && !(presentation.ui.pendingCount === "" && key === "0")) {
        setPendingCountState(`${presentation.ui.pendingCount}${key}`);
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === " ") {
        setPendingActionState({ kind: "space" });
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === ",") {
        controller.beginFlashTarget();
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "z") {
        setStickyViewMode(false);
        setPendingActionState({ kind: "z", sticky: false });
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "Z") {
        setStickyViewMode(true);
        setPendingActionState({ kind: "z", sticky: true });
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "n") {
        controller.repeatSearch(false);
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "N") {
        controller.repeatSearch(true);
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "*") {
        searchFromSelection(false);
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "g") {
        setPendingActionState({ kind: "g" });
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && (key === "[" || key === "]")) {
        setPendingActionState({ kind: key });
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && key === "m") {
        setPendingActionState({ kind: "m" });
        return { handled: true };
      }

      if ((state.mode === "normal" || state.mode === "visual") && ["f", "F", "t", "T"].includes(key)) {
        setPendingActionState({ kind: "find", variant: key as "f" | "F" | "t" | "T" });
        return { handled: true };
      }

      const command =
        state.mode === "normal"
          ? commandForNormalMode(key)
          : state.mode === "visual"
            ? commandForVisualMode(key)
            : commandForInsertMode(key);

      if (!command) {
        return { handled: false };
      }

      if (command === pasteAfter && controller.getSelectedRegister() === "+" && options.readClipboardText) {
        await executeCommandWithCount(command, options);
      } else {
        executeCommandWithCountSync(command);
      }
      return { handled: true };
    },
    async handleTextInput(text, options = {}) {
      let handled = false;
      let themeName: string | null | undefined;
      let quit = false;

      for (const char of text) {
        const result = await controller.handleKeyInput({ key: char, text: char }, options);
        handled = handled || result.handled;
        if (result.themeName !== undefined) {
          themeName = result.themeName;
        }
        quit = quit || !!result.quit;
      }

      return { handled, themeName, quit };
    },
    openCommandLine(prompt) {
      if (prompt === "/" || prompt === "?") {
        searchPreviewState = {
          active: true,
          direction: prompt === "/" ? "forward" : "backward",
          selection: state.selection,
          mode: state.mode,
          search: { ...searchState },
          startOffset: getActiveOffset()
        };
      } else {
        searchPreviewState = null;
      }

      presentation.ui.pendingAction = null;
      presentation.ui.commandCompletionIndex = 0;
      presentation.ui.commandCompletionItems = [];
      presentation.ui.previewTheme = null;
      setCommandLineState({ active: true, value: "", prompt }, "ui.command-line.open");
    },
    async handleCommandLineKey(key, options = {}) {
      const commandLine = presentation.ui.commandLine;

      if (!commandLine.active) {
        return { handled: false };
      }

      if (key === "Escape") {
        restoreSearchPreview();
        searchPreviewState = null;
        presentation.ui.commandCompletionIndex = 0;
        presentation.ui.commandCompletionItems = [];
        presentation.ui.previewTheme = null;
        setCommandLineState({ active: false, value: "", prompt: ":" }, "ui.command-line.close");
        return { handled: true };
      }

      if (key === "Backspace") {
        const nextValue = commandLine.value.slice(0, -1);
        setCommandLineState({ ...commandLine, value: nextValue }, "ui.command-line.input");
        if (commandLine.prompt === "/" || commandLine.prompt === "?") {
          previewSearch(nextValue, commandLine.prompt === "/" ? "forward" : "backward");
        }
        return { handled: true };
      }

      if (key === "Enter") {
        const trimmed = commandLine.value.trim();
        const prompt = commandLine.prompt;
        presentation.ui.commandCompletionIndex = 0;
        presentation.ui.commandCompletionItems = [];
        presentation.ui.previewTheme = null;
        setCommandLineState({ active: false, value: "", prompt: ":" }, "ui.command-line.commit");

        if (prompt === "/" || prompt === "?") {
          searchPreviewState = null;
          if (!trimmed) {
            return { handled: true };
          }
          runSearch(trimmed, prompt === "/" ? "forward" : "backward");
          return { handled: true };
        }

        if (!trimmed) {
          return { handled: true };
        }

        const [commandName = "", ...argumentParts] = trimmed.split(/\s+/);
        const value = commandName.toLowerCase();
        const commandArgument = argumentParts.join(" ").trim();

        if (value === "q" || value === "quit") {
          return { handled: true, quit: true };
        }

        if (value === "format" || value === "fmt") {
          const didFormat = await controller.formatDocument();
          setBottomMessage({ tone: "info", text: didFormat ? "Formatted document" : "Already formatted" });
          return { handled: true };
        }

        if (value === "w" || value === "write") {
          const targetPath = commandArgument || presentation.filePath;
          const didSave = await controller.saveDocument(targetPath);
          setBottomMessage({
            tone: didSave ? "info" : "error",
            text: didSave ? `Wrote ${targetPath}` : `Write failed for ${targetPath}`
          });
          return { handled: true };
        }

        if (value === "theme") {
          if (!commandArgument) {
            setBottomMessage({ tone: "warning", text: "Theme name required" });
            return { handled: true };
          }

          const normalizedArgument = commandArgument.toLowerCase();
          const matchedTheme =
            options.themeNames?.find((entry) => entry.toLowerCase() === normalizedArgument) ??
            options.themeNames?.find((entry) => entry.toLowerCase().startsWith(normalizedArgument)) ??
            commandArgument;

          if (!matchedTheme) {
            setBottomMessage({ tone: "warning", text: `Unknown theme: ${commandArgument}` });
            return { handled: true };
          }

          presentation.themeName = matchedTheme;
          setBottomMessage({ tone: "info", text: `Theme ${matchedTheme}` });
          emitPresentationUpdate("presentation.theme-name");
          return { handled: true, themeName: matchedTheme };
        }

        if (value === "code-actions" || value === "codeaction" || value === "ca") {
          await loadCodeActions();
          return { handled: true };
        }

        setBottomMessage({ tone: "warning", text: `Unknown command: ${trimmed}` });
        return { handled: true };
      }

      if (key.length === 1) {
        const nextValue = `${commandLine.value}${key}`;
        setCommandLineState({ ...commandLine, value: nextValue }, "ui.command-line.input");
        if (commandLine.prompt === "/" || commandLine.prompt === "?") {
          previewSearch(nextValue, commandLine.prompt === "/" ? "forward" : "backward");
        }
        return { handled: true };
      }

      return { handled: false };
    },
    repeatSearch(reverseAgainstDirection = false) {
      return repeatSearch(reverseAgainstDirection);
    },
    beginFlashTarget() {
      presentation.ui.pendingAction = { kind: "flash-target" };
      emitPresentationUpdate("flash.pending");
    },
    handleFlashKey(key) {
      if (presentation.ui.flash.active) {
        if (key === "Escape" || key === "Backspace") {
          clearFlashState("flash.cancel");
          return true;
        }

        if (!/^[a-z]$/i.test(key)) {
          clearFlashState("flash.cancel");
          return true;
        }

        const matchingHints = presentation.ui.flash.hints.filter((hint) => hint.label === key.toLowerCase());

        if (matchingHints.length === 0) {
          return true;
        }

        if (matchingHints.length === 1) {
          applyFlashJump(matchingHints[0]!.offset);
          return true;
        }

        const narrowedLabels = buildFlashLabels(key.toLowerCase(), matchingHints.length);
        presentation.ui.flash = {
          ...presentation.ui.flash,
          input: `${presentation.ui.flash.input}${key.toLowerCase()}`,
          hints: matchingHints.map((hint, index) => ({
            offset: hint.offset,
            label: narrowedLabels[index] ?? narrowedLabels[0] ?? presentation.ui.flash.target
          }))
        };
        emitPresentationUpdate("flash.narrow");
        return true;
      }

      if (presentation.ui.pendingAction?.kind !== "flash-target") {
        return false;
      }

      presentation.ui.pendingAction = null;

      if (key === "Escape") {
        emitPresentationUpdate("flash.cancel");
        return true;
      }

      if (!/^[a-z]$/i.test(key)) {
        emitPresentationUpdate("flash.cancel");
        return false;
      }

      const hints = collectVisibleFlashHints(key);

      if (hints.length === 0) {
        setBottomMessage({ tone: "warning", text: `No visible '${key}' targets` });
        return true;
      }

      presentation.ui.flash = {
        active: true,
        target: key,
        input: "",
        hints
      };
      setBottomMessage(null);
      emitPresentationUpdate("flash.start");
      return true;
    },
    async refreshLanguage(options = {}) {
      await syncLanguage(options);
    },
    requestHover(offset) {
      const hoverSource = getHoverSource();

      if (!hoverSource) {
        return Promise.resolve(null);
      }

      const requestId = ++presentation.language.hoverRequestId;
      const revision = state.revision;
      return hoverSource.hover(getSnapshot(), offset).then((nextHover) => {
        if (requestId !== presentation.language.hoverRequestId || revision !== state.revision) {
          return null;
        }

        return nextHover;
      });
    },
    dismissHover() {
      presentation.language.hoverRequestId += 1;
    },
    requestCodeActions() {
      const codeActionSource = getCodeActionSource();

      if (!codeActionSource) {
        return Promise.resolve([]);
      }

      return codeActionSource.getCodeActions(getCodeActionContext()).catch(() => []);
    },
    applyCodeAction(action) {
      if (action.changes && action.changes.length > 0) {
        dispatch({
          changes: action.changes,
          effects: [{ type: "language.code-action", value: action.title }]
        });
        return Promise.resolve(true);
      }

      return resolveCodeActionChanges(action).then((changes) => {
        if (!changes || changes.length === 0) {
          return false;
        }

        dispatch({
          changes,
          effects: [{ type: "language.code-action", value: action.title }]
        });
        return true;
      });
    },
    formatDocument() {
      const formatter = getFormatter();

      if (!formatter) {
        return Promise.resolve(false);
      }

      return formatter
        .format({
          document: getSnapshot(),
          selection: getSelectionOffsets(state)
        })
        .then((changes) => {
          if (!changes || changes.length === 0) {
            return false;
          }

          dispatch({
            changes,
            effects: [{ type: "language.format" }]
          });
          return true;
        })
        .catch(() => false);
    },
    saveDocument(targetPath = presentation.filePath) {
      const writeFile = presentation.language.host?.writeFile;

      if (!writeFile) {
        return Promise.resolve(false);
      }

      const savedText = state.doc.text;
      return writeFile({
        filePath: targetPath,
        text: savedText
      })
        .then(() => {
          presentation.filePath = targetPath;
          emitPresentationUpdate("presentation.file-path");
          void refreshLineChanges();
          queueMicrotask(() => {
            void Promise.resolve(
              presentation.language.host?.didWriteFile?.({
                filePath: targetPath,
                text: savedText
              })
            ).catch(() => undefined);
          });
          return true;
        })
        .catch(() => false);
    }
  };

  return controller;
}
