import type { DomEditorContext, DomEditorRuntime } from "./dom-runtime";

import { resolveOffsetWithinRun } from "./dom-hover";
import {
  isBrowserPasteShortcut,
  keyboardInputForEvent,
  shouldRouteKeydown
} from "./dom-input";

export interface DomEventRuntime {
  handleKeydown(event: KeyboardEvent): void;
  handleWheel(event: WheelEvent): void;
  handlePaste(event: ClipboardEvent): void;
  handleMouseMove(event: MouseEvent): void;
  handleMouseLeave(): void;
}

export function createDomEventRuntime(context: DomEditorContext, runtime: DomEditorRuntime): DomEventRuntime {
  const readSystemClipboard = async (): Promise<string | null> => {
    const clipboard = navigator.clipboard;

    if (!clipboard?.readText) {
      context.controller.setBottomMessage({ tone: "warning", text: "System clipboard is unavailable" });
      return null;
    }

    try {
      return await clipboard.readText();
    } catch {
      context.controller.setBottomMessage({ tone: "error", text: "Could not read the system clipboard" });
      return null;
    }
  };

  const forwardKeydownToController = async (event: KeyboardEvent): Promise<void> => {
    const result = await context.controller.handleKeyInput(keyboardInputForEvent(event), {
      themeNames: context.availableCommandThemes.map((entry) => entry.name),
      readClipboardText: readSystemClipboard
    });

    if (context.destroyed) {
      return;
    }

    runtime.syncPresentationMirrors();
    runtime.syncRenderedThemeFromPresentation();
    if (context.presentation.ui.hover.active && context.presentation.ui.hover.pinned) {
      context.hoverAnchorFollowsCursor = true;
    }
    runtime.syncKeyboardHoverAnchor();

    if (result.themeName !== undefined) {
      runtime.syncRenderedThemeFromPresentation();
      runtime.patchBottomRow();
    }
  };

  return {
    handleKeydown(event) {
      const uiState = context.presentation.ui;

      if (
        isBrowserPasteShortcut(event, {
          state: context.state,
          commandLineActive: uiState.commandLine.active,
          pickerActive: uiState.picker.active
        })
      ) {
        return;
      }

      if (
        !shouldRouteKeydown(event, {
          state: context.state,
          commandLineActive: uiState.commandLine.active,
          pickerActive: uiState.picker.active,
          flashActive: uiState.flash.active,
          pendingAction: uiState.pendingAction,
          stickyViewMode: uiState.stickyViewMode,
          hoverActive: uiState.hover.active
        })
      ) {
        return;
      }

      event.preventDefault();
      const textarea = context.root.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.value = "";
      }
      void forwardKeydownToController(event);
    },
    handleWheel(event) {
      const uiState = context.presentation.ui;
      if (event.metaKey || event.ctrlKey || uiState.commandLine.active) {
        return;
      }

      if (event.deltaY === 0) {
        return;
      }

      event.preventDefault();
      const textarea = context.root.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement | null;
      textarea?.focus();
      if (textarea) {
        textarea.value = "";
      }
      context.controller.scrollViewportBy(event.deltaY > 0 ? 1 : -1);
    },
    handlePaste(event) {
      const uiState = context.presentation.ui;
      if (context.state.mode !== "insert" || uiState.commandLine.active || uiState.picker.active) {
        return;
      }

      const pastedText = event.clipboardData?.getData("text/plain") ?? "";
      if (!pastedText) {
        return;
      }

      event.preventDefault();
      const textarea = context.root.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.value = "";
      }
      void context.controller.handleTextInput(pastedText, {
        themeNames: context.availableCommandThemes.map((entry) => entry.name),
        readClipboardText: readSystemClipboard
      });
    },
    handleMouseMove(event) {
      const uiState = context.presentation.ui;
      if (uiState.commandLine.active || uiState.picker.active) {
        return;
      }

      const sourceElement = event.target instanceof Element ? event.target : null;
      const marker = sourceElement?.closest<HTMLElement>("[data-wx-editor-diagnostic-marker]");

      if (marker?.dataset.wxEditorDiagnosticMarker) {
        const row = marker.closest<HTMLElement>("[data-wx-editor-row]");
        const lineIndex = row?.dataset.wxEditorRow ? Number(row.dataset.wxEditorRow) - 1 : null;
        const diagnostic = lineIndex === null || Number.isNaN(lineIndex) ? null : runtime.getLineDiagnostics(lineIndex)[0] ?? null;

        if (diagnostic) {
          runtime.showDiagnosticTooltip(diagnostic, marker.getBoundingClientRect(), false);
          return;
        }
      }

      const target = sourceElement?.closest<HTMLElement>("[data-wx-editor-offset]") ?? null;

      if (!target?.dataset.wxEditorOffset) {
        runtime.clearHover(true);
        return;
      }

      const offset = resolveOffsetWithinRun(
        target,
        Number(target.dataset.wxEditorOffset),
        target.dataset.wxEditorOffsetEnd ? Number(target.dataset.wxEditorOffsetEnd) : null,
        event.clientX
      );

      if (offset === null || Number.isNaN(offset)) {
        runtime.clearHover(true);
        return;
      }

      if (uiState.hover.active && uiState.hover.offset === offset && !uiState.hover.pinned) {
        return;
      }

      const activeDiagnostic = context.diagnostics.find((entry) => offset >= entry.from && offset < entry.to) ?? null;
      if (activeDiagnostic) {
        runtime.showDiagnosticTooltip(activeDiagnostic, target.getBoundingClientRect(), false);
        return;
      }

      void runtime.requestHover(offset, target.getBoundingClientRect(), false);
    },
    handleMouseLeave() {
      runtime.clearHover(true);
    }
  };
}
