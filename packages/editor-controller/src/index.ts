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
  EditorLineRange,
  HighlightSpan,
  SyntaxTextobjectMode
} from "@wx/editor-language";
import {
  getVisualRowForOffset,
  type EditorVisualRow
} from "../../editor-layout/src/index";
import { buildFlashLabels } from "./flash-labels";
import {
  getCommandCompletionItems,
  hasRunnableCommandLineValue,
  resolveCommandPreviewTheme
} from "./command-line";
import { createCompatibilityApi } from "./compat";
import {
  commandForBracketPrefix,
  commandForGotoPrefix,
  commandForInsertMode,
  commandForNormalMode,
  commandForVisualMode
} from "./keymap";
import { createSnapshotHistory, restoreEditorState } from "./history";
import { createKeyRuntime, type PickerActionItem } from "./key-input";
import { createLanguageRuntime, type LanguageRuntime } from "./language";
import { createPresentationState } from "./presentation";
import { collectSearchMatches, escapeRegex } from "./search";
import {
  createJumpEntry,
  jumpEntryEquals,
  normalizeLanguageServices,
  normalizeRegisterName,
  selectionEquals,
  transactionRequiresFullDocumentLanguageSync
} from "./session";
import {
  alignSelectionTopVisualRow,
  getVisibleHighlightViewport as getVisibleHighlightViewportFromPresentation,
  getVisibleLineViewport as getVisibleLineViewportFromPresentation,
  getVisualRowAtIndex,
  rebuildViewportPresentation,
  revealSelectionTopVisualRow,
  syncVisibleViewportRows as syncVisibleViewportRowsInPresentation
} from "./viewport";
import type {
  CreateEditorControllerOptions,
  EditorBottomMessageState,
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
  let documentRevision = 0;
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
  let pickerActions: readonly PickerActionItem[] = [];
  let controller!: EditorController;
  let keyRuntime!: ReturnType<typeof createKeyRuntime>;
  let languageRuntime!: LanguageRuntime;
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
    languageRuntime.syncVisibleLanguageDecorations();
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

  const syncVisibleViewportRows = () => syncVisibleViewportRowsInPresentation(presentation);

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
      documentRevision += 1;
      clearFlashState(null);
      clearHoverState({ effectType: null });
      const changes = transaction.changes ?? [];
      refreshSearchMatchCache(nextState);
      languageRuntime.handleDocumentChange(prevState, nextState, changes);
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
        languageRuntime.syncVisibleLanguageDecorations();
      }
    }

    if (viewportChanged) {
      void languageRuntime.ensureVisibleHighlightCoverage();
    }

    if (update.docChanged) {
      void languageRuntime.syncLanguage({
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

  const updatePresentationStateValue = (
    updater: (presentation: EditorPresentationState) => void,
    effectType = "presentation.update",
    options: { defer?: boolean } = {}
  ) => {
    updater(presentation);
    if (options.defer) {
      schedulePresentationUpdate(effectType);
    } else {
      emitPresentationUpdate(effectType);
    }
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

    rebuildViewportPresentation(state, presentation);
    viewportModelRevision = state.revision;
    viewportModelWrapColumns = presentation.viewport.wrapColumns;
    viewportModelSoftWrap = presentation.viewport.softWrap;
  };

  const getVisibleLineViewportValue = (): EditorLineRange => {
    rebuildViewportModel();
    return getVisibleLineViewportFromPresentation(state, presentation);
  };

  const getVisibleHighlightViewportValue = (): EditorLineRange => {
    rebuildViewportModel();
    return getVisibleHighlightViewportFromPresentation(state, presentation);
  };

  const syncVisibleLanguageDecorations = () => languageRuntime.syncVisibleLanguageDecorations();

  const getSnapshot = () => ({
    revision: documentRevision,
    doc: state.doc
  });

  languageRuntime = createLanguageRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getSearchMatchCache: () => searchMatchCache,
    getVisibleLineViewport: getVisibleLineViewportValue,
    getVisibleHighlightViewport: getVisibleHighlightViewportValue,
    getSnapshot,
    emitPresentationUpdate,
    dispatch
  });

  const getCommentToggler = () => presentation.language.services.find((services) => services.comments)?.comments;
  const getSyntaxSelector = () => presentation.language.services.find((services) => services.syntaxSelector)?.syntaxSelector;
  const getSyntaxTextobjectProvider = () =>
    presentation.language.services.find((services) => services.syntaxTextobjects)?.syntaxTextobjects;
  const getSyntaxNavigationProvider = () =>
    presentation.language.services.find((services) => services.syntaxNavigation)?.syntaxNavigation;

  const getActiveOffset = () => (state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state));

  const setBottomMessageValue = (message: EditorBottomMessageState | null) => {
    const current = presentation.ui.bottomMessage;

    if (
      current?.tone === message?.tone &&
      current?.text === message?.text &&
      (!!current === !!message)
    ) {
      return false;
    }

    presentation.ui.bottomMessage = message;
    return true;
  };

  const setBottomMessage = (message: EditorBottomMessageState | null, effectType = "ui.bottom-message") => {
    if (!setBottomMessageValue(message)) {
      return;
    }

    emitPresentationUpdate(effectType);
  };

  const hoverStateEquals = (left: typeof presentation.ui.hover, right: typeof presentation.ui.hover) =>
    left.active === right.active &&
    left.pinned === right.pinned &&
    left.offset === right.offset &&
    left.content === right.content &&
    left.source === right.source &&
    left.tone === right.tone;

  const setHoverStateValue = (next: typeof presentation.ui.hover) => {
    if (hoverStateEquals(presentation.ui.hover, next)) {
      return false;
    }

    presentation.ui.hover = next;
    return true;
  };

  const clearHoverState = (
    options: {
      preservePinned?: boolean;
      effectType?: string;
      invalidateRequest?: boolean;
    } = {}
  ) => {
    if (options.preservePinned && presentation.ui.hover.pinned) {
      return false;
    }

    if (options.invalidateRequest !== false) {
      presentation.language.hoverRequestId += 1;
    }

    const changed = setHoverStateValue({
      active: false,
      pinned: false,
      offset: null,
      content: "",
      tone: "info"
    });

    if (changed && options.effectType !== null) {
      emitPresentationUpdate(options.effectType ?? "ui.hover.clear");
    }

    return changed;
  };

  const showHoverState = (
    next: typeof presentation.ui.hover,
    options: {
      effectType?: string;
      clearBottomMessage?: boolean;
      invalidateRequest?: boolean;
    } = {}
  ) => {
    if (options.invalidateRequest) {
      presentation.language.hoverRequestId += 1;
    }

    const hoverChanged = setHoverStateValue(next);
    const bottomMessageChanged = options.clearBottomMessage ? setBottomMessageValue(null) : false;

    if (hoverChanged || bottomMessageChanged) {
      emitPresentationUpdate(options.effectType ?? "ui.hover");
    }

    return hoverChanged || bottomMessageChanged;
  };

  const hoverToneForDiagnostic = (severity: EditorDiagnostic["severity"]): "info" | "warning" | "error" =>
    severity === "error" ? "error" : severity === "warning" ? "warning" : "info";

  const requestRawHover = (offset: number) => languageRuntime.requestRawHover(offset);

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
    if (presentation.ui.lastRepeatableMotion?.kind === next?.kind && JSON.stringify(presentation.ui.lastRepeatableMotion) === JSON.stringify(next)) {
      return;
    }
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

  const movePicker = (delta: number): boolean => {
    if (presentation.ui.picker.items.length === 0) {
      return false;
    }

    const nextIndex = Math.max(
      0,
      Math.min(presentation.ui.picker.items.length - 1, presentation.ui.picker.selectedIndex + delta)
    );

    setPickerState(
      {
        active: true,
        loading: presentation.ui.picker.loading,
        title: presentation.ui.picker.title,
        items: pickerActions,
        selectedIndex: nextIndex,
        error: presentation.ui.picker.error
      },
      "ui.picker"
    );
    return true;
  };

  const acceptPicker = async (index = presentation.ui.picker.selectedIndex): Promise<boolean> => {
    const item = pickerActions[index];
    if (!item) {
      closePicker("ui.picker.close");
      return false;
    }

    await item.run();
    return true;
  };

  const clearFlashState = (effectType: string | null = "ui.flash") => {
    if (!presentation.ui.flash.active) {
      return false;
    }

    presentation.ui.flash = {
      active: false,
      target: "",
      input: "",
      hints: []
    };

    if (effectType !== null) {
      emitPresentationUpdate(effectType);
    }

    return true;
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
    void languageRuntime.ensureVisibleHighlightCoverage();
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
    return getVisualRowAtIndex(presentation, visualRowIndex);
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

    const viewport = getVisibleLineViewportValue();
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
    void languageRuntime.ensureVisibleHighlightCoverage();
  };

  const syncCommandPreviewTheme = (themeNames: readonly string[] = []) => {
    const next = resolveCommandPreviewTheme({
      commandLine: presentation.ui.commandLine,
      commandCompletionIndex: presentation.ui.commandCompletionIndex,
      commandCompletionItems: presentation.ui.commandCompletionItems,
      previewTheme: presentation.ui.previewTheme,
      themeName: presentation.themeName,
      themeNames
    });

    if (next.changed) {
      presentation.ui.commandCompletionItems = next.items;
      presentation.ui.commandCompletionIndex = next.index;
      presentation.ui.previewTheme = next.previewTheme;
    }

    return { themeName: next.themeName, changed: next.changed };
  };

  const applyCommandCompletion = async (themeNames: readonly string[] = []): Promise<EditorKeyInputResult | null> => {
    const items = getCommandCompletionItems(presentation.ui.commandLine, themeNames);
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
      const result = await handleCommandLineKeyInput("Enter", { themeNames });
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

  const openCommandLineState = (prompt: ":" | "/" | "?") => {
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
  };

  const handleCommandLineKeyInput = async (
    key: string,
    options: EditorCommandLineKeyOptions = {}
  ): Promise<EditorCommandLineKeyResult> => {
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

  const revealSelectionWithinViewport = (): boolean => {
    rebuildViewportModel();
    const previousTop = presentation.viewport.topVisualRow;
    presentation.viewport.topVisualRow = revealSelectionTopVisualRow(state, presentation, getActiveOffset());
    return presentation.viewport.topVisualRow !== previousTop;
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

  const compatibilityApi = createCompatibilityApi({
    updatePresentationState: updatePresentationStateValue,
    openCommandLine: openCommandLineState,
    requestRawHover,
    invalidateHoverRequest: () => {
      presentation.language.hoverRequestId += 1;
    },
    handleCommandLineKey: handleCommandLineKeyInput
  });

  keyRuntime = createKeyRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    getActiveOffset,
    getVisibleLineCount,
    executeEditorCommand,
    executeCommandWithCount,
    executeCommandWithCountSync,
    runRepeatableMotion,
    recordRepeatableMotion,
    async handleAltArrowSyntaxSelection(key) {
      const syntaxSelector = getSyntaxSelector();
      const syntaxSelection =
        key === "ArrowUp"
          ? syntaxSelector?.expandSelection?.bind(syntaxSelector)
          : syntaxSelector?.shrinkSelection?.bind(syntaxSelector);

      if (!syntaxSelection) {
        return false;
      }

      const revision = state.revision;
      const syntaxRevision = presentation.language.languageRevision;
      const selection = getSelectionOffsets(state);
      const activeOffset = getActiveCharacterOffset(state);
      const nextSelection = await syntaxSelection(selection, activeOffset, syntaxRevision);
      if (!nextSelection || state.revision !== revision || nextSelection.to <= nextSelection.from) {
        return true;
      }

      dispatch({
        selection: createSelection(nextSelection.from, Math.max(nextSelection.from, nextSelection.to - 1))
      });
      return true;
    },
    searchFromSelection,
    repeatSearch,
    toggleComments,
    navigateDiagnostic,
    navigateSyntax,
    selectTextobjectWithFallback,
    syncCommandPreviewTheme,
    applyCommandCompletion,
    openCommandLine: openCommandLineState,
    handleCommandLineKeyInput,
    clearPendingCount,
    setPendingActionState,
    setPendingCountState,
    setStickyViewMode,
    setPickerState,
    movePicker,
    acceptPicker,
    closePicker,
    setBottomMessage,
    clearHover: () => clearHoverState(),
    restoreJump,
    openDiagnosticsPicker,
    openJumpListPicker,
    loadCodeActions,
    collectVisibleFlashHints,
    applyFlashJump,
    clearFlashState,
    emitPresentationUpdate
  });

  controller = {
    getState() {
      return state;
    },
    getPresentationState() {
      return presentation;
    },
    ...compatibilityApi,
    dispatch,
    replaceState(nextState, transaction = { effects: [{ type: "controller.replace-state" }] }) {
      const prevState = state;
      state = {
        ...nextState,
        revision: prevState.revision + 1
      };
      history?.clear();
      refreshSearchMatchCache(state);
      languageRuntime.resetRequestTracking();
      languageRuntime.clearLanguageState();
      rebuildViewportModel();
      languageRuntime.syncVisibleLanguageDecorations();
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
      const next = normalizeRegisterName(name);
      if (registers.selected === next) {
        return;
      }
      registers.selected = next;
      emitPresentationUpdate("register.select");
    },
    getSelectedRegister() {
      return registers.selected;
    },
    setBottomMessage(message) {
      setBottomMessage(message);
    },
    clearBottomMessage() {
      setBottomMessage(null);
    },
    setViewportMetrics(metrics) {
      presentation.viewport.visibleRowCapacity = Math.max(1, metrics.visibleRowCapacity);
      presentation.viewport.wrapColumns = Math.max(1, metrics.wrapColumns);
      presentation.viewport.softWrap = metrics.softWrap;
      viewportModelRevision = -1;
      rebuildViewportModel();
      const didReveal = revealSelectionWithinViewport();
      const viewportChanged = syncVisibleViewportRows() || didReveal;
      languageRuntime.syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.metrics");
      if (viewportChanged) {
        void languageRuntime.ensureVisibleHighlightCoverage();
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
      languageRuntime.syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.scroll");
      if (viewportChanged) {
        void languageRuntime.ensureVisibleHighlightCoverage();
      }
      return true;
    },
    alignViewportToSelection(position) {
      rebuildViewportModel();
      presentation.viewport.topVisualRow = alignSelectionTopVisualRow(
        state,
        presentation,
        getActiveOffset(),
        position
      );
      const viewportChanged = syncVisibleViewportRows();
      languageRuntime.syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.align");
      if (viewportChanged) {
        void languageRuntime.ensureVisibleHighlightCoverage();
      }
      return true;
    },
    revealSelection() {
      const didReveal = revealSelectionWithinViewport();
      const viewportChanged = syncVisibleViewportRows() || didReveal;
      languageRuntime.syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.reveal");
      if (viewportChanged) {
        void languageRuntime.ensureVisibleHighlightCoverage();
      }
    },
    setLanguageServices(languageServices) {
      presentation.language.services = normalizeLanguageServices(languageServices);
      languageRuntime.resetRequestTracking();
      languageRuntime.clearLanguageState();
      refreshSearchMatchCache(state);
      languageRuntime.syncVisibleLanguageDecorations();
      emitPresentationUpdate("language.services");
      void languageRuntime.syncLanguage({
        forceDocumentSync: true,
        refreshHighlights: true,
        refreshDiagnostics: true,
        refreshLineChanges: true
      });
    },
    setHostServices(host) {
      if (presentation.language.host === host) {
        return;
      }
      presentation.language.host = host;
      emitPresentationUpdate("host.services");
      void languageRuntime.syncLanguage({
        refreshHighlights: false,
        refreshDiagnostics: false,
        refreshLineChanges: true
      });
    },
    setFilePath(filePath) {
      if (presentation.filePath === filePath) {
        return;
      }
      presentation.filePath = filePath;
      emitPresentationUpdate("presentation.file-path");
      void languageRuntime.syncLanguage({
        refreshHighlights: false,
        refreshDiagnostics: false,
        refreshLineChanges: true
      });
    },
    setThemeName(themeName) {
      if (presentation.themeName === themeName) {
        return;
      }
      presentation.themeName = themeName;
      emitPresentationUpdate("presentation.theme-name");
    },
    handleKeyInput(input, options = {}) {
      return keyRuntime.handleKeyInput(input, options);
    },
    handleTextInput(text, options = {}) {
      return keyRuntime.handleTextInput(text, options);
    },
    repeatSearch(reverseAgainstDirection = false) {
      return keyRuntime.repeatSearch(reverseAgainstDirection);
    },
    beginFlashTarget() {
      keyRuntime.beginFlashTarget();
    },
    handleFlashKey(key) {
      return keyRuntime.handleFlashKey(key);
    },
    refreshLanguage(options = {}) {
      return languageRuntime.syncLanguage(options);
    },
    requestHoverAt(offset, options = {}) {
      if (presentation.ui.hover.active && presentation.ui.hover.offset === offset && presentation.ui.hover.pinned === !!options.pinned) {
        if (presentation.ui.hover.content.trim()) {
          return Promise.resolve(true);
        }
      }

      return requestRawHover(offset).then((nextHover) => {
        if (!nextHover || !nextHover.content.trim()) {
          const hoverCleared = clearHoverState({ effectType: null });
          if (options.pinned) {
            setBottomMessage({ tone: "info", text: "No hover information" });
          } else if (hoverCleared) {
            emitPresentationUpdate("ui.hover.clear");
          }
          return false;
        }

        showHoverState(
          {
            active: true,
            pinned: !!options.pinned,
            offset,
            content: nextHover.content,
            source: nextHover.source,
            tone: "info"
          },
          { clearBottomMessage: true }
        );
        return true;
      });
    },
    showDiagnosticHover(diagnostic, options = {}) {
      return showHoverState(
        {
          active: true,
          pinned: !!options.pinned,
          offset: diagnostic.from,
          content: diagnostic.message,
          source: diagnostic.source,
          tone: hoverToneForDiagnostic(diagnostic.severity)
        },
        { clearBottomMessage: true, invalidateRequest: true }
      );
    },
    clearHover(options = {}) {
      return clearHoverState({ preservePinned: options.preservePinned });
    },
    clearFlash() {
      return clearFlashState();
    },
    requestCodeActions() {
      return languageRuntime.requestCodeActions();
    },
    applyCodeAction(action) {
      return languageRuntime.applyCodeAction(action);
    },
    formatDocument() {
      return languageRuntime.formatDocument();
    },
    saveDocument(targetPath = presentation.filePath) {
      return languageRuntime.saveDocument(targetPath);
    }
  };

  return controller;
}
