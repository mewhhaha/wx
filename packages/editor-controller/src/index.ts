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
import { createControllerLifecycleRuntime } from "./controller-lifecycle";
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
import { createRegistersJumpsRuntime } from "./registers-jumps";
import { collectSearchMatches } from "./search";
import { createSessionRuntime } from "./session";
import {
  createJumpEntry,
  normalizeLanguageServices,
  normalizeRegisterName,
} from "./session";
import {
  alignSelectionTopVisualRow,
  syncVisibleViewportRows as syncVisibleViewportRowsInPresentation
} from "./viewport";
import { createViewportModelRuntime } from "./viewport-model";
import { createViewportRuntime, type ViewportRuntime } from "./viewport-runtime";
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
  let controller!: EditorController;
  let commandRuntime!: CommandRuntime;
  let commandsRuntime!: CommandsRuntime;
  let keyRuntime!: ReturnType<typeof createKeyRuntime>;
  let languageRuntime!: LanguageRuntime;
  let pickerRuntime!: PickerRuntime;
  let sessionRuntime!: ReturnType<typeof createSessionRuntime>;
  let registersJumpsRuntime!: ReturnType<typeof createRegistersJumpsRuntime>;
  let viewportModelRuntime!: ReturnType<typeof createViewportModelRuntime>;
  let viewportRuntime!: ViewportRuntime;
  let lifecycleRuntime!: ReturnType<typeof createControllerLifecycleRuntime>;

  const refreshSearchMatchCache = (targetState: EditorState = state) => {
    searchMatchCache = collectSearchMatches(targetState.doc.text, presentation.search.query);
    presentation.search.matches = searchMatchCache;
  };

  const applySearchState = (next: Partial<EditorSearchState>, effectType = "search.update") => {
    Object.assign(searchState, next);
    refreshSearchMatchCache();
    languageRuntime.syncVisibleLanguageDecorations();
    lifecycleRuntime.emitPresentationUpdate(effectType);
  };

  const syncVisibleViewportRows = () => syncVisibleViewportRowsInPresentation(presentation);
  const syncVisibleLanguageDecorations = () => languageRuntime.syncVisibleLanguageDecorations();

  const getSnapshot = () => ({
    revision: documentRevision,
    doc: state.doc
  });

  languageRuntime = createLanguageRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getSearchMatchCache: () => searchMatchCache,
    getVisibleLineViewport: () => viewportModelRuntime.getVisibleLineViewportValue(),
    getVisibleHighlightViewport: () => viewportModelRuntime.getVisibleHighlightViewportValue(),
    getSnapshot,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType),
    dispatch: (transaction) => lifecycleRuntime.dispatch(transaction)
  });

  const getCommentToggler = () => presentation.language.services.find((services) => services.comments)?.comments;
  const getSyntaxSelector = () => presentation.language.services.find((services) => services.syntaxSelector)?.syntaxSelector;
  const getSyntaxTextobjectProvider = () =>
    presentation.language.services.find((services) => services.syntaxTextobjects)?.syntaxTextobjects;
  const getSyntaxNavigationProvider = () =>
    presentation.language.services.find((services) => services.syntaxNavigation)?.syntaxNavigation;

  const getActiveOffset = () => (state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state));

  const requestRawHover = (offset: number) => languageRuntime.requestRawHover(offset);

  const closePicker = (effectType = "ui.picker.close") => {
    pickerRuntime.closePicker(effectType);
  };

  const applySelectionRange = (from: number, to: number) => {
    if (state.mode === "visual") {
      const anchor = state.selection.ranges[state.selection.primaryIndex]?.anchor ?? from;
    lifecycleRuntime.dispatch({
      selection: createSelection(anchor, Math.max(from, to - 1)),
      mode: "visual"
    });
      return;
    }

    lifecycleRuntime.dispatch({
      selection: createSelection(from, Math.max(from, to - 1)),
      mode: "normal"
    });
  };

  const dispatchOffsetSelection = (targetOffset: number, preferredColumn: number | null): boolean => {
    if (state.mode === "insert") {
      lifecycleRuntime.dispatch({
        selection: createSelection(targetOffset, targetOffset, preferredColumn)
      });
      return true;
    }

    if (state.mode === "visual") {
      const anchor = state.selection.ranges[state.selection.primaryIndex]?.anchor ?? targetOffset;
      lifecycleRuntime.dispatch({
        selection: createSelection(anchor, targetOffset, preferredColumn),
        mode: "visual"
      });
      return true;
    }

    lifecycleRuntime.dispatch({
      selection: createCharacterSelection(state.doc, targetOffset, preferredColumn)
    });
    return true;
  };

  const recordRepeatableMotion = (candidate: EditorRepeatableMotion, didChange: boolean) => {
    if (didChange) {
      sessionRuntime.setLastRepeatableMotion(candidate);
    }
  };
  sessionRuntime = createSessionRuntime({
    presentation,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType)
  });
  viewportModelRuntime = createViewportModelRuntime({
    getState: () => state,
    presentation,
    getActiveOffset,
    dispatchOffsetSelection
  });
  lifecycleRuntime = createControllerLifecycleRuntime({
    presentation,
    history,
    listeners,
    getState: () => state,
    setState(next) {
      state = next;
    },
    getDocumentRevision: () => documentRevision,
    setDocumentRevision(next) {
      documentRevision = next;
    },
    clearFlashOnDocChange: () => {
      sessionRuntime.clearFlashState(null);
    },
    clearHoverOnDocChange: () => {
      sessionRuntime.clearHoverState({ effectType: null });
    },
    refreshSearchMatchCache,
    handleLanguageDocumentChange(prevState, nextState, changes) {
      languageRuntime.handleDocumentChange(prevState, nextState, changes);
    },
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    rebuildViewportModel: () => viewportModelRuntime.rebuildViewportModel(),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncLanguage: (options) => languageRuntime.syncLanguage(options),
    handleYankBufferChanged(prevState, nextState) {
      if (nextState.yankBuffer !== prevState.yankBuffer) {
        registers.unnamed = nextState.yankBuffer;
        const selected = normalizeRegisterName(registers.selected);
        if (selected && selected !== "/") {
          if (registers.unnamed === null) {
            delete registers.named[selected];
          } else {
            registers.named[selected] = registers.unnamed;
          }
        }
      }
    }
  });
  registersJumpsRuntime = createRegistersJumpsRuntime({
    presentation,
    registers,
    jumpList: jumpList as EditorJumpEntry[],
    getState: () => state,
    dispatch: (transaction) => lifecycleRuntime.dispatch(transaction),
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations
  });
  refreshSearchMatchCache();
  viewportModelRuntime.rebuildViewportModel();
  syncVisibleLanguageDecorations();

  commandsRuntime = createCommandsRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    dispatch: (transaction) => lifecycleRuntime.dispatch(transaction),
    getSnapshot,
    getActiveOffset,
    getVisibleLineCount: () => viewportModelRuntime.getVisibleLineCount(),
    getVisibleLineViewport: () => viewportModelRuntime.getVisibleLineViewportValue(),
    readPendingCount: () => sessionRuntime.readPendingCount(),
    historyControls: lifecycleRuntime.historyControls,
    setBottomMessage: sessionRuntime.setBottomMessage,
    clearFlashState: sessionRuntime.clearFlashState,
    closePicker,
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    pushJumpEntry: registersJumpsRuntime.pushJumpEntry,
    createJumpEntry: () => createJumpEntry(state),
    dispatchOffsetSelection,
    moveByVisualRows: (delta) => viewportModelRuntime.moveByVisualRows(delta),
    gotoVisibleRow: (position) => viewportModelRuntime.gotoVisibleRow(position),
    getCommentToggler,
    getSyntaxSelector,
    getSyntaxTextobjectProvider,
    getSyntaxNavigationProvider,
    restoreJump: registersJumpsRuntime.restoreJump
  });

  pickerRuntime = createPickerRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    setBottomMessage: sessionRuntime.setBottomMessage,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType),
    jumpToSelection(from, to) {
      registersJumpsRuntime.pushJumpEntry(createJumpEntry(state));
      applySelectionRange(from, to);
      viewportModelRuntime.revealSelectionWithinViewport();
      syncVisibleViewportRows();
      syncVisibleLanguageDecorations();
    },
    restoreJump: registersJumpsRuntime.restoreJump
  });

  commandRuntime = createCommandRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    getSearchState: () => searchState,
    getActiveOffset,
    applySearchState,
    applyRegisterValue: registersJumpsRuntime.applyRegisterValue,
    applySelectionRange,
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    setBottomMessage: sessionRuntime.setBottomMessage,
    setCommandLineState: sessionRuntime.setCommandLineState,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType),
    loadCodeActions: () => pickerRuntime.loadCodeActions()
  });

  viewportRuntime = createViewportRuntime({
    viewport: presentation.viewport,
    resetViewportModelCache: () => viewportModelRuntime.resetViewportModelCache(),
    rebuildViewportModel: () => viewportModelRuntime.rebuildViewportModel(),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType),
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage()
  });

  const compatibilityApi = createCompatibilityApi({
    updatePresentationState: lifecycleRuntime.updatePresentationStateValue,
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
    getVisibleLineCount: () => viewportModelRuntime.getVisibleLineCount(),
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
    clearPendingCount: () => sessionRuntime.clearPendingCount(),
    setPendingActionState: sessionRuntime.setPendingActionState,
    setPendingCountState: sessionRuntime.setPendingCountState,
    setStickyViewMode: sessionRuntime.setStickyViewMode,
    setPickerState: pickerRuntime.setPickerState,
    movePicker: pickerRuntime.movePicker,
    acceptPicker: pickerRuntime.acceptPicker,
    closePicker: pickerRuntime.closePicker,
    setBottomMessage: sessionRuntime.setBottomMessage,
    clearHover: () => sessionRuntime.clearHoverState(),
    restoreJump: registersJumpsRuntime.restoreJump,
    openDiagnosticsPicker: pickerRuntime.openDiagnosticsPicker,
    openJumpListPicker: pickerRuntime.openJumpListPicker,
    loadCodeActions: pickerRuntime.loadCodeActions,
    collectVisibleFlashHints: commandsRuntime.collectVisibleFlashHints,
    applyFlashJump: commandsRuntime.applyFlashJump,
    clearFlashState: sessionRuntime.clearFlashState,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType)
  });

  controller = {
    getState() {
      return state;
    },
    getPresentationState() {
      return presentation;
    },
    ...compatibilityApi,
    dispatch(transaction) {
      lifecycleRuntime.dispatch(transaction);
    },
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
      viewportModelRuntime.rebuildViewportModel();
      languageRuntime.syncVisibleLanguageDecorations();
      lifecycleRuntime.notify(prevState, state, transaction, { recordHistory: false });
    },
    execute(command, context = {}) {
      return command(state, (transaction) => lifecycleRuntime.dispatch(transaction), {
        ...context,
        history: lifecycleRuntime.historyControls
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
      return registersJumpsRuntime.pushJumpEntry(createJumpEntry(state));
    },
    jumpBackward() {
      return registersJumpsRuntime.jumpBackward();
    },
    jumpForward() {
      return registersJumpsRuntime.jumpForward();
    },
    getJumpList() {
      return registersJumpsRuntime.getJumpList();
    },
    getRegister(name = null) {
      return registersJumpsRuntime.getRegister(name);
    },
    setRegister(name, value) {
      registersJumpsRuntime.applyRegisterValue(name, value, "register.update");
    },
    selectRegister(name) {
      registersJumpsRuntime.selectRegister(name);
    },
    getSelectedRegister() {
      return registersJumpsRuntime.getSelectedRegister();
    },
    setBottomMessage(message) {
      sessionRuntime.setBottomMessage(message);
    },
    clearBottomMessage() {
      sessionRuntime.setBottomMessage(null);
    },
    setViewportMetrics(metrics) {
      viewportRuntime.setViewportMetrics(metrics);
    },
    scrollViewportBy(rowsDelta) {
      return viewportRuntime.scrollViewportBy(rowsDelta);
    },
    alignViewportToSelection(position) {
      return viewportRuntime.alignViewport(
        () => alignSelectionTopVisualRow(state, presentation, getActiveOffset(), position),
        "viewport.align"
      );
    },
    revealSelection() {
      viewportRuntime.revealSelection();
    },
    setLanguageServices(languageServices) {
      presentation.language.services = normalizeLanguageServices(languageServices);
      languageRuntime.resetRequestTracking();
      languageRuntime.clearLanguageState();
      refreshSearchMatchCache(state);
      languageRuntime.syncVisibleLanguageDecorations();
      lifecycleRuntime.emitPresentationUpdate("language.services");
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
      lifecycleRuntime.emitPresentationUpdate("host.services");
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
      lifecycleRuntime.emitPresentationUpdate("presentation.file-path");
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
      lifecycleRuntime.emitPresentationUpdate("presentation.theme-name");
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
          const hoverCleared = sessionRuntime.clearHoverState({ effectType: null });
          if (options.pinned) {
            sessionRuntime.setBottomMessage({ tone: "info", text: "No hover information" });
          } else if (hoverCleared) {
            lifecycleRuntime.emitPresentationUpdate("ui.hover.clear");
          }
          return false;
        }

        sessionRuntime.showHoverState(
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
      return sessionRuntime.showHoverState(
        {
          active: true,
          pinned: !!options.pinned,
          offset: diagnostic.from,
          content: diagnostic.message,
          source: diagnostic.source,
          tone: sessionRuntime.hoverToneForDiagnostic(diagnostic.severity)
        },
        { clearBottomMessage: true, invalidateRequest: true }
      );
    },
    clearHover(options = {}) {
      return sessionRuntime.clearHoverState({ preservePinned: options.preservePinned });
    },
    clearFlash() {
      return sessionRuntime.clearFlashState();
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
