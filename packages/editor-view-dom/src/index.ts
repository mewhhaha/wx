import {
  createEditorController,
  normalizeLanguageServices
} from "@wx/editor-controller";
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
import type { EditorLanguageServices } from "@wx/editor-language";
import { languageProviderToServices } from "@wx/editor-language";
import { defaultTheme, normalizeCommandThemes } from "@wx/editor-theme";

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
      filePath: options.filePath
    });
  let state = controller.getState();
  const host = options.host ?? null;
  let languageServices = normalizeLanguageServices(
    options.languageServices ?? languageProviderToServices(options.language ?? null)
  );
  let theme = options.theme ?? defaultTheme;
  if (options.filePath !== undefined) {
    controller.setFilePath(options.filePath);
  }
  controller.setThemeName(theme.name);
  controller.setHostServices(host);
  controller.setLanguageServices(languageServices);
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
  let unsubscribeController = controller.subscribe(runtime.handleControllerUpdate);
  const handle = createDomHandleRuntime({
    controller,
    context,
    runtime,
    normalizeLanguageServices,
    unsubscribeController() {
      unsubscribeController();
    },
    disconnectResizeObserver() {
      resizeObserver?.disconnect();
      resizeObserver = null;
    }
  });

  let resizeObserver: ResizeObserver | null = null;

  root.addEventListener("focus", () => {
    if (document.activeElement !== textarea) {
      textarea.focus();
    }
  });
  root.addEventListener("mousedown", () => {
    textarea.focus();
  });
  textarea.addEventListener("keydown", events.handleKeydown);
  textarea.addEventListener("paste", events.handlePaste);
  surface.addEventListener("wheel", events.handleWheel, { passive: false });
  viewportRows.addEventListener("mousemove", events.handleMouseMove);
  viewportRows.addEventListener("mouseleave", events.handleMouseLeave);

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
    resizeObserver.observe(surface);
  }

  return {
    controller,
    ...handle
  };
}
