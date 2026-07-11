import { createEditorState, type EditorState } from "@mewhhaha/wx-core";
import type { LanguageRegistry } from "@mewhhaha/wx-language";

import { createCommandRuntime, type CommandRuntime } from "./command-runtime";
import { createCommandsRuntime, type CommandsRuntime } from "./commands";
import { createCompatibilityApi } from "./compat";
import { createControllerContextRuntime } from "./controller-context";
import { createControllerLifecycleRuntime } from "./controller-lifecycle";
import { createControllerSearchRuntime } from "./controller-search";
import { createControllerSurface } from "./controller-surface";
import { createSnapshotHistory } from "./history";
import { commandCatalogById } from "./command-catalog";
import { defaultKeymap } from "./default-keymap";
import { createRuntimeCommandRegistry, type RuntimeCommandRegistry } from "./key-command-registry";
import { compileKeymap, KeymapConfigurationError } from "./keymap-compiler";
import { createKeyRuntime } from "./key-input";
import type { KeyRuntimeContext } from "./key-runtime-types";
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
  EditorFolderSearchResult,
  EditorWorkspaceSearchCase,
  EditorWorkspaceSearchRequest,
  EditorWorkspaceSearchResult,
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
  HistoryPlugin,
  SnapshotHistoryOptions,
  SnapshotHistoryStats
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
  EditorFolderSearchResult,
  HistoryEntry,
  HistoryPlugin,
  SnapshotHistoryOptions,
  SnapshotHistoryStats
} from "./types";

export { createSnapshotHistory };
export { normalizeLanguageServices };
export { commandCatalog, commandCatalogById, completeCommandCatalog, resolveCommandId } from "./command-catalog";
export type { CommandArgContract, CommandArgRule, CommandAvailability, CommandMetadata, CommandOperand, EditorMode, KeymapContext } from "./command-catalog";
export { defaultKeymap } from "./default-keymap";
export { compileKeymap, contextAfterInput, eventToContextKeyStroke, eventToKeyStroke, getKeymapHelp, KeymapConfigurationError, parseKeySequence, parseKeyStroke, resolveContextKeymap, resolveKeymap } from "./keymap-compiler";
export type { CompiledBinding, CompiledKeymap, ContextKeymapResolution, KeymapResolution, KeymapTrie } from "./keymap-compiler";
export { decodeKeymapConfig, defaultKeymapContextPolicies } from "./keymap-schema";
export type { KeymapAfterInputPolicy, KeymapArgs, KeymapBinding, KeymapConfig, KeymapContextPolicy, KeymapIssue, KeymapIssueCode, KeymapModifierPolicy, KeymapOverlayPolicy, KeymapPrimitive, KeymapUnbind, KeymapUnmatchedPolicy } from "./keymap-schema";
export type { RuntimeCommandHandler, RuntimeCommandInvocation, RuntimeCommandRegistry } from "./key-command-registry";
export { createRuntimeCommandRegistry } from "./key-command-registry";

export function createEditorController(options: CreateEditorControllerOptions = {}): EditorController {
  const compiledKeymap = compileKeymap(defaultKeymap, options.keymap ?? { version: 1 });
  if (compiledKeymap.issues.length) throw new KeymapConfigurationError(compiledKeymap.issues);
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
  const history = options.history === false ? null : options.history ?? createSnapshotHistory(options.historyOptions);
  const jumpList = presentation.jumps.items as EditorJumpEntry[];
  const registers = presentation.registers;
  let languageRegistry = options.languageRegistry ?? null;
  let languageResolutionMode: "auto" | "manual" = languageRegistry ? "auto" : "manual";
  let controller!: EditorController;
  let commandRuntime!: CommandRuntime;
  let commandsRuntime!: CommandsRuntime;
  let commandRegistry!: RuntimeCommandRegistry;
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

  const languageServiceMessage = (error: unknown): string => {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    return String(error || "Language service failed");
  };

  const reportLanguageServiceFailure = (error: unknown) => {
    if (presentation.language.serviceStatus.state === "destroyed") {
      return;
    }
    const message = languageServiceMessage(error);
    presentation.language.serviceStatus = {
      ...presentation.language.serviceStatus,
      state: "failed",
      message,
      retryable: presentation.language.services.some((services) => !!services.lifecycle?.recreate)
    };
    sessionRuntime.setBottomMessage({
      tone: "warning",
      text: `Language services unavailable: ${message}${presentation.language.serviceStatus.retryable ? " (retry available)" : ""}`
    });
    lifecycleRuntime.emitPresentationUpdate("language.services.failed");
  };

  const reportLanguageServiceReady = () => {
    if (presentation.language.serviceStatus.state === "destroyed") {
      return;
    }
    const hasServices = presentation.language.services.length > 0;
    presentation.language.serviceStatus = {
      ...presentation.language.serviceStatus,
      state: hasServices ? "ready" : "disabled",
      message: null,
      retryable: false
    };
    if (presentation.ui.bottomMessage?.text.startsWith("Language services unavailable:")) {
      sessionRuntime.setBottomMessage(null);
    } else {
      lifecycleRuntime.emitPresentationUpdate("language.services.ready");
    }
  };

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
    reportServiceFailure: reportLanguageServiceFailure,
    reportServiceReady: reportLanguageServiceReady,
    setBottomMessage(message) {
      sessionRuntime.setBottomMessage(message);
    },
    setCompletionState(next, effectType) {
      sessionRuntime.setCompletionState(next, effectType);
    },
    setSignatureHelpState(next, effectType) { sessionRuntime.setSignatureHelpState(next, effectType); },
    setRenameState(next, effectType) {
      sessionRuntime.setRenameState(next, effectType);
    },
    applySelectionRange: contextRuntime.applySelectionRange,
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations: () => languageRuntime.syncVisibleLanguageDecorations(),
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    pushJump: (entry) => registersJumpsRuntime.pushJumpEntry(entry ?? createJumpEntry(state, presentation.filePath)),
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
    refreshSearchMatchCache(targetState) {
      // An empty search has no cache to rebuild and should not force lazy document text.
      if (searchRuntime.searchState.query.length > 0) {
        searchRuntime.refreshSearchMatchCache(targetState);
      }
    },
    handleLanguageDocumentChange(prevState, nextState, changes) {
      languageRuntime.handleDocumentChange(prevState, nextState, changes);
    },
    handleViewportDocumentChange(prevState, nextState, changes) {
      viewportModelRuntime.handleDocumentChange(prevState, nextState, changes);
    },
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    rebuildViewportModel: () => viewportModelRuntime.rebuildViewportModel(),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncLanguage: (runtimeOptions) => languageRuntime.syncLanguage(runtimeOptions),
    handleYankBufferChanged(prevState, nextState) {
      if (nextState.yankBuffer !== prevState.yankBuffer || nextState.yankKind !== prevState.yankKind) {
        registers.unnamed = nextState.yankBuffer;
        registers.unnamedKind = nextState.yankKind;
        const selected = normalizeRegisterName(registers.selected);
        if (selected && selected !== "/") {
          if (registers.unnamed === null) {
            delete registers.named[selected];
            delete registers.namedKinds[selected];
          } else {
            registers.named[selected] = registers.unnamed;
            registers.namedKinds[selected] = registers.unnamedKind;
          }
        }
      }
      workspaceRuntime.syncFromActiveState(nextState, presentation, {
        // Text documents are immutable, so identity avoids forcing lazy text on cursor updates.
        docChanged: nextState.doc !== prevState.doc
      });
    }
  });

  registersJumpsRuntime = createRegistersJumpsRuntime({
    presentation,
    registers,
    jumpList,
    getState: () => state,
    getFilePath: () => presentation.filePath,
    openBuffer: (filePath: string) => controller.openBuffer(filePath),
    dispatch: (transaction) => lifecycleRuntime.dispatch(transaction),
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    syncVisibleLanguageDecorations
  });

  if (searchRuntime.searchState.query.length > 0) {
    searchRuntime.refreshSearchMatchCache();
  }
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
    setLastRepeatableEdit: sessionRuntime.setLastRepeatableEdit,
    clearFlashState: sessionRuntime.clearFlashState,
    closePicker(effectType = "ui.picker.close") {
      pickerRuntime.closePicker(effectType);
    },
    syncVisibleLanguageDecorations,
    ensureVisibleHighlightCoverage: () => languageRuntime.ensureVisibleHighlightCoverage(),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    syncVisibleViewportRows,
    pushJumpEntry: registersJumpsRuntime.pushJumpEntry,
    createJumpEntry: () => createJumpEntry(state, presentation.filePath),
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
    jumpToSelection(from, to, recordCurrent = true) {
      if (recordCurrent) registersJumpsRuntime.pushJumpEntry(createJumpEntry(state, presentation.filePath));
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
    loadCodeActions: () => pickerRuntime.loadCodeActions(),
    openAddFilePicker: (initialName) => pickerRuntime.openAddFilePicker(initialName),
    runCatalogCommand: (command) => Promise.resolve(commandRegistry.dispatch({ command, input: { key: "" }, options: {} }))
  });

  viewportRuntime = createViewportRuntime({
    viewport: presentation.viewport,
    resetViewportModelCache: () => viewportModelRuntime.resetViewportModelCache(),
    rebuildViewportModel: () => viewportModelRuntime.rebuildViewportModel(),
    revealSelectionWithinViewport: () => viewportModelRuntime.revealSelectionWithinViewport(),
    scrollViewportWindow: (rowsDelta) => viewportModelRuntime.scrollViewportBy(rowsDelta),
    alignSelectionWithinViewport: (position) => viewportModelRuntime.alignSelectionWithinViewport(position),
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

  const keyRuntimeContext: KeyRuntimeContext = {
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
    requestSignatureHelp: () => languageRuntime.requestSignatureHelp(),
    moveSignatureHelp: (delta) => languageRuntime.moveSignatureHelp(delta),
    dismissSignatureHelp: () => languageRuntime.dismissSignatureHelp(),
    gotoTarget: (kind) => languageRuntime.gotoTarget(kind),
    renameSymbol: (nextName) => languageRuntime.renameSymbol(nextName),
    openSymbols: (kind) => languageRuntime.openSymbols(kind),
    runRepeatableMotion: commandsRuntime.runRepeatableMotion,
    runRepeatableEdit: commandsRuntime.runRepeatableEdit,
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
    readPendingCount: () => sessionRuntime.readPendingCount(),
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
    openWorkspaceSearchPicker: pickerRuntime.openWorkspaceSearchPicker,
    openAddFilePicker: pickerRuntime.openAddFilePicker,
    updatePickerQuery: pickerRuntime.updatePickerQuery,
    loadCodeActions: pickerRuntime.loadCodeActions,
    collectVisibleFlashHints: commandsRuntime.collectVisibleFlashHints,
    applyFlashJump: commandsRuntime.applyFlashJump,
    clearFlashState: sessionRuntime.clearFlashState,
    emitPresentationUpdate: (effectType) => lifecycleRuntime.emitPresentationUpdate(effectType)
  };
  commandRegistry = createRuntimeCommandRegistry(keyRuntimeContext, commandCatalogById);
  keyRuntime = createKeyRuntime(keyRuntimeContext, { compiled: compiledKeymap, registry: commandRegistry });

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
    pickerRuntime,
    keyRuntime,
    multiSelectionRuntime,
    getLanguageRegistry: () => languageRegistry,
    setLanguageRegistry(nextRegistry: LanguageRegistry | null) {
      languageRegistry = nextRegistry;
    },
    getLanguageResolutionMode: () => languageResolutionMode,
    setLanguageResolutionMode(nextMode) {
      languageResolutionMode = nextMode;
    },
    getActiveOffset: contextRuntime.getActiveOffset,
    createJumpEntry: () => createJumpEntry(state, presentation.filePath)
  });

  listeners.add((update) => {
    commandsRuntime.handleControllerUpdate(update);
  });

  listeners.add((update) => {
    if (update.docChanged && update.transaction.changes?.length) {
      workspaceRuntime.applyBufferChangesToSiblingPanes(update.transaction.changes);
    }
  });

  const signatureTriggers = new Set(options.signatureHelpTriggers ?? ["(", ","]);
  const completionTriggers = new Set(options.completionTriggers ?? ["."]);
  listeners.add((update) => {
    const inserted = update.transaction.changes?.map((change) => change.insert).join("") ?? "";
    const trigger = inserted.at(-1) ?? "";
    if (update.docChanged || update.selectionChanged || update.modeChanged) languageRuntime.dismissSignatureHelp();
    if (state.mode !== "insert" || !update.docChanged || !trigger) return;
    if (signatureTriggers.has(trigger)) void languageRuntime.requestSignatureHelp();
    else if (completionTriggers.has(trigger)) void languageRuntime.requestCompletion();
  });

  if (languageResolutionMode === "auto") {
    controller.resetLanguageServices();
  }

  return controller;
}
