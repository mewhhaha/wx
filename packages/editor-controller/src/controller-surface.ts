import { type CommandContext, type EditorState, type Transaction } from "@wx/editor-core";
import type { EditorCodeAction, EditorDiagnostic, EditorHover, EditorLanguageServiceInput } from "@wx/editor-language";

import { normalizeLanguageServices } from "./normalize";
import { alignSelectionTopVisualRow } from "./viewport";
import type {
  EditorBufferState,
  EditorController,
  EditorFileSearchResult,
  EditorJumpEntry,
  EditorPresentationState,
  EditorSearchState,
  EditorUpdateListener,
  EditorWorkspacePresentationState
} from "./types";

interface CreateControllerSurfaceOptions {
  getState(): EditorState;
  setState(next: EditorState): void;
  getPresentation(): EditorPresentationState;
  listeners: Set<EditorUpdateListener>;
  history: { clear?(): void } | null;
  refreshSearchMatchCache(targetState?: EditorState): void;
  searchState: EditorSearchState;
  setSearchState(next: Partial<EditorSearchState>, effectType?: string): void;
  clearSearchState(): void;
  compatibilityApi: Pick<
    EditorController,
    "updatePresentationState" | "openCommandLine" | "handleCommandLineKey" | "requestHover" | "dismissHover"
  >;
  lifecycleRuntime: {
    dispatch(transaction: Transaction): void;
    emitPresentationUpdate(effectType?: string): void;
    notify(
      prevState: EditorState,
      nextState: EditorState,
      transaction: Transaction,
      options?: { recordHistory?: boolean }
    ): void;
    historyControls: NonNullable<CommandContext["history"]>;
  };
  viewportRuntime: {
    setViewportMetrics(metrics: { visibleRowCapacity: number; wrapColumns: number; softWrap: boolean }): void;
    scrollViewportBy(rowsDelta: number): boolean;
    alignViewport(getTopVisualRow: () => number, effectType?: string): boolean;
    revealSelection(): void;
  };
  viewportModelRuntime: {
    rebuildViewportModel(): void;
    revealSelectionWithinViewport(): boolean;
  };
  languageRuntime: {
    resetRequestTracking(): void;
    clearLanguageState(): void;
    syncVisibleLanguageDecorations(): boolean;
    syncLanguage(options?: {
      forceDocumentSync?: boolean;
      refreshHighlights?: boolean;
      refreshDiagnostics?: boolean;
      refreshLineChanges?: boolean;
      highlightViewport?: { fromLine: number; toLine: number };
    }): Promise<void>;
    requestRawHover(offset: number): Promise<EditorHover | null>;
    requestCodeActions(): Promise<readonly EditorCodeAction[]>;
    applyCodeAction(action: EditorCodeAction): Promise<boolean>;
    requestCompletion(): Promise<boolean>;
    acceptCompletion(index?: number): Promise<boolean>;
    moveCompletion(delta: number): boolean;
    dismissCompletion(): boolean;
    gotoTarget(kind: "definition" | "declaration" | "type-definition" | "implementation" | "references"): Promise<boolean>;
    renameSymbol(nextName: string): Promise<boolean>;
    openSymbols(kind: "document" | "workspace"): Promise<boolean>;
    formatDocument(): Promise<boolean>;
    saveDocument(targetPath: string): Promise<boolean>;
  };
  sessionRuntime: {
    setBottomMessage(message: EditorPresentationState["ui"]["bottomMessage"] | null, effectType?: string): void;
    clearHoverState(options?: { preservePinned?: boolean; effectType?: string | null; invalidateRequest?: boolean }): boolean;
    showHoverState(
      next: EditorPresentationState["ui"]["hover"],
      options?: { effectType?: string; clearBottomMessage?: boolean; invalidateRequest?: boolean }
    ): boolean;
    hoverToneForDiagnostic(severity: EditorDiagnostic["severity"]): "info" | "warning" | "error";
    clearFlashState(effectType?: string | null): boolean;
  };
  registersJumpsRuntime: {
    pushJumpEntry(entry: EditorJumpEntry): boolean;
    jumpBackward(): EditorJumpEntry | null;
    jumpForward(): EditorJumpEntry | null;
    getJumpList(): readonly EditorJumpEntry[];
    getRegister(name?: string | null): string | null;
    applyRegisterValue(name: string | null, value: string | null, effectType?: string): void;
    selectRegister(name: string | null): void;
    getSelectedRegister(): string | null;
  };
  workspaceRuntime: {
    getWorkspacePresentationState(state: EditorState, presentation: EditorPresentationState): EditorWorkspacePresentationState;
    getBuffers(): readonly EditorBufferState[];
    getBufferById(bufferId: string): { id: string; filePath: string; dirty: boolean } | null;
    findBufferByFilePath(filePath: string): { id: string; filePath: string; dirty: boolean } | null;
    syncActiveFilePath(filePath: string): void;
    markActiveSaved(filePath?: string): void;
    storeBufferState(filePath: string, state: EditorState, dirty?: boolean): {
      id: string;
      filePath: string;
      dirty: boolean;
    };
    bindActivePaneToBuffer(bufferId: string): boolean;
    createStateForText(text: string, template: EditorState): EditorState;
    splitActivePane(axis: "horizontal" | "vertical"): boolean;
    closeActivePane(): { changed: boolean; nextActivePaneId: string | null };
    onlyActivePane(): boolean;
    focusPane(direction: "left" | "right" | "up" | "down"): string | null;
    focusNextPane(): string | null;
    setActivePane(paneId: string): boolean;
    loadActivePaneInto(state: EditorState, presentation: EditorPresentationState): EditorState;
  };
  keyRuntime: {
    handleKeyInput: EditorController["handleKeyInput"];
    handleTextInput: EditorController["handleTextInput"];
    repeatSearch(reverseAgainstDirection?: boolean): boolean;
    beginFlashTarget(): void;
    handleFlashKey(key: string): boolean;
  };
  multiSelectionRuntime: Pick<
    EditorController,
    "selectNextOccurrence" | "selectAllOccurrences" | "splitSelectionsByLine" | "collapseSelections" | "removePrimarySelection"
  >;
  getActiveOffset(): number;
  createJumpEntry(): EditorJumpEntry;
}

export function createControllerSurface(options: CreateControllerSurfaceOptions): EditorController {
  const presentation = options.getPresentation();
  const loadActivePaneState = (
    effectType: string,
    runtimeOptions: { clearHistory?: boolean; resetLanguage?: boolean } = {}
  ) => {
    const prevState = options.getState();
    const nextState = options.workspaceRuntime.loadActivePaneInto(prevState, presentation);
    options.setState(nextState);
    if (runtimeOptions.clearHistory) {
      options.history?.clear?.();
    }
    options.refreshSearchMatchCache(options.getState());
    if (runtimeOptions.resetLanguage) {
      options.languageRuntime.resetRequestTracking();
      options.languageRuntime.clearLanguageState();
    }
    options.viewportModelRuntime.rebuildViewportModel();
    options.languageRuntime.syncVisibleLanguageDecorations();
    options.lifecycleRuntime.notify(prevState, options.getState(), { effects: [{ type: effectType }] }, { recordHistory: false });
    if (runtimeOptions.resetLanguage) {
      void options.languageRuntime.syncLanguage({
        forceDocumentSync: true,
        refreshHighlights: true,
        refreshDiagnostics: true,
        refreshLineChanges: true
      });
    }
  };
  const switchBuffer = (bufferId: string) => {
    const entry = options.workspaceRuntime.getBufferById(bufferId);
    if (!entry) {
      return false;
    }

    if (!options.workspaceRuntime.bindActivePaneToBuffer(bufferId)) {
      return false;
    }

    loadActivePaneState("buffer.switch", { clearHistory: true, resetLanguage: true });
    return true;
  };

  return {
    getState() {
      return options.getState();
    },
    getPresentationState() {
      return presentation;
    },
    getWorkspacePresentationState() {
      return options.workspaceRuntime.getWorkspacePresentationState(options.getState(), presentation);
    },
    ...options.compatibilityApi,
    dispatch(transaction) {
      options.lifecycleRuntime.dispatch(transaction);
    },
    replaceState(nextState, transaction = { effects: [{ type: "controller.replace-state" }] }) {
      const prevState = options.getState();
      options.setState({
        ...nextState,
        revision: prevState.revision + 1
      });
      options.history?.clear?.();
      options.refreshSearchMatchCache(options.getState());
      options.languageRuntime.resetRequestTracking();
      options.languageRuntime.clearLanguageState();
      options.viewportModelRuntime.rebuildViewportModel();
      options.languageRuntime.syncVisibleLanguageDecorations();
      options.lifecycleRuntime.notify(prevState, options.getState(), transaction, { recordHistory: false });
    },
    execute(command, context = {}) {
      return command(options.getState(), (transaction) => options.lifecycleRuntime.dispatch(transaction), {
        ...context,
        history: options.lifecycleRuntime.historyControls
      });
    },
    subscribe(listener) {
      options.listeners.add(listener);
      return () => {
        options.listeners.delete(listener);
      };
    },
    getSearchState() {
      return options.searchState;
    },
    setSearchState(next) {
      options.setSearchState(next);
    },
    clearSearchState() {
      options.clearSearchState();
    },
    pushJump() {
      return options.registersJumpsRuntime.pushJumpEntry(options.createJumpEntry());
    },
    jumpBackward() {
      return options.registersJumpsRuntime.jumpBackward();
    },
    jumpForward() {
      return options.registersJumpsRuntime.jumpForward();
    },
    getJumpList() {
      return options.registersJumpsRuntime.getJumpList();
    },
    getRegister(name = null) {
      return options.registersJumpsRuntime.getRegister(name);
    },
    setRegister(name, value) {
      options.registersJumpsRuntime.applyRegisterValue(name, value, "register.update");
    },
    selectRegister(name) {
      options.registersJumpsRuntime.selectRegister(name);
    },
    getSelectedRegister() {
      return options.registersJumpsRuntime.getSelectedRegister();
    },
    getBuffers() {
      return options.workspaceRuntime.getBuffers();
    },
    switchBuffer(bufferId) {
      return switchBuffer(bufferId);
    },
    async openBuffer(filePath) {
      const existing = options.workspaceRuntime.findBufferByFilePath(filePath);
      if (existing) {
        return switchBuffer(existing.id);
      }

      const readFile = presentation.language.host?.readFile;
      if (!readFile) {
        options.sessionRuntime.setBottomMessage({ tone: "warning", text: "No file reader available" });
        return false;
      }

      let payload: { text: string } | string;
      try {
        payload = await readFile({ filePath });
      } catch {
        options.sessionRuntime.setBottomMessage({ tone: "error", text: `Could not open ${filePath}` });
        return false;
      }

      const text = typeof payload === "string" ? payload : payload.text;
      const entry = options.workspaceRuntime.storeBufferState(
        filePath,
        options.workspaceRuntime.createStateForText(text, options.getState())
      );
      return switchBuffer(entry.id);
    },
    splitPane(axis) {
      if (!options.workspaceRuntime.splitActivePane(axis)) {
        return false;
      }

      loadActivePaneState(`pane.split.${axis}`, { clearHistory: false, resetLanguage: false });
      return true;
    },
    closePane() {
      const result = options.workspaceRuntime.closeActivePane();
      if (!result.changed) {
        options.sessionRuntime.setBottomMessage({ tone: "warning", text: "Cannot close the last pane" });
        return false;
      }

      loadActivePaneState("pane.close", { clearHistory: false, resetLanguage: false });
      return true;
    },
    onlyPane() {
      if (!options.workspaceRuntime.onlyActivePane()) {
        return false;
      }

      loadActivePaneState("pane.only", { clearHistory: false, resetLanguage: false });
      return true;
    },
    focusNextPane() {
      const paneId = options.workspaceRuntime.focusNextPane();
      if (!paneId || !options.workspaceRuntime.setActivePane(paneId)) {
        return false;
      }

      loadActivePaneState("pane.focus-next", { clearHistory: false, resetLanguage: false });
      return true;
    },
    focusPane(direction) {
      const paneId = options.workspaceRuntime.focusPane(direction);
      if (!paneId || !options.workspaceRuntime.setActivePane(paneId)) {
        return false;
      }

      loadActivePaneState("pane.focus", { clearHistory: false, resetLanguage: false });
      return true;
    },
    setActivePane(paneId) {
      if (!options.workspaceRuntime.setActivePane(paneId)) {
        return false;
      }

      loadActivePaneState("pane.active", { clearHistory: false, resetLanguage: false });
      return true;
    },
    async searchFiles(scope, query = "") {
      const searchFiles = presentation.language.host?.searchFiles;
      if (!searchFiles) {
        return [];
      }

      try {
        return await searchFiles({
          scope,
          filePath: presentation.filePath,
          query
        });
      } catch {
        return [] as EditorFileSearchResult[];
      }
    },
    selectNextOccurrence(reverse = false) {
      return options.multiSelectionRuntime.selectNextOccurrence(reverse);
    },
    selectAllOccurrences() {
      return options.multiSelectionRuntime.selectAllOccurrences();
    },
    splitSelectionsByLine() {
      return options.multiSelectionRuntime.splitSelectionsByLine();
    },
    collapseSelections() {
      return options.multiSelectionRuntime.collapseSelections();
    },
    removePrimarySelection() {
      return options.multiSelectionRuntime.removePrimarySelection();
    },
    requestCompletion() {
      return options.languageRuntime.requestCompletion();
    },
    acceptCompletion(index) {
      return options.languageRuntime.acceptCompletion(index);
    },
    moveCompletion(delta) {
      return options.languageRuntime.moveCompletion(delta);
    },
    dismissCompletion() {
      return options.languageRuntime.dismissCompletion();
    },
    gotoTarget(kind) {
      return options.languageRuntime.gotoTarget(kind);
    },
    renameSymbol(nextName) {
      return options.languageRuntime.renameSymbol(nextName);
    },
    openSymbols(kind) {
      return options.languageRuntime.openSymbols(kind);
    },
    setBottomMessage(message) {
      options.sessionRuntime.setBottomMessage(message);
    },
    clearBottomMessage() {
      options.sessionRuntime.setBottomMessage(null);
    },
    setViewportMetrics(metrics) {
      options.viewportRuntime.setViewportMetrics(metrics);
    },
    scrollViewportBy(rowsDelta) {
      return options.viewportRuntime.scrollViewportBy(rowsDelta);
    },
    alignViewportToSelection(position) {
      return options.viewportRuntime.alignViewport(
        () => alignSelectionTopVisualRow(options.getState(), presentation, options.getActiveOffset(), position),
        "viewport.align"
      );
    },
    revealSelection() {
      options.viewportRuntime.revealSelection();
    },
    setLanguageServices(languageServices: EditorLanguageServiceInput | null) {
      presentation.language.services = normalizeLanguageServices(languageServices);
      options.languageRuntime.resetRequestTracking();
      options.languageRuntime.clearLanguageState();
      options.refreshSearchMatchCache(options.getState());
      options.languageRuntime.syncVisibleLanguageDecorations();
      options.lifecycleRuntime.emitPresentationUpdate("language.services");
      void options.languageRuntime.syncLanguage({
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
      options.lifecycleRuntime.emitPresentationUpdate("host.services");
      void options.languageRuntime.syncLanguage({
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
      options.workspaceRuntime.syncActiveFilePath(filePath);
      options.lifecycleRuntime.emitPresentationUpdate("presentation.file-path");
      void options.languageRuntime.syncLanguage({
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
      options.lifecycleRuntime.emitPresentationUpdate("presentation.theme-name");
    },
    handleKeyInput(input, runtimeOptions = {}) {
      return options.keyRuntime.handleKeyInput(input, runtimeOptions);
    },
    handleTextInput(text, runtimeOptions = {}) {
      return options.keyRuntime.handleTextInput(text, runtimeOptions);
    },
    repeatSearch(reverseAgainstDirection = false) {
      return options.keyRuntime.repeatSearch(reverseAgainstDirection);
    },
    beginFlashTarget() {
      options.keyRuntime.beginFlashTarget();
    },
    handleFlashKey(key) {
      return options.keyRuntime.handleFlashKey(key);
    },
    refreshLanguage(runtimeOptions = {}) {
      return options.languageRuntime.syncLanguage(runtimeOptions);
    },
    requestHoverAt(offset, runtimeOptions = {}) {
      if (
        presentation.ui.hover.active &&
        presentation.ui.hover.offset === offset &&
        presentation.ui.hover.pinned === !!runtimeOptions.pinned &&
        presentation.ui.hover.content.trim()
      ) {
        return Promise.resolve(true);
      }

      return options.languageRuntime.requestRawHover(offset).then((nextHover) => {
        if (!nextHover || !nextHover.content.trim()) {
          const hoverCleared = options.sessionRuntime.clearHoverState({ effectType: null });
          if (runtimeOptions.pinned) {
            options.sessionRuntime.setBottomMessage({ tone: "info", text: "No hover information" });
          } else if (hoverCleared) {
            options.lifecycleRuntime.emitPresentationUpdate("ui.hover.clear");
          }
          return false;
        }

        options.sessionRuntime.showHoverState(
          {
            active: true,
            pinned: !!runtimeOptions.pinned,
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
    showDiagnosticHover(diagnostic, runtimeOptions = {}) {
      return options.sessionRuntime.showHoverState(
        {
          active: true,
          pinned: !!runtimeOptions.pinned,
          offset: diagnostic.from,
          content: diagnostic.message,
          source: diagnostic.source,
          tone: options.sessionRuntime.hoverToneForDiagnostic(diagnostic.severity)
        },
        { clearBottomMessage: true, invalidateRequest: true }
      );
    },
    clearHover(runtimeOptions = {}) {
      return options.sessionRuntime.clearHoverState({ preservePinned: runtimeOptions.preservePinned });
    },
    clearFlash() {
      return options.sessionRuntime.clearFlashState();
    },
    requestCodeActions() {
      return options.languageRuntime.requestCodeActions();
    },
    applyCodeAction(action) {
      return options.languageRuntime.applyCodeAction(action);
    },
    formatDocument() {
      return options.languageRuntime.formatDocument();
    },
    saveDocument(targetPath = presentation.filePath) {
      return options.languageRuntime.saveDocument(targetPath).then((saved) => {
        if (saved) {
          options.workspaceRuntime.markActiveSaved(targetPath);
        }
        return saved;
      });
    }
  };
}
