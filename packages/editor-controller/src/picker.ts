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
  let searchSource:
    | null
    | {
        title: string;
        query: string;
        load(query: string): Promise<readonly PickerActionItem[]>;
      } = null;

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
      previous.query === next.query
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
      query: next.query
    };
    context.emitPresentationUpdate(effectType);
  };

  const closePicker: PickerRuntime["closePicker"] = (effectType = "ui.picker.close") => {
    setPickerState(
      {
        active: false,
        loading: false,
        title: "",
        items: [],
        selectedIndex: 0,
        error: null,
        query: ""
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

    setPickerState(
      {
        active: true,
        loading: presentation.ui.picker.loading,
        title: presentation.ui.picker.title,
        items: pickerActions,
        selectedIndex: nextIndex,
        error: presentation.ui.picker.error,
        query: presentation.ui.picker.query
      },
      "ui.picker"
    );
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
        query: ""
      },
      "ui.picker"
    );
    return true;
  };

  const openJumpListPicker = () => {
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
        query: ""
      },
      "ui.picker"
    );
    return true;
  };

  const openBuffersPicker = () => {
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
      load: buildItems
    };

    void updatePickerQuery("");
    return true;
  };

  const openFileSearchPicker = async (scope: "repo" | "folder") => {
    searchSource = {
      title: scope === "repo" ? "repo" : "folder",
      query: "",
      load: async (query) => {
        const files = await context.getController().searchFiles(scope, query);
        return files.map((entry) => ({
          label: entry.filePath,
          detail: entry.detail,
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

    searchSource.query = query;
    setPickerState(
      {
        active: true,
        loading: true,
        title: searchSource.title,
        items: [],
        selectedIndex: 0,
        error: null,
        query
      },
      "ui.picker"
    );

    let items: readonly PickerActionItem[];
    try {
      items = await searchSource.load(query);
    } catch {
      closePicker("ui.picker.close");
      context.setBottomMessage({ tone: "error", text: "Search failed" });
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
        query
      },
      "ui.picker"
    );
    return true;
  };

  const loadCodeActions = async (): Promise<boolean> => {
    const controller = context.getController();
    setPickerState(
      {
        active: true,
        loading: true,
        title: "code actions",
        items: [],
        selectedIndex: 0,
        error: null,
        query: ""
      },
      "ui.picker"
    );

    let actions: readonly EditorCodeAction[];
    try {
      actions = await controller.requestCodeActions();
    } catch {
      closePicker("ui.picker.close");
      context.setBottomMessage({ tone: "error", text: "Code actions request failed" });
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
        query: ""
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
