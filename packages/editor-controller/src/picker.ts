import { getCursorOffset, type EditorState } from "@wx/editor-core";
import type { EditorCodeAction } from "@wx/editor-language";
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
  label: string;
  detail?: string;
  run: () => Promise<void> | void;
  preview?: () => Promise<{ title: string; content: string } | null> | { title: string; content: string } | null;
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
  openFileSearchPicker(scope: "repo" | "folder"): Promise<boolean>;
  updatePickerQuery(query: string): Promise<boolean>;
  loadCodeActions(): Promise<boolean>;
}

export function createPickerRuntime(context: PickerRuntimeContext): PickerRuntime {
  let pickerActions: readonly PickerActionItem[] = [];
  let previewRequestId = 0;
  let searchRequestId = 0;
  let pickerSessionId = 0;
  let searchSource:
    | null
    | {
        title: string;
        query: string;
        variant: "bar" | "modal";
        load(query: string): Promise<readonly PickerActionItem[]>;
      } = null;

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
        (item, index) => item.label !== next.items[index]?.label || item.detail !== next.items[index]?.detail
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
        label: item.label,
        detail: item.detail,
        selected: index === next.selectedIndex
      })),
      selectedIndex: next.selectedIndex,
      error: next.error,
      query: next.query,
      variant: next.variant,
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
        .filter((entry) => !normalizedQuery || entry.filePath.toLowerCase().includes(normalizedQuery))
        .map((entry) => ({
          label: entry.filePath,
          detail: entry.dirty ? "modified" : "saved",
          run: () => {
            context.getController().switchBuffer(entry.id);
            closePicker("ui.picker.close");
          }
        }));
    };

    searchSource = {
      title: "buffers",
      query: "",
      variant: "modal",
      load: buildItems
    };

    void updatePickerQuery("");
    return true;
  };

  const openFileSearchPicker = async (scope: "repo" | "folder") => {
    invalidateAsyncPickerRequests();
    searchSource = {
      title: scope === "repo" ? "repo" : "folder",
      query: "",
      variant: "modal",
      load: async (query) => {
        const files = await context.getController().searchFiles(scope, query);
        return files.map((entry) => ({
          label: entry.filePath,
          detail: entry.detail,
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
    };

    return updatePickerQuery("");
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
    const preserveVisibleModalState = presentation.ui.picker.active && presentation.ui.picker.variant === "modal";
    const currentSource = searchSource;
    setPickerState(
      {
        active: true,
        loading: true,
        title: searchSource.title,
        items: preserveVisibleModalState ? pickerActions : [],
        selectedIndex: preserveVisibleModalState
          ? Math.max(0, Math.min(pickerActions.length - 1, presentation.ui.picker.selectedIndex))
          : 0,
        error: null,
        query,
        variant: searchSource.variant,
        previewTitle: preserveVisibleModalState ? presentation.ui.picker.previewTitle : "",
        previewContent: preserveVisibleModalState ? presentation.ui.picker.previewContent : "",
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
    openFileSearchPicker,
    updatePickerQuery,
    loadCodeActions
  };
}
