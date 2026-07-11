import {
  createEditorController,
  normalizeLanguageServices
} from "@mewhhaha/wx-controller";
import { createEditorDom } from "./dom-bootstrap";
import { createDomChromeRuntime } from "./dom-chrome";
import { createDomEventRuntime } from "./dom-events";
import { createDomHandleRuntime } from "./dom-handle";
import type { LineChangeState, LineViewport, RowView, VisualRow } from "./dom-model";
import { createDomRenderRuntime } from "./dom-render";
import { createDomEditorRuntime, type DomEditorContext } from "./dom-runtime";
import { applyThemeVariables, mountStyles } from "./dom-styles";
import type { CreateEditorOptions, EditorHandle } from "./types";
import { measureMetrics } from "./dom-viewport";
import type { EditorLanguageServices } from "@mewhhaha/wx-language";
import { languageProviderToServices } from "@mewhhaha/wx-language";
import { defaultTheme, normalizeCommandThemes } from "@mewhhaha/wx-theme";

export type {
  CreateEditorOptions,
  EditorHandle,
  EditorHostServices,
  EditorLineChange,
  EditorLineChangeKind
} from "./types";

type LineChangesByLine = Map<number, LineChangeState>;

const EMPTY_CELL_TEXT = "\u00a0";
const INSERT_TAB_TEXT = "  ";

const DEFAULT_INDENT_GUIDE_CHARACTER = "│";

export function createEditor(container: HTMLElement, options: CreateEditorOptions = {}): EditorHandle {
  const ownsController = options.controller === undefined;
  if (!ownsController && options.keymap !== undefined) {
    throw new Error("createEditor cannot apply keymap when controller is supplied; configure the controller instead");
  }
  const softWrap = options.softWrap ?? false;
  const indentGuides = {
    render: options.indentGuides?.render ?? false,
    character: options.indentGuides?.character ?? DEFAULT_INDENT_GUIDE_CHARACTER,
    skipLevels: Math.max(0, options.indentGuides?.skipLevels ?? 0),
    indentWidth: INSERT_TAB_TEXT.length
  };
  const controller =
    options.controller ??
    createEditorController({
      value: options.value ?? "",
      theme: options.theme?.name,
      filePath: options.filePath,
      languageRegistry: options.languageRegistry,
      keymap: options.keymap
    });
  let state = controller.getState();
  const host = options.host ?? null;
  const hasExplicitLanguage = options.language !== undefined || options.languageServices !== undefined;
  const initialLanguageServices = options.languageServices ?? languageProviderToServices(options.language ?? null);
  let theme = options.theme ?? defaultTheme;
  if (options.languageRegistry !== undefined) {
    controller.setLanguageRegistry(options.languageRegistry);
  }
  if (options.filePath !== undefined) {
    controller.setFilePath(options.filePath);
  }
  controller.setThemeName(theme.name);
  controller.setHostServices(host);
  if (hasExplicitLanguage) {
    controller.setLanguageServices(initialLanguageServices);
  }
  let languageServices = [...controller.getPresentationState().language.services] as EditorLanguageServices[];
  const presentation = controller.getPresentationState();
  const metrics = measureMetrics(container);
  const {
    root,
    surface,
    viewportRows,
    tooltip,
    commandPopover,
    statusMode,
    statusFile,
    statusMeta,
    bottomRow,
    textarea
  } = createEditorDom(container, metrics.lineHeight);

  mountStyles(root);
  applyThemeVariables(root, theme);

  const context: DomEditorContext = {
    controller,
    root,
    surface,
    viewportRows,
    tooltip,
    commandPopover,
    statusMode,
    statusFile,
    statusMeta,
    bottomRow,
    metrics,
    commandThemes: options.commandThemes,
    normalizeCommandThemes,
    state,
    presentation,
    bufferTitle: presentation.bufferTitle,
    theme,
    languageServices,
    availableCommandThemes: normalizeCommandThemes(options.commandThemes, options.theme ?? defaultTheme),
    softWrap,
    indentGuides,
    rowViews: [],
    renderedViewport: { fromLine: 0, toLine: -1 },
    visualRows: [...presentation.viewport.visualRows] as VisualRow[],
    lineVisualRanges: [...presentation.viewport.lineVisualRanges] as Array<{ from: number; to: number }>,
    wrapColumns: presentation.viewport.wrapColumns,
    wrapRevision: presentation.viewport.wrapRevision,
    diagnostics: presentation.language.diagnostics,
    diagnosticsByLine: presentation.language.diagnosticsByLine,
    lineChangesByLine: presentation.language.lineChangesByLine as LineChangesByLine,
    hoverAnchor: { left: 16, top: 16 },
    hoverAnchorFollowsCursor: false,
    appliedThemeName: theme.name,
    renderedStatusSignature: "",
    renderedBottomBarSignature: "",
    renderedTooltipSignature: "",
    gutterWidth: 0,
    anchoredTopVisualRow: presentation.viewport.topVisualRow,
    visibleLineCapacity: presentation.viewport.visibleRowCapacity,
    destroyed: false,
    mountedContainer: container as HTMLElement | null,
    currentLayoutModel: null,
    pendingMountFrame: 0,
    renderRuntime: null,
    chromeRuntime: null
  };

  const runtime = createDomEditorRuntime(context);
  runtime.syncPresentationMirrors();

  const renderRuntime = createDomRenderRuntime({
    root,
    viewportRows,
    getState: () => context.state,
    getPresentation: () => presentation,
    getUiState: () => presentation.ui,
    getMetrics: () => context.metrics,
    getHoverAnchor: () => context.hoverAnchor,
    getVisualRows: () => context.visualRows,
    getLineVisualRanges: () => context.lineVisualRanges,
    getWrapColumns: () => context.wrapColumns,
    getSoftWrap: () => softWrap,
    getVisibleViewport: runtime.getVisibleViewport,
    getRenderedViewport: () => context.renderedViewport,
    setRenderedViewport(viewport) {
      context.renderedViewport = viewport;
    },
    getVisibleLineCapacity: runtime.getVisibleLineCapacity,
    getRowViews: () => context.rowViews,
    setRowViews(next) {
      context.rowViews = next;
    },
    getCurrentLayoutModel: () => context.currentLayoutModel,
    buildLayoutModelForViewport: runtime.buildLayoutModelForViewport,
    getVisualRow: runtime.getVisualRow,
    getRowViewByVisualRowIndex: runtime.getRowViewByVisualRowIndex,
    getLineDiagnostics: runtime.getLineDiagnostics,
    getRenderedLayout: runtime.getRenderedLayout,
    EMPTY_CELL_TEXT,
    indentGuides
  });
  context.renderRuntime = renderRuntime;

  const chromeRuntime = createDomChromeRuntime({
    bottomRow,
    commandPopover,
    statusMode,
    statusFile,
    statusMeta,
    tooltip,
    getState: () => context.state,
    getPresentation: () => presentation,
    getUiState: () => presentation.ui,
    getBufferTitle: () => context.bufferTitle,
    getMetrics: () => context.metrics,
    getRenderedLayout: runtime.getRenderedLayout,
    getDiagnosticsSummary() {
      let errors = 0;
      let warnings = 0;
      for (const entry of context.diagnostics) {
        if (entry.severity === "error") {
          errors += 1;
        } else if (entry.severity === "warning") {
          warnings += 1;
        }
      }
      return { errors, warnings };
    },
    getCurrentStatusSignature: runtime.getCurrentStatusSignature,
    setRenderedStatusSignature(signature) {
      context.renderedStatusSignature = signature;
    },
    getCurrentBottomBarSignature: runtime.getCurrentBottomBarSignature,
    setRenderedBottomBarSignature(signature) {
      context.renderedBottomBarSignature = signature;
    },
    getCurrentTooltipSignature: runtime.getCurrentTooltipSignature,
    setRenderedTooltipSignature(signature) {
      context.renderedTooltipSignature = signature;
    }
  });
  context.chromeRuntime = chromeRuntime;

  const events = createDomEventRuntime(context, runtime);
  const syncInputAccessibility = () => {
    const mode = context.state.mode === "insert" ? "insert" : context.state.mode;
    textarea.setAttribute("aria-label", `Editor input, ${mode} mode`);
  };
  const refreshFocusedFileStatus = () => {
    void controller.refreshFileStatus().then(() => {
      if (!context.destroyed) runtime.patchStatus();
    }).catch(() => undefined);
  };
  window.addEventListener("focus", refreshFocusedFileStatus);
  let unsubscribeController = controller.subscribe((update) => {
    runtime.handleControllerUpdate(update);
    syncInputAccessibility();
  });
  const handle = createDomHandleRuntime({
    controller,
    context,
    runtime,
    ownsController,
    normalizeLanguageServices,
    unsubscribeController() {
      unsubscribeController();
    },
    disconnectResizeObserver() {
      resizeObserver?.disconnect();
      resizeObserver = null;
    },
    cleanupWindowListeners() {
      window.removeEventListener("focus", refreshFocusedFileStatus);
      root.removeEventListener("focus", focusTextarea);
      root.removeEventListener("mousedown", focusTextarea);
      textarea.removeEventListener("keydown", events.handleKeydown);
      textarea.removeEventListener("beforeinput", events.handleBeforeInput);
      textarea.removeEventListener("input", events.handleInput);
      textarea.removeEventListener("compositionstart", events.handleCompositionStart);
      textarea.removeEventListener("compositionupdate", events.handleCompositionUpdate);
      textarea.removeEventListener("compositionend", events.handleCompositionEnd);
      textarea.removeEventListener("paste", events.handlePaste);
      surface.removeEventListener("wheel", events.handleWheel);
      viewportRows.removeEventListener("mousemove", events.handleMouseMove);
      viewportRows.removeEventListener("mouseleave", events.handleMouseLeave);
      events.destroy();
    }
  });

  let resizeObserver: ResizeObserver | null = null;

  const focusTextarea = () => {
    if (document.activeElement !== textarea) {
      textarea.focus();
    }
    refreshFocusedFileStatus();
  };
  root.addEventListener("focus", focusTextarea);
  root.addEventListener("mousedown", focusTextarea);
  textarea.addEventListener("keydown", events.handleKeydown);
  textarea.addEventListener("beforeinput", events.handleBeforeInput);
  textarea.addEventListener("input", events.handleInput);
  textarea.addEventListener("compositionstart", events.handleCompositionStart);
  textarea.addEventListener("compositionupdate", events.handleCompositionUpdate);
  textarea.addEventListener("compositionend", events.handleCompositionEnd);
  textarea.addEventListener("paste", events.handlePaste);
  surface.addEventListener("wheel", events.handleWheel, { passive: false });
  viewportRows.addEventListener("mousemove", events.handleMouseMove);
  viewportRows.addEventListener("mouseleave", events.handleMouseLeave);
  syncInputAccessibility();

  runtime.refreshGutterWidth(true);
  runtime.refreshViewportMetricsIfNeeded(true);
  runtime.revealCursor();
  runtime.renderSurfaceSnapshot({ forceRows: true });
  runtime.schedulePostMountReveal();

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      runtime.refreshGutterWidth(true);
      if (runtime.refreshViewportMetricsIfNeeded()) {
        return;
      }
      runtime.renderVisibleRows(true);
    });
    resizeObserver.observe(container);
  }

  return {
    controller,
    ...handle
  };
}
