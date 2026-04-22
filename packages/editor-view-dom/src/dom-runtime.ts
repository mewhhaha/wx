import {
  buildEditorLayout,
  buildEditorWorkspaceLayout,
  type EditorLayoutModel,
  type EditorLayoutRun
} from "@mewhhaha/wx-layout";
import type { EditorState } from "@mewhhaha/wx-core";
import type {
  EditorController,
  EditorPresentationState,
  EditorUpdate
} from "@mewhhaha/wx-controller";
import type { EditorCodeAction, EditorDiagnostic, EditorLanguageServices } from "@mewhhaha/wx-language";
import { createThemeVariables, type ThemeSpec } from "@mewhhaha/wx-theme";

import type { DomChromeRuntime } from "./dom-chrome";
import { getTooltipAnchorForRect } from "./dom-hover";
import type { LineChangeState, LineViewport, RowView, VisualRow } from "./dom-model";
import type { DomRenderRuntime } from "./dom-render";
import { computeRenderWork } from "./render-work";
import {
  getEffectiveThemeName,
  getEffectiveThemeSpec,
  readBottomBarSignature,
  readStatusSignature,
  readTooltipSignature
} from "./render-signatures";
import {
  expandViewport,
  refreshGutterWidth as refreshMeasuredGutterWidth,
  syncMeasuredViewportMetrics as syncMeasuredViewportMetricsWithController,
  VERTICAL_SCROLLOFF_ROWS,
  viewportEquals
} from "./dom-viewport";

function runClassNames(run: EditorLayoutRun): string[] {
  const classes: string[] = [];

  if (
    run.token === "text" ||
    run.token === "comment" ||
    run.token === "function" ||
    run.token === "gutter" ||
    run.token === "keyword" ||
    run.token === "number" ||
    run.token === "operator" ||
    run.token === "punctuation" ||
    run.token === "string" ||
    run.token === "type"
  ) {
    classes.push(`wx-role-${run.token}`);
  }

  if (run.token.startsWith("diagnostic-")) {
    classes.push(`wx-${run.token}`);
  }

  if (run.token === "status-mode") {
    classes.push("wx-editor__status-mode-chip");
  }

  if (run.token === "picker-selected") {
    classes.push("wx-editor__picker-item--selected");
  }

  if (run.cursorBlock) {
    classes.push("wx-cursor-block", "wx-is-selected");
  }

  return classes;
}

function appendRuns(target: HTMLElement, runs: readonly EditorLayoutRun[]): void {
  for (const run of runs) {
    const span = document.createElement("span");
    span.textContent = run.text;
    const classes = runClassNames(run);
    if (classes.length > 0) {
      span.className = classes.join(" ");
    }
    if (run.part === "status-mode") {
      span.dataset.mode = run.text.trim();
    }
    target.append(span);
  }
}

export interface DomEditorContext {
  controller: EditorController;
  root: HTMLDivElement;
  surface: HTMLDivElement;
  viewportRows: HTMLDivElement;
  tooltip: HTMLDivElement;
  commandPopover: HTMLDivElement;
  statusMode: HTMLDivElement;
  statusFile: HTMLDivElement;
  statusMeta: HTMLDivElement;
  bottomRow: HTMLDivElement;
  metrics: { charWidth: number; lineHeight: number };
  commandThemes?: readonly ThemeSpec[];
  normalizeCommandThemes(themes: readonly ThemeSpec[] | undefined, activeTheme: ThemeSpec): ThemeSpec[];
  state: EditorState;
  presentation: EditorPresentationState;
  bufferTitle: string;
  theme: ThemeSpec;
  languageServices: EditorLanguageServices[];
  availableCommandThemes: ThemeSpec[];
  softWrap: boolean;
  indentGuides: {
    render: boolean;
    character: string;
    skipLevels: number;
    indentWidth: number;
  };
  rowViews: RowView[];
  renderedViewport: LineViewport;
  visualRows: VisualRow[];
  lineVisualRanges: Array<{ from: number; to: number }>;
  wrapColumns: number;
  wrapRevision: number;
  diagnostics: readonly EditorDiagnostic[];
  diagnosticsByLine: Map<number, EditorDiagnostic[]>;
  lineChangesByLine: Map<number, LineChangeState>;
  hoverAnchor: { left: number; top: number };
  hoverAnchorFollowsCursor: boolean;
  appliedThemeName: string | null;
  renderedStatusSignature: string;
  renderedBottomBarSignature: string;
  renderedTooltipSignature: string;
  gutterWidth: number;
  anchoredTopVisualRow: number;
  visibleLineCapacity: number;
  destroyed: boolean;
  mountedContainer: HTMLElement | null;
  currentLayoutModel: EditorLayoutModel | null;
  pendingMountFrame: number;
  renderRuntime: DomRenderRuntime | null;
  chromeRuntime: DomChromeRuntime | null;
}

export interface DomEditorRuntime {
  syncViewportMirrors(): void;
  syncLanguageMirrors(): void;
  syncPresentationMirrors(): void;
  getVisibleViewport(): LineViewport;
  getVisibleLineCapacity(): number;
  getVerticalScrolloffRows(): number;
  buildLayoutModelForViewport(viewport: LineViewport): EditorLayoutModel;
  getRenderedLayout(): EditorLayoutModel;
  getVisualRow(visualRowIndex: number): VisualRow;
  getRowViewByVisualRowIndex(visualRowIndex: number): RowView | null;
  getLineDiagnostics(lineIndex: number): readonly EditorDiagnostic[];
  getCurrentEffectiveThemeSpec(): ThemeSpec;
  getCurrentEffectiveThemeName(): string;
  getCurrentStatusSignature(): string;
  getCurrentBottomBarSignature(): string;
  getCurrentTooltipSignature(): string;
  setHoverAnchor(next: { left: number; top: number }, followsCursor?: boolean): void;
  renderVisibleRows(force?: boolean): void;
  renderDirtyRows(dirtyLines: ReadonlySet<number>): boolean;
  tryPatchSimpleCursorMove(previousState: EditorState, nextState: EditorState): boolean;
  patchRowView(view: RowView, layoutRow: EditorLayoutModel["document"]["rows"][number]): void;
  patchStatus(): void;
  patchBottomRow(): void;
  patchCommandPopover(): void;
  patchTooltip(): void;
  refreshGutterWidth(force?: boolean): void;
  refreshViewportMetricsIfNeeded(force?: boolean): boolean;
  renderSurfaceSnapshot(options?: {
    forceRows?: boolean;
    syncTheme?: boolean;
    patchTooltip?: boolean;
  }): void;
  handleControllerUpdate(update: EditorUpdate): void;
  syncRenderedThemeFromPresentation(force?: boolean): boolean;
  schedulePostMountReveal(): void;
  clearHover(preservePinned?: boolean): void;
  showDiagnosticTooltip(diagnostic: EditorDiagnostic, anchor: DOMRect, pinned?: boolean): void;
  requestHover(offset: number, anchor: DOMRect, pinned?: boolean): Promise<boolean>;
  applyCodeActionInternal(action: EditorCodeAction): Promise<boolean>;
  revealCursor(): void;
  syncKeyboardHoverAnchor(): void;
}

function getSelectionLines(targetState: EditorState): Set<number> {
  const lines = new Set<number>();

  for (const range of targetState.selection.ranges) {
    const start = targetState.doc.positionAt(Math.min(range.anchor, range.head)).line;
    const end = targetState.doc.positionAt(Math.max(range.anchor, range.head)).line;
    for (let line = start; line <= end; line += 1) {
      lines.add(line);
    }
  }

  return lines;
}

function getActiveLine(targetState: EditorState): number {
  const activeOffset =
    targetState.mode === "insert"
      ? targetState.selection.ranges[targetState.selection.primaryIndex]?.head ?? 0
      : Math.max(0, (targetState.selection.ranges[targetState.selection.primaryIndex]?.head ?? 0) - 1);
  return targetState.doc.positionAt(activeOffset).line;
}

function getVisualDirtyLines(previousState: EditorState, nextState: EditorState): Set<number> {
  const dirtyLines = new Set<number>([
    ...getSelectionLines(previousState),
    ...getSelectionLines(nextState),
    getActiveLine(previousState),
    getActiveLine(nextState)
  ]);
  return dirtyLines;
}

export function createDomEditorRuntime(context: DomEditorContext): DomEditorRuntime {
  const viewportState = context.presentation.viewport;
  const languageState = context.presentation.language;
  const uiState = context.presentation.ui;

  const getCurrentEffectiveThemeSpec = () => getEffectiveThemeSpec(context.presentation, context.theme, context.availableCommandThemes);
  const getCurrentEffectiveThemeName = () => getEffectiveThemeName(context.presentation, context.theme);

  const getDiagnosticsSummary = () => {
    let errors = 0;
    let warnings = 0;

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.severity === "error") {
        errors += 1;
      } else if (diagnostic.severity === "warning") {
        warnings += 1;
      }
    }

    return { errors, warnings };
  };

  const getCurrentStatusSignature = () =>
    readStatusSignature({
      state: context.state,
      presentation: context.presentation,
      bufferTitle: context.bufferTitle,
      diagnosticsSummary: getDiagnosticsSummary()
    });

  const getCurrentBottomBarSignature = () => readBottomBarSignature(context.presentation);
  const getCurrentTooltipSignature = () => readTooltipSignature({ presentation: context.presentation, hoverAnchor: context.hoverAnchor });

  const setHoverAnchor = (next: { left: number; top: number }, followsCursor = false) => {
    if (
      context.hoverAnchor.left === next.left &&
      context.hoverAnchor.top === next.top &&
      context.hoverAnchorFollowsCursor === followsCursor
    ) {
      return;
    }

    context.hoverAnchor = next;
    context.hoverAnchorFollowsCursor = followsCursor;
    context.currentLayoutModel = null;
  };

  const syncViewportMirrors = () => {
    context.anchoredTopVisualRow = viewportState.topVisualRow;
    context.visibleLineCapacity = viewportState.visibleRowCapacity;
    context.wrapColumns = viewportState.wrapColumns;
    context.wrapRevision = viewportState.wrapRevision;
    context.visualRows = [...viewportState.visualRows] as VisualRow[];
    context.lineVisualRanges = [...viewportState.lineVisualRanges] as Array<{ from: number; to: number }>;
  };

  const syncLanguageMirrors = () => {
    context.languageServices = [...languageState.services];
    context.diagnostics = languageState.diagnostics;
    context.diagnosticsByLine = languageState.diagnosticsByLine;
    context.lineChangesByLine = languageState.lineChangesByLine as Map<number, LineChangeState>;
  };

  const syncPresentationMirrors = () => {
    context.bufferTitle = context.presentation.bufferTitle;
    syncViewportMirrors();
    syncLanguageMirrors();
    context.currentLayoutModel = null;
  };

  const getVisibleViewport = () => {
    const lineCount = Math.max(1, context.visualRows.length);
    const fromLine = Math.max(0, Math.min(lineCount - 1, context.anchoredTopVisualRow));
    const toLine = Math.min(lineCount - 1, fromLine + context.visibleLineCapacity - 1);

    return { fromLine, toLine };
  };

  const getVisibleLineCapacity = () => context.visibleLineCapacity;

  const getVerticalScrolloffRows = () => {
    const capacity = getVisibleLineCapacity();
    return Math.max(0, Math.min(VERTICAL_SCROLLOFF_ROWS, Math.floor((capacity - 1) / 2)));
  };

  const buildLayoutModelForViewport = (_viewport: LineViewport) => {
    if (context.currentLayoutModel) {
      return context.currentLayoutModel;
    }

    const model = buildEditorLayout({
      state: context.state,
      presentation: context.presentation,
      hoverAnchor: {
        col: Math.max(0, Math.floor(context.hoverAnchor.left / Math.max(context.metrics.charWidth, 1))),
        row: Math.max(0, Math.floor(context.hoverAnchor.top / Math.max(context.metrics.lineHeight, 1)))
      },
      indentGuides: context.indentGuides
    });

    context.currentLayoutModel = model;
    return model;
  };

  const getVisualRow = (visualRowIndex: number) =>
    context.visualRows[Math.max(0, Math.min(context.visualRows.length - 1, visualRowIndex))] ?? {
      docLine: 0,
      visualRowIndex: 0,
      segmentStart: 0,
      segmentEnd: 0,
      startColumn: 0,
      isContinuation: false,
      isLastSegment: true
    };

  const getRowViewByVisualRowIndex = (visualRowIndex: number) =>
    context.rowViews.find((view) => view.visualRowIndex === visualRowIndex) ?? null;

  const getLineDiagnostics = (lineIndex: number) => context.diagnosticsByLine.get(lineIndex) ?? [];

  const getRenderedLayout = () =>
    buildLayoutModelForViewport(
      context.renderedViewport.toLine >= context.renderedViewport.fromLine
        ? context.renderedViewport
        : expandViewport(getVisibleViewport(), Math.max(1, context.visualRows.length))
    );

  const renderVisibleRows = (force = false) => {
    context.renderRuntime?.renderVisibleRows(force);
  };

  const renderDirtyRows = (dirtyLines: ReadonlySet<number>) => context.renderRuntime?.renderDirtyRows(dirtyLines) ?? false;

  const tryPatchSimpleCursorMove = (previousState: EditorState, nextState: EditorState) =>
    context.renderRuntime?.tryPatchSimpleCursorMove(previousState, nextState) ?? false;

  const patchRowView = (view: RowView, layoutRow: EditorLayoutModel["document"]["rows"][number]) => {
    context.renderRuntime?.patchRowView(view, layoutRow);
  };

  const patchStatus = () => {
    context.chromeRuntime?.patchStatus();
  };

  const patchBottomRow = () => {
    context.chromeRuntime?.patchBottomRow();
  };

  const patchCommandPopover = () => {
    context.chromeRuntime?.patchCommandPopover();
  };

  const patchTooltip = () => {
    context.chromeRuntime?.patchTooltip();
  };

  const refreshGutterWidth = (force = false) => {
    refreshMeasuredGutterWidth({
      force,
      gutterWidth: context.gutterWidth,
      metrics: context.metrics,
      root: context.root,
      lineCount: context.state.doc.lineCount,
      setGutterWidth(width) {
        context.gutterWidth = width;
      }
    });
  };

  const refreshViewportMetricsIfNeeded = (force = false) =>
    syncMeasuredViewportMetricsWithController({
      force,
      controller: context.controller,
      softWrap: context.softWrap,
      metrics: context.metrics,
      surface: context.surface,
      root: context.root,
      container: context.mountedContainer ?? context.root,
      gutterWidth: context.gutterWidth,
      visibleLineCapacity: context.visibleLineCapacity,
      wrapColumns: context.wrapColumns,
      viewportSoftWrap: viewportState.softWrap
    });

  const renderSurfaceSnapshot = (options: { forceRows?: boolean; syncTheme?: boolean; patchTooltip?: boolean } = {}) => {
    if (options.syncTheme) {
      syncRenderedThemeFromPresentation(true);
    }

    if (context.controller.getWorkspacePresentationState().panes.length > 1) {
      renderWorkspaceSnapshot();
      return;
    }

    context.statusMode.hidden = false;
    context.statusFile.hidden = false;
    context.statusMeta.hidden = false;
    context.bottomRow.hidden = false;

    if (options.forceRows) {
      renderVisibleRows(true);
    }

    patchStatus();
    patchBottomRow();

    if (options.patchTooltip) {
      patchTooltip();
    }
  };

  const syncRenderedThemeFromPresentation = (force = false) => {
    const nextTheme = getCurrentEffectiveThemeSpec();
    const nextThemeName = getCurrentEffectiveThemeName();

    if (!context.presentation.ui.previewTheme && context.presentation.themeName && nextTheme.name === context.presentation.themeName) {
      context.theme = nextTheme;
      context.availableCommandThemes = context.normalizeCommandThemes(context.commandThemes, context.theme);
    }

    if (!force && context.appliedThemeName === nextThemeName) {
      return false;
    }

    const variables = createThemeVariables(nextTheme);
    for (const [name, value] of Object.entries(variables)) {
      context.root.style.setProperty(name, value);
    }

    context.appliedThemeName = nextThemeName;
    return true;
  };

  const renderWorkspaceSnapshot = () => {
    const workspace = context.controller.getWorkspacePresentationState();
    const metrics = context.metrics;
    const cols = Math.max(1, Math.floor(context.surface.clientWidth / Math.max(metrics.charWidth, 1)));
    const rows = Math.max(3, Math.floor(context.surface.clientHeight / Math.max(metrics.lineHeight, 1)));
    const workspaceLayout = buildEditorWorkspaceLayout({
      cols,
      rows,
      activePaneId: workspace.activePaneId,
      layoutTree: workspace.layoutTree,
      panes: workspace.panes.map((pane) => ({
        paneId: pane.paneId,
        active: pane.active,
        state: pane.state,
        presentation: pane.presentation,
        hoverAnchor: pane.active
          ? {
              col: Math.max(0, Math.floor(context.hoverAnchor.left / Math.max(metrics.charWidth, 1))),
              row: Math.max(0, Math.floor(context.hoverAnchor.top / Math.max(metrics.lineHeight, 1)))
            }
          : { col: 0, row: 0 }
      })),
      indentGuides: context.indentGuides
    });

    const fragment = document.createDocumentFragment();
    context.viewportRows.replaceChildren();
    context.rowViews = [];
    context.renderedViewport = { fromLine: 0, toLine: -1 };

    for (const divider of workspaceLayout.dividers) {
      const line = document.createElement("div");
      line.className = `wx-editor__pane-divider wx-editor__pane-divider--${divider.axis}`;
      line.style.position = "absolute";
      if (divider.axis === "vertical") {
        line.style.left = `${divider.col * metrics.charWidth}px`;
        line.style.top = `${divider.row * metrics.lineHeight}px`;
        line.style.width = `${Math.max(1, metrics.charWidth)}px`;
        line.style.height = `${divider.length * metrics.lineHeight}px`;
      } else {
        line.style.left = `${divider.col * metrics.charWidth}px`;
        line.style.top = `${divider.row * metrics.lineHeight}px`;
        line.style.width = `${divider.length * metrics.charWidth}px`;
        line.style.height = `${Math.max(1, metrics.lineHeight)}px`;
      }
      fragment.append(line);
    }

    for (const pane of workspaceLayout.panes) {
      const paneHost = document.createElement("div");
      paneHost.className = "wx-editor__workspace-pane";
      if (pane.active) {
        paneHost.dataset.active = "true";
      }
      paneHost.style.position = "absolute";
      paneHost.style.left = `${pane.rect.col * metrics.charWidth}px`;
      paneHost.style.top = `${pane.rect.row * metrics.lineHeight}px`;
      paneHost.style.width = `${pane.rect.cols * metrics.charWidth}px`;
      paneHost.style.height = `${pane.rect.rows * metrics.lineHeight}px`;
      paneHost.addEventListener("mousedown", () => {
        context.controller.setActivePane(pane.paneId);
        const textarea = context.root.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement | null;
        textarea?.focus();
      });

      const body = document.createElement("div");
      body.className = "wx-editor__workspace-pane-body";
      const status = document.createElement("div");
      status.className = "wx-editor__workspace-pane-status";
      const bottom = document.createElement("div");
      bottom.className = "wx-editor__workspace-pane-bottom";

      for (const row of pane.layout.document.rows) {
        const rowHost = document.createElement("div");
        rowHost.className = "wx-editor__row";
        rowHost.dataset.wxEditorRow = String(row.docLine + 1);
        const gutter = document.createElement("div");
        gutter.className = "wx-editor__gutter";
        const content = document.createElement("div");
        content.className = "wx-editor__content";
        appendRuns(gutter, row.gutterRuns);
        appendRuns(content, row.contentRuns);
        rowHost.append(gutter, content);
        body.append(rowHost);
      }

      appendRuns(status, pane.layout.statusBar);
      appendRuns(bottom, pane.layout.bottomBar.runs);
      paneHost.append(body, status, bottom);
      fragment.append(paneHost);

      if (pane.active) {
        context.currentLayoutModel = pane.layout;
      }
    }

    context.viewportRows.replaceChildren(fragment);
    context.statusMode.hidden = true;
    context.statusFile.hidden = true;
    context.statusMeta.hidden = true;
    context.bottomRow.hidden = true;
    patchCommandPopover();
    patchTooltip();
  };

  const handleControllerUpdate = (update: EditorUpdate) => {
    const previousState = update.prevState;
    const nextState = update.nextState;
    const previousVisibleViewport = getVisibleViewport();
    const effectTypes = (update.transaction.effects ?? []).map((effect) => effect.type);
    const changes = update.transaction.changes ?? [];
    const hasDocumentChanges = update.docChanged || changes.length > 0;
    const isPresentationOnlyUpdate = !hasDocumentChanges && !update.selectionChanged && !update.modeChanged;
    const insertModeTransition =
      update.modeChanged && (previousState.mode === "insert" || nextState.mode === "insert");
    const previousDigits = String(Math.max(1, previousState.doc.lineCount)).length;
    const nextDigits = String(Math.max(1, nextState.doc.lineCount)).length;
    const dirtyLines =
      !hasDocumentChanges && (update.selectionChanged || update.modeChanged) && !insertModeTransition
        ? getVisualDirtyLines(previousState, nextState)
        : null;

    context.state = nextState;
    syncPresentationMirrors();
    if (context.controller.getWorkspacePresentationState().panes.length > 1) {
      syncRenderedThemeFromPresentation();
      renderWorkspaceSnapshot();
      return;
    }
    const viewportChanged = !viewportEquals(previousVisibleViewport, getVisibleViewport());
    const work = computeRenderWork({
      hasDocumentChanges,
      selectionChanged: update.selectionChanged,
      modeChanged: update.modeChanged,
      insertModeTransition,
      viewportChanged,
      digitsChanged: previousDigits !== nextDigits,
      isPresentationOnlyUpdate,
      hasDirtyLines: !!dirtyLines && dirtyLines.size > 0,
      effectTypes,
      themeChanged: context.appliedThemeName !== getCurrentEffectiveThemeName(),
      statusChanged: context.renderedStatusSignature !== getCurrentStatusSignature(),
      bottomBarChanged: context.renderedBottomBarSignature !== getCurrentBottomBarSignature(),
      tooltipChanged: context.renderedTooltipSignature !== getCurrentTooltipSignature()
    });

    if (work.syncTheme) {
      syncRenderedThemeFromPresentation();
    }

    if (work.refreshGutterMetrics) {
      refreshGutterWidth(true);
      if (refreshViewportMetricsIfNeeded(true)) {
        return;
      }
    }

    if (work.renderVisibleRows) {
      renderVisibleRows(true);
    } else if (work.trySimpleCursorPatch && dirtyLines && tryPatchSimpleCursorMove(previousState, nextState)) {
      // Fast path.
    } else if (work.tryDirtyRowPatch && dirtyLines && renderDirtyRows(dirtyLines)) {
      // Dirty row patch.
    } else if (work.trySimpleCursorPatch || work.tryDirtyRowPatch) {
      renderVisibleRows(true);
    }

    if (work.patchStatus) {
      patchStatus();
    }

    if (work.patchBottomRow) {
      patchBottomRow();
    }

    if (work.patchTooltip) {
      patchTooltip();
    }
  };

  const schedulePostMountReveal = () => {
    if (context.pendingMountFrame) {
      cancelAnimationFrame(context.pendingMountFrame);
      context.pendingMountFrame = 0;
    }

    context.pendingMountFrame = requestAnimationFrame(() => {
      context.pendingMountFrame = 0;
      if (context.destroyed || !context.mountedContainer?.isConnected) {
        return;
      }
      refreshGutterWidth(true);
      refreshViewportMetricsIfNeeded(true);
      revealCursor();
      if (context.controller.getWorkspacePresentationState().panes.length > 1) {
        renderWorkspaceSnapshot();
      } else {
        renderVisibleRows(true);
      }
    });
  };

  const clearHover = (preservePinned = false) => {
    if (context.controller.clearHover({ preservePinned })) {
      context.hoverAnchorFollowsCursor = false;
      syncPresentationMirrors();
      patchTooltip();
    }
  };

  const showDiagnosticTooltip = (diagnostic: EditorDiagnostic, anchor: DOMRect, pinned = false) => {
    setHoverAnchor(getTooltipAnchorForRect(context.root, anchor), false);
    context.controller.showDiagnosticHover(diagnostic, { pinned });
  };

  const requestHover = async (offset: number, anchor: DOMRect, pinned = false): Promise<boolean> => {
    if (uiState.hover.active && uiState.hover.offset === offset && uiState.hover.pinned === pinned) {
      setHoverAnchor(getTooltipAnchorForRect(context.root, anchor), pinned);
      patchTooltip();
      return true;
    }

    setHoverAnchor(getTooltipAnchorForRect(context.root, anchor), pinned);
    const shown = await context.controller.requestHoverAt(offset, { pinned });
    if (!context.destroyed) {
      syncPresentationMirrors();
      patchTooltip();
    }
    return shown;
  };

  const applyCodeActionInternal = async (action: EditorCodeAction) => context.controller.applyCodeAction(action);

  const revealCursor = () => {
    context.controller.revealSelection();
    syncViewportMirrors();
  };

  const syncKeyboardHoverAnchor = () => {
    if (!uiState.hover.active || !uiState.hover.pinned || !context.hoverAnchorFollowsCursor) {
      return;
    }

    const anchorElement = context.root.querySelector<HTMLElement>("[data-wx-editor-cursor='true']");
    const anchorRect = anchorElement?.getBoundingClientRect() ?? context.root.getBoundingClientRect();
    setHoverAnchor(getTooltipAnchorForRect(context.root, anchorRect), true);
    patchTooltip();
  };

  return {
    syncViewportMirrors,
    syncLanguageMirrors,
    syncPresentationMirrors,
    getVisibleViewport,
    getVisibleLineCapacity,
    getVerticalScrolloffRows,
    buildLayoutModelForViewport,
    getRenderedLayout,
    getVisualRow,
    getRowViewByVisualRowIndex,
    getLineDiagnostics,
    getCurrentEffectiveThemeSpec,
    getCurrentEffectiveThemeName,
    getCurrentStatusSignature,
    getCurrentBottomBarSignature,
    getCurrentTooltipSignature,
    setHoverAnchor,
    renderVisibleRows,
    renderDirtyRows,
    tryPatchSimpleCursorMove,
    patchRowView,
    patchStatus,
    patchBottomRow,
    patchCommandPopover,
    patchTooltip,
    refreshGutterWidth,
    refreshViewportMetricsIfNeeded,
    renderSurfaceSnapshot,
    handleControllerUpdate,
    syncRenderedThemeFromPresentation,
    schedulePostMountReveal,
    clearHover,
    showDiagnosticTooltip,
    requestHover,
    applyCodeActionInternal,
    revealCursor,
    syncKeyboardHoverAnchor
  };
}
