import { getCursorOffset, type EditorState } from "@wx/editor-core";
import type { EditorCodeAction } from "@wx/editor-language";
import type {
  EditorBottomMessageState,
  EditorController,
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
  loadCodeActions(): Promise<boolean>;
}

export function createPickerRuntime(context: PickerRuntimeContext): PickerRuntime {
  let pickerActions: readonly PickerActionItem[] = [];

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
        error: null
      },
      effectType
    );
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
        error: presentation.ui.picker.error
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
        error: null
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
        error: null
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
        error: null
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
        error: items.length === 0 ? "No code actions" : null
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
    loadCodeActions
  };
}
