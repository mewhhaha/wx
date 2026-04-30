import { getCursorOffset, type EditorState } from "@mewhhaha/wx-core";
import type { EditorCodeAction } from "@mewhhaha/wx-language";
import type {
  EditorBufferState,
  EditorBottomMessageState,
  EditorController,
  EditorFileSearchResult,
  EditorJumpEntry,
  EditorPickerState,
  EditorPresentationState
} from "./types";

export interface PickerActionItem {
  kind?: "file";
  label: string;
  detail?: string;
  filePath?: string;
  run: () => Promise<void> | void;
  preview?: () => Promise<{ title: string; content: string } | null> | { title: string; content: string } | null;
}

export interface PickerSearchSource {
  title: string;
  query?: string;
  variant?: "bar" | "modal" | "combo";
  inputMode?: "search" | "filename";
  load(query: string): Promise<readonly PickerActionItem[]>;
}

interface PickerRuntimeContext {
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getController(): EditorController;
  getBuffers(): readonly EditorBufferState[];
  setBottomMessage(message: EditorBottomMessageState | null): void;
  emitPresentationUpdate(effectType?: string): void;
  jumpToSelection(from: number, to: number): void;
  restoreJump(entry: EditorJumpEntry | null): boolean;
}

export interface PickerRuntime {
  setPickerState(
    next: Omit<EditorPickerState, "items"> & { items: readonly PickerActionItem[] },
    effectType?: string
  ): void;
  closePicker(effectType?: string): void;
  movePicker(delta: number): boolean;
  acceptPicker(index?: number): Promise<boolean>;
  openDiagnosticsPicker(): boolean;
  openJumpListPicker(): boolean;
  openBuffersPicker(): boolean;
  openPanesPicker(): boolean;
  openActionPicker(options: {
    title: string;
    items: readonly PickerActionItem[];
    selectedIndex?: number;
    query?: string;
    variant?: "bar" | "modal" | "combo";
    effectType?: string;
  }): boolean;
  openSearchPicker(source: PickerSearchSource): Promise<boolean>;
  openFileSearchPicker(): Promise<boolean>;
  openAddFilePicker(initialName?: string): Promise<boolean>;
  updatePickerQuery(query: string): Promise<boolean>;
  loadCodeActions(): Promise<boolean>;
}

function validateRelativeFilename(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return null;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  return segments.join("/");
}

function joinFolderAndFilename(folderPath: string, fileName: string): string {
  return folderPath === "." ? fileName : `${folderPath.replace(/\/+$/g, "")}/${fileName}`;
}

export function createPickerRuntime(context: PickerRuntimeContext): PickerRuntime {
  let pickerActions: readonly PickerActionItem[] = [];
  let previewRequestId = 0;
  let searchRequestId = 0;
  let pickerSessionId = 0;
  let searchSource: (PickerSearchSource & {
    query: string;
    variant: "bar" | "modal" | "combo";
    inputMode: "search" | "filename";
  }) | null = null;

  const invalidateAsyncPickerRequests = () => {
    previewRequestId += 1;
    searchRequestId += 1;
    pickerSessionId += 1;
  };

  const setPickerState: PickerRuntime["setPickerState"] = (
    next,
    effectType = "ui.picker"
  ) => {
    const presentation = context.getPresentation();
    const previous = presentation.ui.picker;
    const itemsChanged =
      previous.items.length !== next.items.length ||
      previous.items.some(
        (item, index) =>
          item.kind !== next.items[index]?.kind ||
          item.label !== next.items[index]?.label ||
          item.detail !== next.items[index]?.detail ||
          item.filePath !== next.items[index]?.filePath
      );

    if (
      !itemsChanged &&
      previous.active === next.active &&
      previous.loading === next.loading &&
      previous.title === next.title &&
      previous.selectedIndex === next.selectedIndex &&
      previous.error === next.error &&
      previous.query === next.query &&
      previous.variant === next.variant &&
      (previous.inputMode ?? "search") === (next.inputMode ?? "search") &&
      previous.previewTitle === next.previewTitle &&
      previous.previewContent === next.previewContent &&
      previous.previewLoading === next.previewLoading
    ) {
      return;
    }

    pickerActions = next.items;
    presentation.ui.picker = {
      active: next.active,
      loading: next.loading,
      title: next.title,
      items: next.items.map((item, index) => ({
        kind: item.kind,
        label: item.label,
        detail: item.detail,
        filePath: item.filePath,
        selected: index === next.selectedIndex
      })),
      selectedIndex: next.selectedIndex,
      error: next.error,
      query: next.query,
      variant: next.variant,
      inputMode: next.inputMode ?? "search",
      previewTitle: next.previewTitle,
      previewContent: next.previewContent,
      previewLoading: next.previewLoading
    };
    context.emitPresentationUpdate(effectType);
  };

  const syncSelectedPreview = async () => {
    const presentation = context.getPresentation();
    const item = pickerActions[presentation.ui.picker.selectedIndex];

    if (!presentation.ui.picker.active || presentation.ui.picker.variant !== "modal") {
      return;
    }

    if (!item?.preview) {
      setPickerState(
        {
          active: true,
          loading: presentation.ui.picker.loading,
          title: presentation.ui.picker.title,
          items: pickerActions,
          selectedIndex: presentation.ui.picker.selectedIndex,
          error: presentation.ui.picker.error,
          query: presentation.ui.picker.query,
          variant: presentation.ui.picker.variant,
          inputMode: presentation.ui.picker.inputMode ?? "search",
          previewTitle: "",
          previewContent: "",
          previewLoading: false
        },
        "ui.picker.preview"
      );
      return;
    }

    const requestId = ++previewRequestId;
    const sessionId = pickerSessionId;
    const expectedQuery = presentation.ui.picker.query;
    const expectedTitle = presentation.ui.picker.title;
    const expectedIndex = presentation.ui.picker.selectedIndex;

    let preview: { title: string; content: string } | null;
    try {
      preview = await item.preview();
    } catch {
      preview = { title: item.label, content: "Preview failed" };
    }

    if (requestId !== previewRequestId || sessionId !== pickerSessionId) {
      return;
    }

    const nextPresentation = context.getPresentation();
    if (
      !nextPresentation.ui.picker.active ||
      nextPresentation.ui.picker.variant !== "modal" ||
      nextPresentation.ui.picker.query !== expectedQuery ||
      nextPresentation.ui.picker.title !== expectedTitle ||
      nextPresentation.ui.picker.selectedIndex !== expectedIndex
    ) {
      return;
    }

    setPickerState(
      {
        active: true,
        loading: nextPresentation.ui.picker.loading,
        title: nextPresentation.ui.picker.title,
        items: pickerActions,
        selectedIndex: nextPresentation.ui.picker.selectedIndex,
        error: nextPresentation.ui.picker.error,
        query: nextPresentation.ui.picker.query,
        variant: nextPresentation.ui.picker.variant,
        inputMode: nextPresentation.ui.picker.inputMode ?? "search",
        previewTitle: preview?.title ?? "",
        previewContent: preview?.content ?? "",
        previewLoading: false
      },
      "ui.picker.preview"
    );
  };

  const closePicker: PickerRuntime["closePicker"] = (effectType = "ui.picker.close") => {
    invalidateAsyncPickerRequests();
    setPickerState(
      {
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
      effectType
    );
    searchSource = null;
  };

  const movePicker: PickerRuntime["movePicker"] = (delta) => {
    const presentation = context.getPresentation();

    if (presentation.ui.picker.items.length === 0) {
      return false;
    }

    const nextIndex = Math.max(
      0,
      Math.min(presentation.ui.picker.items.length - 1, presentation.ui.picker.selectedIndex + delta)
    );

    if (nextIndex === presentation.ui.picker.selectedIndex) {
      return false;
    }

    setPickerState(
      {
        active: true,
        loading: presentation.ui.picker.loading,
        title: presentation.ui.picker.title,
        items: pickerActions,
        selectedIndex: nextIndex,
        error: presentation.ui.picker.error,
        query: presentation.ui.picker.query,
        variant: presentation.ui.picker.variant,
        inputMode: presentation.ui.picker.inputMode ?? "search",
        previewTitle: presentation.ui.picker.previewTitle,
        previewContent: presentation.ui.picker.previewContent,
        previewLoading: presentation.ui.picker.previewLoading
      },
      "ui.picker"
    );
    void syncSelectedPreview();
    return true;
  };

  const acceptPicker: PickerRuntime["acceptPicker"] = async (index = context.getPresentation().ui.picker.selectedIndex) => {
    const item = pickerActions[index];
    if (!item) {
      closePicker("ui.picker.close");
      return false;
    }

    await item.run();
    return true;
  };

  const openDiagnosticsPicker = () => {
    invalidateAsyncPickerRequests();
    searchSource = null;
    const state = context.getState();
    const presentation = context.getPresentation();
    const items = presentation.language.diagnostics.map((entry) => {
      const position = state.doc.positionAt(entry.from);
      const lineText = state.doc.lineAt(position.line).text.trim();
      return {
        label: `${position.line + 1}:${position.column + 1} ${entry.message}`,
        detail: lineText,
        run: () => {
          context.jumpToSelection(entry.from, entry.to);
          closePicker("ui.picker.close");
        }
      };
    });

    if (items.length === 0) {
      context.setBottomMessage({ tone: "warning", text: "No diagnostics" });
      return false;
    }

    setPickerState(
      {
        active: true,
        loading: false,
        title: "diagnostics",
        items,
        selectedIndex: 0,
        error: null,
        query: "",
        variant: "bar",
        previewTitle: "",
        previewContent: "",
        previewLoading: false
      },
      "ui.picker"
    );
    return true;
  };

  const openJumpListPicker = () => {
    invalidateAsyncPickerRequests();
    searchSource = null;
    const state = context.getState();
    const controller = context.getController();
    const items = controller.getJumpList().map((entry, index) => {
      const offset = getCursorOffset(entry.selection);
      const position = state.doc.positionAt(offset);
      const lineText = state.doc.lineAt(position.line).text.trim();
      return {
        label: `${index + 1}:${position.line + 1}:${position.column + 1}`,
        detail: lineText,
        run: () => {
          context.restoreJump(entry);
          closePicker("ui.picker.close");
        }
      };
    });

    if (items.length === 0) {
      context.setBottomMessage({ tone: "warning", text: "Jump list is empty" });
      return false;
    }

    setPickerState(
      {
        active: true,
        loading: false,
        title: "jumps",
        items,
        selectedIndex: Math.max(0, items.length - 1),
        error: null,
        query: "",
        variant: "bar",
        previewTitle: "",
        previewContent: "",
        previewLoading: false
      },
      "ui.picker"
    );
    return true;
  };

  const openBuffersPicker = () => {
    invalidateAsyncPickerRequests();
    const buildItems = async (query: string) => {
      const normalizedQuery = query.trim().toLowerCase();
      return context
        .getBuffers()
        .filter((entry) => {
          if (!normalizedQuery) {
            return true;
          }

          return `${entry.displayName}\n${entry.filePath ?? ""}`.toLowerCase().includes(normalizedQuery);
        })
        .map((entry) => ({
          label: entry.displayName,
          detail:
            entry.filePath && entry.filePath !== entry.displayName
              ? `${entry.dirty ? "modified" : "saved"} • ${entry.filePath}`
              : entry.dirty
                ? "modified"
                : "saved",
          run: () => {
            context.getController().switchBuffer(entry.id);
            closePicker("ui.picker.close");
          }
        }));
    };

    searchSource = {
      title: "buffers",
      query: "",
      variant: "bar",
      inputMode: "search",
      load: buildItems
    };

    void updatePickerQuery("");
    return true;
  };

  const openPanesPicker = () => {
    invalidateAsyncPickerRequests();
    const workspace = context.getController().getWorkspacePresentationState();
    const items = workspace.panes.map((pane) => ({
      label: pane.bufferTitle,
      detail: pane.active ? "active pane" : pane.bufferId,
      preview: () => ({
        title: pane.bufferTitle,
        content: pane.state.doc.text
      }),
      run: () => {
        context.getController().setActivePane(pane.paneId);
        closePicker("ui.picker.close");
      }
    }));

    if (items.length === 0) {
      context.setBottomMessage({ tone: "warning", text: "No panes" });
      return false;
    }

    return openActionPicker({
      title: "panes",
      items,
      selectedIndex: Math.max(
        0,
        workspace.panes.findIndex((pane) => pane.active)
      ),
      variant: "modal"
    });
  };

  const openActionPicker: PickerRuntime["openActionPicker"] = (options) => {
    invalidateAsyncPickerRequests();
    searchSource = null;

    if (options.items.length === 0) {
      context.setBottomMessage({ tone: "warning", text: `No ${options.title}` });
      return false;
    }

    setPickerState(
      {
        active: true,
        loading: false,
        title: options.title,
        items: options.items,
        selectedIndex: Math.max(0, Math.min(options.items.length - 1, options.selectedIndex ?? 0)),
        error: null,
        query: options.query ?? "",
        variant: options.variant ?? "modal",
        previewTitle: "",
        previewContent: "",
        previewLoading: false
      },
      options.effectType ?? "ui.picker"
    );
    void syncSelectedPreview();
    return true;
  };

  const openSearchPicker: PickerRuntime["openSearchPicker"] = async (source) => {
    invalidateAsyncPickerRequests();
    searchSource = {
      title: source.title,
      query: source.query ?? "",
      variant: source.variant ?? "modal",
      inputMode: source.inputMode ?? "search",
      load: source.load
    };

    return updatePickerQuery(searchSource.query);
  };

  const openFileSearchPicker = async () => {
    return openSearchPicker({
      title: "repo",
      variant: "combo",
      load: async (query) => {
        const files = await context.getController().searchFiles(query);
        return files.map((entry) => ({
          kind: "file" as const,
          label: entry.filePath,
          detail: entry.detail,
          filePath: entry.filePath,
          preview: async () => {
            const readFile = context.getPresentation().language.host?.readFile;
            if (!readFile) {
              return null;
            }

            const payload = await readFile({ filePath: entry.filePath });
            const text = typeof payload === "string" ? payload : payload.text;
            return {
              title: entry.filePath,
              content: text
            };
          },
          run: async () => {
            const opened = await context.getController().openBuffer(entry.filePath);
            if (opened) {
              closePicker("ui.picker.close");
            }
          }
        }));
      }
    });
  };

  const openAddFilePicker = async (initialName = "") => {
    return openSearchPicker({
      title: "add",
      query: initialName,
      variant: "combo",
      inputMode: "filename",
      load: async (query) => {
        const folders = await context.getController().listFolders();
        return folders.map((entry) => ({
          label: entry.folderPath,
          detail: entry.detail,
          run: () => {
            const fileName = validateRelativeFilename(query);
            if (!fileName) {
              context.setBottomMessage({ tone: "warning", text: "File name must be a relative path without .." });
              return;
            }

            const opened = context.getController().openEmptyFileBuffer(joinFolderAndFilename(entry.folderPath, fileName));
            if (opened) {
              closePicker("ui.picker.close");
            }
          }
        }));
      }
    });
  };

  const updatePickerQuery = async (query: string) => {
    if (!searchSource) {
      return false;
    }

    const requestId = ++searchRequestId;
    const sessionId = pickerSessionId;
    previewRequestId += 1;
    searchSource.query = query;
    const presentation = context.getPresentation();
    const preserveVisiblePickerState =
      presentation.ui.picker.active &&
      (presentation.ui.picker.variant === "modal" || presentation.ui.picker.variant === "combo");
    const currentSource = searchSource;
    setPickerState(
      {
        active: true,
        loading: true,
        title: searchSource.title,
        items: preserveVisiblePickerState ? pickerActions : [],
        selectedIndex: preserveVisiblePickerState
          ? Math.max(0, Math.min(pickerActions.length - 1, presentation.ui.picker.selectedIndex))
          : 0,
        error: null,
        query,
        variant: searchSource.variant,
        inputMode: searchSource.inputMode,
        previewTitle: preserveVisiblePickerState ? presentation.ui.picker.previewTitle : "",
        previewContent: preserveVisiblePickerState ? presentation.ui.picker.previewContent : "",
        previewLoading: false
      },
      "ui.picker"
    );

    let items: readonly PickerActionItem[];
    try {
      items = await searchSource.load(query);
    } catch {
      if (requestId !== searchRequestId || sessionId !== pickerSessionId || searchSource !== currentSource) {
        return false;
      }
      closePicker("ui.picker.close");
      context.setBottomMessage({ tone: "error", text: "Search failed" });
      return false;
    }

    if (
      requestId !== searchRequestId ||
      sessionId !== pickerSessionId ||
      searchSource !== currentSource ||
      currentSource.query !== query
    ) {
      return false;
    }

    setPickerState(
      {
        active: true,
        loading: false,
        title: searchSource.title,
        items,
        selectedIndex: 0,
        error: items.length === 0 ? "No matches" : null,
        query,
        variant: searchSource.variant,
        inputMode: searchSource.inputMode,
        previewTitle: "",
        previewContent: "",
        previewLoading: false
      },
      "ui.picker"
    );
    void syncSelectedPreview();
    return true;
  };

  const loadCodeActions = async (): Promise<boolean> => {
    const controller = context.getController();
    invalidateAsyncPickerRequests();
    searchSource = null;
    const sessionId = pickerSessionId;
    setPickerState(
      {
        active: true,
        loading: true,
        title: "code actions",
        items: [],
        selectedIndex: 0,
        error: null,
        query: "",
        variant: "bar",
        previewTitle: "",
        previewContent: "",
        previewLoading: false
      },
      "ui.picker"
    );

    let actions: readonly EditorCodeAction[];
    try {
      actions = await controller.requestCodeActions();
    } catch {
      if (sessionId !== pickerSessionId) {
        return false;
      }
      closePicker("ui.picker.close");
      context.setBottomMessage({ tone: "error", text: "Code actions request failed" });
      return false;
    }

    const presentation = context.getPresentation();
    if (
      sessionId !== pickerSessionId ||
      !presentation.ui.picker.active ||
      presentation.ui.picker.title !== "code actions" ||
      presentation.ui.picker.variant !== "bar"
    ) {
      return false;
    }

    const items = actions.map((action) => ({
      label: action.title,
      run: async () => {
        const applied = await controller.applyCodeAction(action);
        if (!applied) {
          context.setBottomMessage({ tone: "warning", text: `No edits for ${action.title}` });
          return;
        }

        closePicker("ui.picker.close");
        context.setBottomMessage({ tone: "info", text: `Applied ${action.title}` });
      }
    }));

    setPickerState(
      {
        active: true,
        loading: false,
        title: "code actions",
        items,
        selectedIndex: 0,
        error: items.length === 0 ? "No code actions" : null,
        query: "",
        variant: "bar",
        previewTitle: "",
        previewContent: "",
        previewLoading: false
      },
      "ui.picker"
    );

    if (items.length === 0) {
      closePicker("ui.picker.close");
      context.setBottomMessage({ tone: "warning", text: "No code actions available" });
    }

    return items.length > 0;
  };

  return {
    setPickerState,
    closePicker,
    movePicker,
    acceptPicker,
    openDiagnosticsPicker,
    openJumpListPicker,
    openBuffersPicker,
    openPanesPicker,
    openActionPicker,
    openSearchPicker,
    openFileSearchPicker,
    openAddFilePicker,
    updatePickerQuery,
    loadCodeActions
  };
}
