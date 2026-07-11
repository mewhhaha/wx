import { createCharacterSelection, getSelectionOffsets, type CommandContext, type EditorState, type Transaction } from "@mewhhaha/wx-core";
import type {
  EditorCodeAction,
  EditorDiagnostic,
  EditorHover,
  EditorLanguageServiceInput,
  EditorLanguageServiceLifecycle,
  EditorLanguageServices,
  LanguageRegistry
} from "@mewhhaha/wx-language";

import { normalizeLanguageServices } from "./normalize";
import type { WorkspaceRuntime } from "./workspace";
import type {
  EditorController,
  EditorFileSearchResult,
  EditorWorkspaceSearchRequest,
  EditorWorkspaceSearchResult,
  EditorJumpEntry,
  EditorPresentationState,
  EditorSearchState,
  EditorUpdateListener
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
    alignViewport(position: "top" | "center" | "bottom", effectType?: string): boolean;
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
    requestSignatureHelp(): Promise<boolean>;
    moveSignatureHelp(delta: number): boolean;
    dismissSignatureHelp(): boolean;
    gotoTarget(kind: "definition" | "declaration" | "type-definition" | "implementation" | "references"): Promise<boolean>;
    renameSymbol(nextName: string): Promise<boolean>;
    openSymbols(kind: "document" | "workspace"): Promise<boolean>;
    formatDocument(): Promise<boolean>;
    saveDocument(targetPath?: string | null): Promise<boolean>;
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
    getRegisterKind(name?: string | null): EditorState["yankKind"];
    applyRegisterValue(
      name: string | null,
      value: string | null,
      effectType?: string,
      kind?: EditorState["yankKind"]
    ): void;
    selectRegister(name: string | null): void;
    getSelectedRegister(): string | null;
  };
  workspaceRuntime: WorkspaceRuntime;
  pickerRuntime: {
    openActionPicker(options: {
      title: string;
      items: readonly {
        label: string;
        detail?: string;
        run: () => Promise<void> | void;
      }[];
      selectedIndex?: number;
      query?: string;
      variant?: "bar" | "modal" | "combo";
      effectType?: string;
    }): boolean;
    closePicker(effectType?: string): void;
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
  getLanguageRegistry(): LanguageRegistry | null;
  setLanguageRegistry(registry: LanguageRegistry | null): void;
  getLanguageResolutionMode(): "auto" | "manual";
  setLanguageResolutionMode(mode: "auto" | "manual"): void;
  getActiveOffset(): number;
  createJumpEntry(): EditorJumpEntry;
}

function normalizePathLikeText(rawValue: string): {
  filePath: string;
  line: number | null;
  column: number | null;
} | null {
  const trimmed = rawValue.trim().replace(/^["'`(<\[{]+|[>"'`)\]}]+$/g, "");
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const match = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(trimmed);
  const candidate = (match?.[1] ?? trimmed).trim();
  if (!candidate || !/[./\\]|[A-Za-z0-9_-]/.test(candidate)) {
    return null;
  }

  return {
    filePath: candidate,
    line: match?.[2] ? Number(match[2]) : null,
    column: match?.[3] ? Number(match[3]) : null
  };
}

function normalizeRelativePath(path: string): string {
  const isAbsolute = path.startsWith("/");
  const segments = path.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  const next: string[] = [];

  for (const segment of segments) {
    if (segment === "..") {
      if (next.length > 0 && next[next.length - 1] !== "..") {
        next.pop();
      } else if (!isAbsolute) {
        next.push(segment);
      }
      continue;
    }

    next.push(segment);
  }

  const joined = next.join("/");
  if (isAbsolute) {
    return `/${joined}`;
  }

  return joined || ".";
}

function resolvePathLikeReference(filePath: string, selectedPath: string): string {
  if (selectedPath.startsWith("/")) {
    return normalizeRelativePath(selectedPath);
  }

  const baseSegments = filePath.split("/");
  baseSegments.pop();
  return normalizeRelativePath([...baseSegments, selectedPath].join("/"));
}

function extractSelectionTarget(state: EditorState, activeOffset: number): string | null {
  const selection = getSelectionOffsets(state);
  if (selection.to > selection.from) {
    return state.doc.slice(selection.from, selection.to);
  }

  const text = state.doc.text;
  const isPathChar = (char: string) => /[A-Za-z0-9._\-\/]/.test(char);
  let start = activeOffset;
  let end = activeOffset;

  while (start > 0 && isPathChar(text[start - 1] ?? "")) {
    start -= 1;
  }

  while (end < text.length && isPathChar(text[end] ?? "")) {
    end += 1;
  }

  return end > start ? text.slice(start, end) : null;
}

export function createControllerSurface(options: CreateControllerSurfaceOptions): EditorController {
  const presentation = options.getPresentation();
  let surface!: EditorController;
  let destroyed = false;

  const serviceLifecycles = (services: readonly EditorLanguageServices[]) =>
    [...new Set(services.map((entry) => entry.lifecycle).filter((entry): entry is EditorLanguageServiceLifecycle => !!entry))];

  const destroyOwnedServices = (
    services: readonly EditorLanguageServices[],
    owner: EditorLanguageServiceLifecycle["owner"]
  ) => {
    for (const lifecycle of serviceLifecycles(services)) {
      if (lifecycle.owner !== owner) continue;
      void Promise.resolve(lifecycle.destroy()).catch(() => undefined);
    }
  };

  const observeLanguageServiceReadiness = (
    services: readonly EditorLanguageServices[],
    generation: number
  ) => {
    const lifecycles = serviceLifecycles(services);
    if (lifecycles.length === 0) {
      presentation.language.serviceStatus = {
        state: services.length > 0 ? "ready" : "disabled",
        message: null,
        retryable: false,
        generation
      };
      return;
    }

    const readiness = lifecycles.map((lifecycle) => {
      if (lifecycle.state === "failed" || lifecycle.state === "destroyed") {
        return Promise.reject(lifecycle.error ?? new Error(`Language service is ${lifecycle.state}`));
      }
      return lifecycle.whenReady?.() ?? Promise.resolve();
    });

    void Promise.all(readiness).then(
      () => {
        if (destroyed || generation !== presentation.language.serviceStatus.generation) return;
        presentation.language.serviceStatus = {
          state: "ready",
          message: null,
          retryable: false,
          generation
        };
        options.lifecycleRuntime.emitPresentationUpdate("language.services.ready");
      },
      (error: unknown) => {
        if (destroyed || generation !== presentation.language.serviceStatus.generation) return;
        const message = error instanceof Error ? error.message : String(error);
        presentation.language.serviceStatus = {
          state: "failed",
          message,
          retryable: lifecycles.some((lifecycle) => !!lifecycle.recreate),
          generation
        };
        options.sessionRuntime.setBottomMessage({
          tone: "warning",
          text: `Language services unavailable: ${message}${presentation.language.serviceStatus.retryable ? " (retry available)" : ""}`
        });
      }
    );
  };

  const applyLanguageServices = (
    languageServices: EditorLanguageServiceInput | readonly EditorLanguageServices[] | null,
    effectType: string | null,
    syncLanguageOptions: {
      forceDocumentSync?: boolean;
      refreshHighlights?: boolean;
      refreshDiagnostics?: boolean;
      refreshLineChanges?: boolean;
    } = {
      forceDocumentSync: true,
      refreshHighlights: true,
      refreshDiagnostics: true,
      refreshLineChanges: true
    }
  ) => {
    if (destroyed) return;
    const previousServices = presentation.language.services;
    const nextServices = normalizeLanguageServices(languageServices);
    presentation.language.services = nextServices;
    const generation = presentation.language.serviceStatus.generation + 1;
    presentation.language.serviceStatus = {
      state: nextServices.length > 0 ? "starting" : "disabled",
      message: null,
      retryable: false,
      generation
    };
    const retained = new Set(serviceLifecycles(nextServices));
    for (const lifecycle of serviceLifecycles(previousServices)) {
      if (!retained.has(lifecycle) && lifecycle.owner === "controller") {
        void Promise.resolve(lifecycle.destroy()).catch(() => undefined);
      }
    }
    observeLanguageServiceReadiness(nextServices, generation);
    options.languageRuntime.resetRequestTracking();
    options.languageRuntime.clearLanguageState();
    options.refreshSearchMatchCache(options.getState());
    options.languageRuntime.syncVisibleLanguageDecorations();
    options.workspaceRuntime.syncFromActiveState(options.getState(), presentation, { docChanged: false });
    if (effectType) {
      options.lifecycleRuntime.emitPresentationUpdate(effectType);
    }
    void options.languageRuntime.syncLanguage(syncLanguageOptions);
  };
  const resolveLanguageServicesForFilePath = (filePath: string | null): EditorLanguageServices[] => {
    if (!filePath) {
      return [];
    }

    return normalizeLanguageServices(options.getLanguageRegistry()?.resolveForFilePath(filePath)?.services ?? null);
  };
  const applyResolvedLanguageServices = (effectType: string | null) => {
    applyLanguageServices(resolveLanguageServicesForFilePath(presentation.filePath), effectType);
  };
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
      if (options.getLanguageResolutionMode() === "auto") {
        presentation.language.services = resolveLanguageServicesForFilePath(presentation.filePath);
        options.workspaceRuntime.syncFromActiveState(options.getState(), presentation, { docChanged: false });
      }
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
  const openSelectionInPane = async (axis: "horizontal" | "vertical") => {
    if (!presentation.filePath) {
      options.sessionRuntime.setBottomMessage({ tone: "warning", text: "Scratch buffer has no folder context" });
      return false;
    }

    const selectedText = extractSelectionTarget(options.getState(), options.getActiveOffset());
    const target = selectedText ? normalizePathLikeText(selectedText) : null;
    if (!target) {
      options.sessionRuntime.setBottomMessage({ tone: "warning", text: "No file path in selection" });
      return false;
    }

    const resolvedPath = resolvePathLikeReference(presentation.filePath, target.filePath);
    if (!options.workspaceRuntime.splitActivePane(axis)) {
      return false;
    }

    loadActivePaneState(`pane.split.${axis}`, { clearHistory: false, resetLanguage: false });
    const opened = await surface.openBuffer(resolvedPath);
    if (!opened) {
      surface.closePane();
      return false;
    }

    if (target.line !== null) {
      const nextState = options.getState();
      const lineIndex = Math.max(0, target.line - 1);
      const column = Math.max(0, (target.column ?? 1) - 1);
      const offset = nextState.doc.offsetAt({ line: lineIndex, column });
      options.lifecycleRuntime.dispatch({
        selection: createCharacterSelection(nextState.doc, offset, column)
      });
    }

    return true;
  };
  const readTextPayload = (payload: { text: string } | string) => (typeof payload === "string" ? payload : payload.text);
  const syncActiveFileStatusPresentation = (effectType?: string) => {
    presentation.fileStatus = {
      dirty: options.workspaceRuntime.getActiveFileStatus().dirty,
      externalChanged: options.workspaceRuntime.getActiveFileStatus().externalChanged
    };
    options.lifecycleRuntime.emitPresentationUpdate(effectType);
  };
  const openReloadConflictPicker = () => {
    options.pickerRuntime.openActionPicker({
      title: "file changed on disk",
      variant: "bar",
      items: [
        {
          label: "Reload file",
          detail: "discard local edits",
          run: async () => {
            options.pickerRuntime.closePicker("ui.picker.close");
            await surface.reloadDocument();
          }
        },
        {
          label: "Keep editing",
          detail: "leave buffer unchanged",
          run: () => {
            options.pickerRuntime.closePicker("ui.picker.close");
          }
        }
      ],
      effectType: "file.conflict"
    });
  };

  surface = {
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
      if (destroyed) {
        return () => {};
      }
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
    pushJump(entry) {
      return options.registersJumpsRuntime.pushJumpEntry(entry ?? options.createJumpEntry());
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
    getRegisterKind(name = null) {
      return options.registersJumpsRuntime.getRegisterKind(name);
    },
    setRegister(name, value, kind) {
      options.registersJumpsRuntime.applyRegisterValue(name, value, "register.update", kind);
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
    openEmptyFileBuffer(filePath) {
      const existing = options.workspaceRuntime.findBufferByFilePath(filePath);
      if (existing) {
        return switchBuffer(existing.id);
      }

      const entry = options.workspaceRuntime.storeBufferState(
        filePath,
        options.workspaceRuntime.createStateForText("", options.getState()),
        true
      );
      if (!options.workspaceRuntime.bindActivePaneToBuffer(entry.id)) {
        return false;
      }

      loadActivePaneState("buffer.add-file", { clearHistory: true, resetLanguage: true });
      return true;
    },
    newScratchBuffer() {
      const scratch = options.workspaceRuntime.bindActivePaneToNewScratch();
      if (!scratch) {
        return false;
      }

      loadActivePaneState("buffer.new-scratch", { clearHistory: true, resetLanguage: true });
      return true;
    },
    newScratchSplit(axis) {
      const scratch = options.workspaceRuntime.splitActivePaneWithScratch(axis);
      if (!scratch) {
        return false;
      }

      loadActivePaneState(`pane.split-scratch.${axis}`, { clearHistory: true, resetLanguage: true });
      return true;
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
    swapPane(direction) {
      if (!options.workspaceRuntime.swapActivePane(direction)) {
        return false;
      }

      loadActivePaneState("pane.swap", { clearHistory: false, resetLanguage: false });
      return true;
    },
    openSelectionInPane(axis) {
      return openSelectionInPane(axis);
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
    async searchFiles(query = "") {
      const searchFiles = presentation.language.host?.searchFiles;
      if (!searchFiles) {
        return [];
      }

      try {
        return await searchFiles({
          filePath: presentation.filePath ?? "",
          query
        });
      } catch {
        return [] as EditorFileSearchResult[];
      }
    },
    async searchWorkspace(request: Omit<EditorWorkspaceSearchRequest, "filePath">): Promise<readonly EditorWorkspaceSearchResult[]> {
      const search = presentation.language.host?.searchWorkspace;
      if (!search) return [];
      try { return await search({ ...request, filePath: presentation.filePath ?? "" }); }
      catch (error) { if (request.signal?.aborted) return []; options.sessionRuntime.setBottomMessage({ tone: "warning", text: error instanceof Error ? error.message : "Workspace search failed" }); return []; }
    },
    async listFolders() {
      const listFolders = presentation.language.host?.listFolders;
      if (!listFolders) {
        return [{ folderPath: "." }];
      }

      try {
        const folders = await listFolders({
          filePath: presentation.filePath ?? ""
        });
        return folders.length > 0 ? folders : [{ folderPath: "." }];
      } catch {
        return [{ folderPath: "." }];
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
    requestSignatureHelp() { return options.languageRuntime.requestSignatureHelp(); },
    moveSignatureHelp(delta) { return options.languageRuntime.moveSignatureHelp(delta); },
    dismissSignatureHelp() { return options.languageRuntime.dismissSignatureHelp(); },
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
      return options.viewportRuntime.alignViewport(position, "viewport.align");
    },
    revealSelection() {
      options.viewportRuntime.revealSelection();
    },
    setLanguageServices(languageServices: EditorLanguageServiceInput | null) {
      options.setLanguageResolutionMode("manual");
      applyLanguageServices(languageServices, "language.services");
    },
    setLanguageRegistry(registry) {
      if (options.getLanguageRegistry() === registry) {
        return;
      }

      options.setLanguageRegistry(registry);
      if (options.getLanguageResolutionMode() === "auto") {
        applyResolvedLanguageServices("language.registry");
      }
    },
    resetLanguageServices() {
      options.setLanguageResolutionMode("auto");
      applyResolvedLanguageServices("language.services.reset");
    },
    async retryLanguageServices() {
      if (destroyed || presentation.language.serviceStatus.state !== "failed") {
        return false;
      }
      const previousServices = [...presentation.language.services];
      let recreated = false;
      const nextServices: EditorLanguageServices[] = [];
      try {
        for (const services of previousServices) {
          if (services.lifecycle?.recreate) {
            nextServices.push(await services.lifecycle.recreate());
            recreated = true;
          } else {
            nextServices.push(services);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        presentation.language.serviceStatus = {
          ...presentation.language.serviceStatus,
          message,
          retryable: true
        };
        options.sessionRuntime.setBottomMessage({ tone: "warning", text: `Language service retry failed: ${message}` });
        return false;
      }
      if (!recreated) {
        return false;
      }
      for (const lifecycle of serviceLifecycles(previousServices)) {
        if (lifecycle.owner !== "controller") {
          void Promise.resolve(lifecycle.destroy()).catch(() => undefined);
        }
      }
      applyLanguageServices(nextServices, "language.services.retry");
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      options.languageRuntime.resetRequestTracking();
      options.languageRuntime.clearLanguageState();
      destroyOwnedServices(presentation.language.services, "controller");
      presentation.language.services = [];
      presentation.language.host = null;
      presentation.language.serviceStatus = {
        state: "destroyed",
        message: null,
        retryable: false,
        generation: presentation.language.serviceStatus.generation + 1
      };
      options.history?.clear?.();
      options.listeners.clear();
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
      presentation.bufferTitle = filePath ?? presentation.bufferTitle;
      presentation.fileStatus = {
        dirty: false,
        externalChanged: false
      };
      options.workspaceRuntime.syncActiveFilePath(filePath);
      if (options.getLanguageResolutionMode() === "auto") {
        applyResolvedLanguageServices("presentation.file-path");
        return;
      }

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
    async refreshFileStatus() {
      const filePath = presentation.filePath;
      const readFile = presentation.language.host?.readFile;
      if (!filePath || !readFile) {
        return false;
      }

      const persistedText = options.workspaceRuntime.getActiveFileStatus().persistedText;
      if (persistedText === null) {
        return false;
      }

      try {
        const diskText = readTextPayload(await readFile({ filePath }));
        const externalChanged = diskText !== persistedText;
        options.workspaceRuntime.setActiveExternalChanged(externalChanged);
        presentation.fileStatus = {
          dirty: options.workspaceRuntime.getActiveFileStatus().dirty,
          externalChanged
        };
        options.lifecycleRuntime.emitPresentationUpdate("file.status");
        return externalChanged;
      } catch {
        return false;
      }
    },
    async reloadDocument() {
      const filePath = presentation.filePath;
      const readFile = presentation.language.host?.readFile;
      if (!filePath || !readFile) {
        options.sessionRuntime.setBottomMessage({ tone: "warning", text: "No file reader available" });
        return false;
      }

      let text: string;
      try {
        text = readTextPayload(await readFile({ filePath }));
      } catch {
        options.sessionRuntime.setBottomMessage({ tone: "error", text: `Could not reload ${filePath}` });
        return false;
      }

      const prevState = options.getState();
      const nextState = {
        ...options.workspaceRuntime.createStateForText(text, prevState),
        revision: prevState.revision + 1
      };
      options.setState(nextState);
      options.history?.clear?.();
      options.refreshSearchMatchCache(options.getState());
      options.languageRuntime.resetRequestTracking();
      options.languageRuntime.clearLanguageState();
      options.viewportModelRuntime.rebuildViewportModel();
      options.languageRuntime.syncVisibleLanguageDecorations();
      options.lifecycleRuntime.notify(prevState, options.getState(), { effects: [{ type: "file.reload" }] }, { recordHistory: false });
      options.workspaceRuntime.markActiveReloaded(text);
      syncActiveFileStatusPresentation("file.reload");
      void options.languageRuntime.syncLanguage({
        forceDocumentSync: true,
        refreshHighlights: true,
        refreshDiagnostics: true,
        refreshLineChanges: true
      });
      options.sessionRuntime.setBottomMessage({ tone: "info", text: `Reloaded ${filePath}` });
      return true;
    },
    async saveDocument(targetPath = presentation.filePath) {
      const nextPath = targetPath ?? presentation.filePath;
      if (!nextPath) {
        return false;
      }
      if (nextPath === presentation.filePath && await surface.refreshFileStatus()) {
        options.sessionRuntime.setBottomMessage({
          tone: "error",
          text: "File changed on disk. Reload before writing."
        });
        openReloadConflictPicker();
        return false;
      }

      const expectedText =
        nextPath === presentation.filePath && presentation.language.host?.readFile
          ? options.workspaceRuntime.getActiveFileStatus().persistedText
          : undefined;
      const writeFile = presentation.language.host?.writeFile;
      const savedText = options.getState().doc.text;
      if (!writeFile) {
        return false;
      }

      try {
        await writeFile({
          filePath: nextPath,
          text: savedText,
          expectedText
        });
      } catch {
        await surface.refreshFileStatus();
        return false;
      }

      presentation.filePath = nextPath;
      presentation.bufferTitle = nextPath;
      options.workspaceRuntime.markActiveSaved(nextPath, savedText);
      syncActiveFileStatusPresentation("presentation.file-path");
      void options.languageRuntime.syncLanguage({
        refreshHighlights: false,
        refreshDiagnostics: false,
        refreshLineChanges: true
      });
      queueMicrotask(() => {
        void Promise.resolve(
          presentation.language.host?.didWriteFile?.({
            filePath: nextPath,
            text: savedText
          })
        ).catch(() => undefined);
      });
      return true;
    }
  };

  return surface;
}
