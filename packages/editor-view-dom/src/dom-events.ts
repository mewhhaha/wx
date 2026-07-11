import type { DomEditorContext, DomEditorRuntime } from "./dom-runtime";

import { resolveOffsetWithinRun } from "./dom-hover";
import {
  isBrowserPasteShortcut,
  keyboardInputForEvent,
  shouldRouteKeydown
} from "./dom-input";

export interface DomEventRuntime {
  handleKeydown(event: KeyboardEvent): void;
  handleBeforeInput(event: InputEvent): void;
  handleInput(event: InputEvent): void;
  handleCompositionStart(): void;
  handleCompositionUpdate(event: CompositionEvent): void;
  handleCompositionEnd(event: CompositionEvent): void;
  handleWheel(event: WheelEvent): void;
  handlePaste(event: ClipboardEvent): void;
  handleMouseMove(event: MouseEvent): void;
  handleMouseLeave(): void;
  destroy(): void;
}

export function createDomEventRuntime(context: DomEditorContext, runtime: DomEditorRuntime): DomEventRuntime {
  let destroyed = false;
  let composing = false;
  let deferredCompositionCommit: string | null = null;
  let compositionFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let compositionSuppressionTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressedCompositionInput: string | null = null;
  let queuedText: Promise<void> | null = null;

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

  const forwardKeydownToController = (event: KeyboardEvent) =>
    context.controller.handleKeyInput(keyboardInputForEvent(event), {
      themeNames: context.availableCommandThemes.map((entry) => entry.name),
      readClipboardText: readSystemClipboard
    });

  const syncAfterControllerInput = (themeName: string | null | undefined): void => {
    if (destroyed || context.destroyed) {
      return;
    }

    runtime.syncPresentationMirrors();
    runtime.syncRenderedThemeFromPresentation();
    if (context.presentation.ui.hover.active && context.presentation.ui.hover.pinned) {
      context.hoverAnchorFollowsCursor = true;
    }
    runtime.syncKeyboardHoverAnchor();

    if (themeName !== undefined) {
      runtime.syncRenderedThemeFromPresentation();
      runtime.patchBottomRow();
    }
  };

  const clearTextarea = () => {
    if (composing) return;
    const textarea = context.root.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement | null;
    if (textarea) textarea.value = "";
  };

  const run = (work: () => Promise<{ themeName?: string | null }>): Promise<void> => {
    if (destroyed || context.destroyed) return Promise.resolve();
    // Controller input mutates its synchronous editor state before awaiting
    // optional host work. Start each browser event immediately so DOM event
    // ordering remains observable to command state, then serialize completion
    // effects (theme/status mirrors) in the same source order.
    return work().then((result) => {
      if (!destroyed && !context.destroyed) syncAfterControllerInput(result.themeName);
    }).catch(() => undefined);
  };

  const enqueueKey = (work: () => Promise<{ themeName?: string | null }>): void => {
    if (queuedText) {
      queuedText = queuedText.then(() => run(work));
      return;
    }
    void run(work);
  };

  const enqueueText = (work: () => Promise<{ themeName?: string | null }>): void => {
    const task = queuedText ? queuedText.then(() => run(work)) : run(work);
    let chained: Promise<void>;
    chained = task.finally(() => {
      if (queuedText === chained) queuedText = null;
    });
    queuedText = chained;
  };

  const inputOptions = () => ({
    themeNames: context.availableCommandThemes.map((entry) => entry.name),
    readClipboardText: readSystemClipboard
  });

  const acceptsDocumentText = () => {
    const ui = context.presentation.ui;
    return context.state.mode === "insert" && !ui.commandLine.active && !ui.picker.active && !ui.completion.active;
  };

  const commitText = (text: string, boundary = false) => {
    if (!text || !acceptsDocumentText()) return;
    const work = () => context.controller.handleTextInput(text, inputOptions());
    if (boundary) {
      enqueueText(work);
    } else {
      enqueueKey(work);
    }
    clearTextarea();
  };

  const clearCompositionFallback = () => {
    if (compositionFallbackTimer === null) return;
    clearTimeout(compositionFallbackTimer);
    compositionFallbackTimer = null;
  };

  const suppressMatchingCompositionInput = (text: string) => {
    suppressedCompositionInput = text;
    if (compositionSuppressionTimer !== null) clearTimeout(compositionSuppressionTimer);
    // Keep the suppression through the next task. WebKit can deliver the final
    // input after compositionend in a separate task, after the fallback has
    // already committed the text.
    compositionSuppressionTimer = setTimeout(() => {
      suppressedCompositionInput = null;
      compositionSuppressionTimer = null;
    }, 0);
  };

  const claimDeferredComposition = (text: string) => {
    if (deferredCompositionCommit === null) return false;
    const matches = deferredCompositionCommit === text;
    deferredCompositionCommit = null;
    clearCompositionFallback();
    if (matches) suppressMatchingCompositionInput(text);
    return matches;
  };

  const commitCompositionIfUnclaimed = () => {
    compositionFallbackTimer = null;
    const text = deferredCompositionCommit;
    if (!text) return;
    deferredCompositionCommit = null;
    suppressMatchingCompositionInput(text);
    commitText(text);
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
          completionActive: uiState.completion.active,
          flashActive: uiState.flash.active,
          pendingAction: uiState.pendingAction,
          stickyViewMode: uiState.stickyViewMode,
          hoverActive: uiState.hover.active
        })
      ) {
        return;
      }

      event.preventDefault();
      clearTextarea();
      enqueueKey(() => forwardKeydownToController(event));
    },
    handleBeforeInput(event) {
      const inputType = event.inputType;
      if (inputType === "insertCompositionText" || event.isComposing) return;

      if (inputType === "deleteContentBackward" || inputType === "deleteWordBackward") {
        if (!acceptsDocumentText()) return;
        event.preventDefault();
        enqueueKey(() => forwardKeydownToController(new KeyboardEvent("keydown", { key: "Backspace" })));
        clearTextarea();
        return;
      }
      if (inputType === "deleteContentForward" || inputType === "deleteWordForward") {
        if (!acceptsDocumentText()) return;
        event.preventDefault();
        enqueueKey(() => forwardKeydownToController(new KeyboardEvent("keydown", { key: "Delete" })));
        clearTextarea();
        return;
      }

      if (!inputType.startsWith("insert") || !acceptsDocumentText()) return;
      const text = event.data ?? (inputType === "insertLineBreak" || inputType === "insertParagraph" ? "\n" : "");
      if (!text) return;
      claimDeferredComposition(text);
      event.preventDefault();
      commitText(text);
    },
    handleInput(event) {
      if (event.isComposing || composing || !acceptsDocumentText()) return;
      // Safari and some virtual keyboards omit usable beforeinput data. The
      // backing textarea is deliberately a short-lived input buffer.
      const textarea = event.currentTarget as HTMLTextAreaElement | null;
      const text = event.data ?? textarea?.value ?? "";
      if (text) {
        if (suppressedCompositionInput === text) {
          suppressedCompositionInput = null;
          if (compositionSuppressionTimer !== null) clearTimeout(compositionSuppressionTimer);
          compositionSuppressionTimer = null;
          clearTextarea();
          return;
        }
        claimDeferredComposition(text);
        commitText(text);
      }
    },
    handleCompositionStart() {
      composing = true;
      clearCompositionFallback();
      if (compositionSuppressionTimer !== null) clearTimeout(compositionSuppressionTimer);
      compositionSuppressionTimer = null;
      deferredCompositionCommit = null;
      suppressedCompositionInput = null;
    },
    handleCompositionUpdate() {},
    handleCompositionEnd(event) {
      composing = false;
      // An empty compositionend is cancellation, even if compositionupdate
      // previously supplied provisional text.
      deferredCompositionCommit = event.data || null;
      clearCompositionFallback();
      if (deferredCompositionCommit !== null) {
        // Prefer the browser's final beforeinput/input payload. The task
        // fallback covers engines and synthetic integrations that omit it.
        compositionFallbackTimer = setTimeout(commitCompositionIfUnclaimed, 0);
      }
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
      const key = event.deltaY > 0 ? "ArrowDown" : "ArrowUp";
      const steps = Math.max(1, Math.round(Math.abs(event.deltaY) / 48));
      void (async () => {
        let themeName: string | null | undefined;
        for (let index = 0; index < steps; index += 1) {
          if (destroyed || context.destroyed) return;
          const result = await context.controller.handleKeyInput({ key, source: "dom" }, {
            themeNames: context.availableCommandThemes.map((entry) => entry.name),
            readClipboardText: readSystemClipboard
          });
          themeName = result.themeName;
        }
        syncAfterControllerInput(themeName);
      })().catch(() => undefined);
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
      clearTextarea();
      commitText(pastedText, true);
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
    },
    destroy() {
      destroyed = true;
      clearCompositionFallback();
      if (compositionSuppressionTimer !== null) clearTimeout(compositionSuppressionTimer);
      compositionSuppressionTimer = null;
      suppressedCompositionInput = null;
      deferredCompositionCommit = null;
    }
  };
}
