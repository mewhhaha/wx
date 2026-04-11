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
  type TextChange,
  type Transaction
} from "@wx/editor-core";
import type {
  EditorDiagnostic,
  EditorLineRange,
  SyntaxTextobjectMode
} from "@wx/editor-language";
import {
  getVisualRowForOffset,
  type EditorVisualRow
} from "../../editor-layout/src/index";
import { createCommandRuntime, type CommandRuntime } from "./command-runtime";
import { createCommandsRuntime, type CommandsRuntime } from "./commands";
import { createCompatibilityApi } from "./compat";
import {
  commandForBracketPrefix,
  commandForGotoPrefix,
  commandForInsertMode,
  commandForNormalMode,
  commandForVisualMode
} from "./keymap";
import { createSnapshotHistory, restoreEditorState } from "./history";
import { createKeyRuntime } from "./key-input";
import { createLanguageRuntime, type LanguageRuntime } from "./language";
import { createPickerRuntime, type PickerRuntime } from "./picker";
import { createPresentationState } from "./presentation";
import { collectSearchMatches } from "./search";
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
  EditorController,
  EditorHostServices,
  EditorJumpEntry,
  EditorLineChange,
  EditorPendingAction,
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
  let controller!: EditorController;
  let commandRuntime!: CommandRuntime;
  let commandsRuntime!: CommandsRuntime;
  let keyRuntime!: ReturnType<typeof createKeyRuntime>;
  let languageRuntime!: LanguageRuntime;
  let pickerRuntime!: PickerRuntime;
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

  const closePicker = (effectType = "ui.picker.close") => {
    pickerRuntime.closePicker(effectType);
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

  const recordRepeatableMotion = (candidate: EditorRepeatableMotion, didChange: boolean) => {
    if (didChange) {
      setLastRepeatableMotion(candidate);
    }
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

  commandsRuntime = createCommandsRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    dispatch,
    getSnapshot,
    getActiveOffset,
    getVisibleLineCount,
    getVisibleLineViewport: getVisibleLineViewportValue,
    readPendingCount,
    historyControls,
    setBottomMessage,
    clearFlashState,
    closePicker,
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    revealSelectionWithinViewport,
    syncVisibleViewportRows,
    pushJumpEntry,
    createJumpEntry: () => createJumpEntry(state),
    dispatchOffsetSelection,
    moveByVisualRows,
    gotoVisibleRow,
    getCommentToggler,
    getSyntaxSelector,
    getSyntaxTextobjectProvider,
    getSyntaxNavigationProvider,
    restoreJump
  });

  pickerRuntime = createPickerRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    setBottomMessage,
    emitPresentationUpdate,
    jumpToSelection(from, to) {
      pushJumpEntry(createJumpEntry(state));
      applySelectionRange(from, to);
      revealSelectionWithinViewport();
      syncVisibleViewportRows();
      syncVisibleLanguageDecorations();
    },
    restoreJump
  });

  commandRuntime = createCommandRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    getSearchState: () => searchState,
    getActiveOffset,
    applySearchState,
    applyRegisterValue,
    applySelectionRange,
    revealSelectionWithinViewport,
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    setBottomMessage,
    setCommandLineState,
    emitPresentationUpdate,
    loadCodeActions: () => pickerRuntime.loadCodeActions()
  });

  const compatibilityApi = createCompatibilityApi({
    updatePresentationState: updatePresentationStateValue,
    openCommandLine: commandRuntime.openCommandLineState,
    requestRawHover,
    invalidateHoverRequest: () => {
      presentation.language.hoverRequestId += 1;
    },
    handleCommandLineKey: commandRuntime.handleCommandLineKeyInput
  });

  keyRuntime = createKeyRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    getActiveOffset,
    getVisibleLineCount,
    executeEditorCommand: commandsRuntime.executeEditorCommand,
    executeCommandWithCount: commandsRuntime.executeCommandWithCount,
    executeCommandWithCountSync: commandsRuntime.executeCommandWithCountSync,
    runRepeatableMotion: commandsRuntime.runRepeatableMotion,
    recordRepeatableMotion,
    handleAltArrowSyntaxSelection: commandsRuntime.handleAltArrowSyntaxSelection,
    searchFromSelection: commandRuntime.searchFromSelection,
    repeatSearch: commandRuntime.repeatSearch,
    toggleComments: commandsRuntime.toggleComments,
    navigateDiagnostic: commandsRuntime.navigateDiagnostic,
    navigateSyntax: commandsRuntime.navigateSyntax,
    selectTextobjectWithFallback: commandsRuntime.selectTextobjectWithFallback,
    syncCommandPreviewTheme: commandRuntime.syncCommandPreviewTheme,
    openCommandLine: commandRuntime.openCommandLineState,
    handleActiveCommandLineKey: commandRuntime.handleActiveCommandLineKey,
    clearPendingCount,
    setPendingActionState,
    setPendingCountState,
    setStickyViewMode,
    setPickerState: pickerRuntime.setPickerState,
    movePicker: pickerRuntime.movePicker,
    acceptPicker: pickerRuntime.acceptPicker,
    closePicker: pickerRuntime.closePicker,
    setBottomMessage,
    clearHover: () => clearHoverState(),
    restoreJump,
    openDiagnosticsPicker: pickerRuntime.openDiagnosticsPicker,
    openJumpListPicker: pickerRuntime.openJumpListPicker,
    loadCodeActions: pickerRuntime.loadCodeActions,
    collectVisibleFlashHints: commandsRuntime.collectVisibleFlashHints,
    applyFlashJump: commandsRuntime.applyFlashJump,
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
