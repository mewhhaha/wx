import { createEditorState, type EditorState } from "@wx/editor-core";

import { createCommandRuntime, type CommandRuntime } from "./command-runtime";
import { createCommandsRuntime, type CommandsRuntime } from "./commands";
import { createCompatibilityApi } from "./compat";
import { createControllerContextRuntime } from "./controller-context";
import { createControllerLifecycleRuntime } from "./controller-lifecycle";
import { createControllerSearchRuntime } from "./controller-search";
import { createControllerSurface } from "./controller-surface";
import { createSnapshotHistory } from "./history";
import { createKeyRuntime } from "./key-input";
import { createLanguageRuntime, type LanguageRuntime } from "./language";
import { createMultiSelectionRuntime } from "./multi-selection";
import { createPickerRuntime, type PickerRuntime } from "./picker";
import { createPresentationState } from "./presentation";
import { createRegistersJumpsRuntime } from "./registers-jumps";
import { normalizeLanguageServices } from "./normalize";
import { createSessionRuntime, createJumpEntry, normalizeRegisterName } from "./session";
import { syncVisibleViewportRows as syncVisibleViewportRowsInPresentation } from "./viewport";
import { createViewportModelRuntime } from "./viewport-model";
import { createViewportRuntime, type ViewportRuntime } from "./viewport-runtime";
import { createWorkspaceRuntime } from "./workspace";
import type {
  CreateEditorControllerOptions,
  EditorBottomMessageState,
  EditorBufferState,
  EditorController,
  EditorFileSearchResult,
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
  EditorWorkspacePanePresentationState,
  EditorWorkspacePresentationState,
  EditorWorkspaceSplitAxis,
  EditorUiPresentationState,
  EditorUpdate,
  EditorUpdateListener,
  EditorViewportPresentationState,
  EditorBufferState,
  EditorFileSearchResult,
  HistoryEntry,
  HistoryPlugin
} from "./types";

export { createSnapshotHistory };
export { normalizeLanguageServices };

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
  const jumpList = presentation.jumps.items as EditorJumpEntry[];
  const registers = presentation.registers;
  let controller!: EditorController;
  let commandRuntime!: CommandRuntime;
  let commandsRuntime!: CommandsRuntime;
  let keyRuntime!: ReturnType<typeof createKeyRuntime>;
  let languageRuntime!: LanguageRuntime;
  let pickerRuntime!: PickerRuntime;
  let searchRuntime!: ReturnType<typeof createControllerSearchRuntime>;
  let sessionRuntime!: ReturnType<typeof createSessionRuntime>;
  let registersJumpsRuntime!: ReturnType<typeof createRegistersJumpsRuntime>;
  const workspaceRuntime = createWorkspaceRuntime({
    state,
    presentation
  });
  let viewportModelRuntime!: ReturnType<typeof createViewportModelRuntime>;
  let viewportRuntime!: ViewportRuntime;
  let lifecycleRuntime!: ReturnType<typeof createControllerLifecycleRuntime>;
  const multiSelectionRuntime = createMultiSelectionRuntime({
    getState: () => state,
    getSearchState: () => searchRuntime.searchState,
    dispatch(transaction) {
      lifecycleRuntime.dispatch(transaction);
    }
  });

  const syncVisibleViewportRows = () => syncVisibleViewportRowsInPresentation(presentation);

  const contextRuntime = createControllerContextRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getDocumentRevision: () => documentRevision,
    dispatch(transaction) {
      lifecycleRuntime.dispatch(transaction);
    }
  });

  languageRuntime = createLanguageRuntime({
    context: {
      getState: () => state,
      getPresentation: () => presentation,
      getSearchMatchCache: () => searchRuntime.getSearchMatchCache(),
      getVisibleLineViewport: () => viewportModelRuntime.getVisibleLineViewportValue(),
      getVisibleHighlightViewport: () => viewportModelRuntime.getVisibleHighlightViewportValue(),
      getSnapshot: contextRuntime.getSnapshot,
      emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType),
      dispatch: (transaction) => lifecycleRuntime.dispatch(transaction)
    },
    setBottomMessage(message) {
      sessionRuntime.setBottomMessage(message);
    },
    setCompletionState(next, effectType) {
      sessionRuntime.setCompletionState(next, effectType);
    },
    setRenameState(next, effectType) {
      sessionRuntime.setRenameState(next, effectType);
    },
    applySelectionRange: contextRuntime.applySelectionRange,
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations: () => languageRuntime.syncVisibleLanguageDecorations(),
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    pushJump: () => registersJumpsRuntime.pushJumpEntry(createJumpEntry(state)),
    openBuffer: async (filePath) => controller.openBuffer(filePath),
    findBufferState(filePath) {
      return workspaceRuntime.getBufferState(filePath);
    },
    storeBufferState(filePath, nextState, dirty) {
      workspaceRuntime.storeBufferState(filePath, nextState, dirty);
    },
    createStateForText: workspaceRuntime.createStateForText,
    openActionPicker(options) {
      return pickerRuntime.openActionPicker(options);
    },
    openSearchPicker(source) {
      return pickerRuntime.openSearchPicker(source);
    }
  });

  const syncVisibleLanguageDecorations = () => languageRuntime.syncVisibleLanguageDecorations();

  searchRuntime = createControllerSearchRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    syncVisibleLanguageDecorations,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType)
  });

  sessionRuntime = createSessionRuntime({
    presentation,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType)
  });

  viewportModelRuntime = createViewportModelRuntime({
    getState: () => state,
    presentation,
    getActiveOffset: contextRuntime.getActiveOffset,
    dispatchOffsetSelection: contextRuntime.dispatchOffsetSelection
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
    refreshSearchMatchCache: searchRuntime.refreshSearchMatchCache,
    handleLanguageDocumentChange(prevState, nextState, changes) {
      languageRuntime.handleDocumentChange(prevState, nextState, changes);
    },
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    rebuildViewportModel: () => viewportModelRuntime.rebuildViewportModel(),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncLanguage: (runtimeOptions) => languageRuntime.syncLanguage(runtimeOptions),
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
      workspaceRuntime.syncFromActiveState(nextState, presentation, {
        docChanged: nextState.doc.text !== prevState.doc.text
      });
    }
  });

  registersJumpsRuntime = createRegistersJumpsRuntime({
    presentation,
    registers,
    jumpList,
    getState: () => state,
    dispatch: (transaction) => lifecycleRuntime.dispatch(transaction),
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations
  });

  searchRuntime.refreshSearchMatchCache();
  viewportModelRuntime.rebuildViewportModel();
  syncVisibleLanguageDecorations();

  commandsRuntime = createCommandsRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    dispatch: (transaction) => lifecycleRuntime.dispatch(transaction),
    getSnapshot: contextRuntime.getSnapshot,
    getActiveOffset: contextRuntime.getActiveOffset,
    getVisibleLineCount: () => viewportModelRuntime.getVisibleLineCount(),
    getVisibleLineViewport: () => viewportModelRuntime.getVisibleLineViewportValue(),
    readPendingCount: () => sessionRuntime.readPendingCount(),
    historyControls: lifecycleRuntime.historyControls,
    setBottomMessage: sessionRuntime.setBottomMessage,
    clearFlashState: sessionRuntime.clearFlashState,
    closePicker(effectType = "ui.picker.close") {
      pickerRuntime.closePicker(effectType);
    },
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    pushJumpEntry: registersJumpsRuntime.pushJumpEntry,
    createJumpEntry: () => createJumpEntry(state),
    dispatchOffsetSelection: contextRuntime.dispatchOffsetSelection,
    moveByVisualRows: (delta) => viewportModelRuntime.moveByVisualRows(delta),
    gotoVisibleRow: (position) => viewportModelRuntime.gotoVisibleRow(position),
    getCommentToggler: contextRuntime.getCommentToggler,
    getSyntaxSelector: contextRuntime.getSyntaxSelector,
    getSyntaxTextobjectProvider: contextRuntime.getSyntaxTextobjectProvider,
    getSyntaxNavigationProvider: contextRuntime.getSyntaxNavigationProvider,
    restoreJump: registersJumpsRuntime.restoreJump
  });

  pickerRuntime = createPickerRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    getBuffers: () => workspaceRuntime.getBuffers(),
    setBottomMessage: sessionRuntime.setBottomMessage,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType),
    jumpToSelection(from, to) {
      registersJumpsRuntime.pushJumpEntry(createJumpEntry(state));
      contextRuntime.applySelectionRange(from, to);
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
    getSearchState: () => searchRuntime.searchState,
    getActiveOffset: contextRuntime.getActiveOffset,
    applySearchState: searchRuntime.applySearchState,
    applyRegisterValue: registersJumpsRuntime.applyRegisterValue,
    applySelectionRange: contextRuntime.applySelectionRange,
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    setBottomMessage: sessionRuntime.setBottomMessage,
    setCommandLineState: sessionRuntime.setCommandLineState,
    setRenameState: sessionRuntime.setRenameState,
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
    requestRawHover: (offset) => languageRuntime.requestRawHover(offset),
    invalidateHoverRequest: () => {
      presentation.language.hoverRequestId += 1;
    },
    handleCommandLineKey: commandRuntime.handleCommandLineKeyInput
  });

  keyRuntime = createKeyRuntime({
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    getActiveOffset: contextRuntime.getActiveOffset,
    getVisibleLineCount: () => viewportModelRuntime.getVisibleLineCount(),
    executeEditorCommand: commandsRuntime.executeEditorCommand,
    executeCommandWithCount: commandsRuntime.executeCommandWithCount,
    executeCommandWithCountSync: commandsRuntime.executeCommandWithCountSync,
    requestCompletion: () => languageRuntime.requestCompletion(),
    acceptCompletion: (index) => languageRuntime.acceptCompletion(index),
    moveCompletion: (delta) => languageRuntime.moveCompletion(delta),
    dismissCompletion: () => languageRuntime.dismissCompletion(),
    gotoTarget: (kind) => languageRuntime.gotoTarget(kind),
    renameSymbol: (nextName) => languageRuntime.renameSymbol(nextName),
    openSymbols: (kind) => languageRuntime.openSymbols(kind),
    runRepeatableMotion: commandsRuntime.runRepeatableMotion,
    recordRepeatableMotion(candidate, didChange) {
      if (didChange) {
        sessionRuntime.setLastRepeatableMotion(candidate);
      }
    },
    handleAltArrowSyntaxSelection: commandsRuntime.handleAltArrowSyntaxSelection,
    searchFromSelection: commandRuntime.searchFromSelection,
    repeatSearch: commandRuntime.repeatSearch,
    toggleComments: commandsRuntime.toggleComments,
    navigateDiagnostic: commandsRuntime.navigateDiagnostic,
    navigateSyntax: commandsRuntime.navigateSyntax,
    selectTextobjectWithFallback: commandsRuntime.selectTextobjectWithFallback,
    syncCommandPreviewTheme: commandRuntime.syncCommandPreviewTheme,
    openCommandLine: commandRuntime.openCommandLineState,
    setCommandCompletions: sessionRuntime.setCommandCompletions,
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
    openBuffersPicker: pickerRuntime.openBuffersPicker,
    openPanesPicker: pickerRuntime.openPanesPicker,
    openFileSearchPicker: pickerRuntime.openFileSearchPicker,
    updatePickerQuery: pickerRuntime.updatePickerQuery,
    loadCodeActions: pickerRuntime.loadCodeActions,
    collectVisibleFlashHints: commandsRuntime.collectVisibleFlashHints,
    applyFlashJump: commandsRuntime.applyFlashJump,
    clearFlashState: sessionRuntime.clearFlashState,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType)
  });

  controller = createControllerSurface({
    getState: () => state,
    setState(next) {
      state = next;
    },
    getPresentation: () => presentation,
    listeners,
    history,
    refreshSearchMatchCache: searchRuntime.refreshSearchMatchCache,
    searchState: searchRuntime.searchState,
    setSearchState: searchRuntime.setSearchState,
    clearSearchState: searchRuntime.clearSearchState,
    compatibilityApi,
    lifecycleRuntime,
    viewportRuntime,
    viewportModelRuntime,
    languageRuntime,
    sessionRuntime,
    registersJumpsRuntime,
    workspaceRuntime,
    keyRuntime,
    multiSelectionRuntime,
    getActiveOffset: contextRuntime.getActiveOffset,
    createJumpEntry: () => createJumpEntry(state)
  });

  listeners.add((update) => {
    if (update.docChanged && update.transaction.changes?.length) {
      workspaceRuntime.applyBufferChangesToSiblingPanes(update.transaction.changes);
    }
  });

  return controller;
}
