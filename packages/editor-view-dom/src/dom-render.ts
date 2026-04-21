import {
  buildEditorLayoutRow,
  getVisualRowForOffset as getLayoutVisualRowForOffset,
  type EditorLayoutModel,
  type EditorLayoutToken
} from "@mewhhaha/wx-layout";
import {
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets,
  type EditorState
} from "@mewhhaha/wx-core";
import type { DiagnosticSeverity, EditorDiagnostic, HighlightRole } from "@mewhhaha/wx-language";
import type { EditorPresentationState } from "@mewhhaha/wx-controller";

import type { LineViewport, RowView, VisualRow } from "./dom-model";

const DIAGNOSTIC_SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3
};

function addClassName(element: Element, className: string, when: boolean): void {
  if (when) {
    element.classList.add(className);
  }
}

function roleClassName(role: HighlightRole): string {
  return `wx-role-${role}`;
}

function diagnosticClassName(severity: DiagnosticSeverity): string {
  return `wx-diagnostic-${severity}`;
}

function tokenToHighlightRole(token: EditorLayoutToken): HighlightRole | null {
  switch (token) {
    case "text":
    case "comment":
    case "function":
    case "gutter":
    case "keyword":
    case "number":
    case "operator":
    case "punctuation":
    case "string":
    case "type":
      return token;
    default:
      return null;
  }
}

function tokenToDiagnosticSeverity(token: EditorLayoutToken): DiagnosticSeverity | null {
  switch (token) {
    case "diagnostic-error":
      return "error";
    case "diagnostic-warning":
      return "warning";
    case "diagnostic-info":
      return "info";
    case "diagnostic-hint":
      return "hint";
    default:
      return null;
  }
}

interface CreateDomRenderRuntimeOptions {
  root: HTMLDivElement;
  viewportRows: HTMLDivElement;
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getUiState(): EditorPresentationState["ui"];
  getMetrics(): { charWidth: number; lineHeight: number };
  getHoverAnchor(): { left: number; top: number };
  getVisualRows(): VisualRow[];
  getLineVisualRanges(): Array<{ from: number; to: number }>;
  getWrapColumns(): number;
  getSoftWrap(): boolean;
  getVisibleViewport(): LineViewport;
  getRenderedViewport(): LineViewport;
  setRenderedViewport(viewport: LineViewport): void;
  getVisibleLineCapacity(): number;
  getRowViews(): RowView[];
  setRowViews(next: RowView[]): void;
  getCurrentLayoutModel(): EditorLayoutModel | null;
  buildLayoutModelForViewport(viewport: LineViewport): EditorLayoutModel;
  getVisualRow(visualRowIndex: number): VisualRow;
  getRowViewByVisualRowIndex(visualRowIndex: number): RowView | null;
  getLineDiagnostics(lineIndex: number): readonly EditorDiagnostic[];
  getRenderedLayout(): EditorLayoutModel;
  EMPTY_CELL_TEXT: string;
  indentGuides: {
    render: boolean;
    character: string;
    skipLevels: number;
    indentWidth: number;
  };
}

export interface DomRenderRuntime {
  createRowView(visualRowIndex: number): RowView;
  tryPatchSimpleCursorMove(previousState: EditorState, nextState: EditorState): boolean;
  patchRowView(view: RowView, layoutRow: EditorLayoutModel["document"]["rows"][number]): void;
  renderVisibleRows(force?: boolean): void;
  renderDirtyRows(dirtyLines: ReadonlySet<number>): boolean;
}

export function createDomRenderRuntime(options: CreateDomRenderRuntimeOptions): DomRenderRuntime {
  const getTokenSourceRange = (token: Element): { from: number; to: number } | null => {
    if (!(token instanceof HTMLSpanElement)) {
      return null;
    }

    const from = Number(token.dataset.wxEditorOffset);
    const to = Number(token.dataset.wxEditorOffsetEnd);

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return null;
    }

    return { from, to };
  };

  const cloneTokenSpan = (template: HTMLSpanElement, text: string, from: number, to: number): HTMLSpanElement => {
    const token = template.cloneNode(false) as HTMLSpanElement;
    token.classList.remove("wx-cursor-block", "wx-is-selected");
    delete token.dataset.wxEditorCursor;
    delete token.dataset.wxEditorCursorKind;
    token.dataset.wxEditorOffset = String(from);
    token.dataset.wxEditorOffsetEnd = String(to);
    token.textContent = text;
    return token;
  };

  const findOrSplitTokenAtOffset = (lineText: HTMLElement, offset: number): HTMLSpanElement | null => {
    for (const child of lineText.children) {
      if (!(child instanceof HTMLSpanElement)) {
        continue;
      }

      const range = getTokenSourceRange(child);
      if (!range || offset < range.from || offset >= range.to) {
        continue;
      }

      if (range.from === offset && range.to === offset + 1) {
        return child;
      }

      const text = child.textContent ?? "";
      const splitIndex = offset - range.from;
      const beforeText = text.slice(0, splitIndex);
      const cursorText = text.slice(splitIndex, splitIndex + 1) || options.EMPTY_CELL_TEXT;
      const afterText = text.slice(splitIndex + 1);
      const fragment = document.createDocumentFragment();

      if (beforeText.length > 0) {
        fragment.append(cloneTokenSpan(child, beforeText, range.from, offset));
      }

      const cursorToken = cloneTokenSpan(child, cursorText, offset, offset + 1);
      fragment.append(cursorToken);

      if (afterText.length > 0) {
        fragment.append(cloneTokenSpan(child, afterText, offset + 1, range.to));
      }

      child.replaceWith(fragment);
      return cursorToken;
    }

    return null;
  };

  const setBlockCursorToken = (token: HTMLSpanElement | null, active: boolean): void => {
    if (!token) {
      return;
    }

    token.classList.toggle("wx-cursor-block", active);
    token.classList.toggle("wx-is-selected", active);

    if (active) {
      token.dataset.wxEditorCursor = "true";
      token.dataset.wxEditorCursorKind = "block";
    } else {
      delete token.dataset.wxEditorCursor;
      delete token.dataset.wxEditorCursorKind;
    }
  };

  const getCaretMetrics = () => {
    const metrics = options.getMetrics();
    const height = Math.max(14, Math.round(metrics.lineHeight * 0.84));
    const top = Math.max(0, Math.round((metrics.lineHeight - height) / 2));
    return { height, top };
  };

  const ensureLineCursor = (view: RowView, column: number): void => {
    const existing =
      view.content.querySelector<HTMLElement>("[data-wx-editor-cursor='true'][data-wx-editor-cursor-kind='line']") ??
      document.createElement("span");
    const metrics = options.getMetrics();
    const { height, top } = getCaretMetrics();

    existing.className = "wx-cursor-line";
    existing.dataset.wxEditorCursor = "true";
    existing.dataset.wxEditorCursorKind = "line";
    existing.style.left = `${column * metrics.charWidth}px`;
    existing.style.top = `${top}px`;
    existing.style.height = `${height}px`;

    if (!existing.parentElement) {
      view.content.append(existing);
    }
  };

  return {
    createRowView(visualRowIndex) {
      const visualRow = options.getVisualRow(visualRowIndex);
      const host = document.createElement("div");
      const row = document.createElement("div");
      const gutter = document.createElement("div");
      const content = document.createElement("div");

      host.className = "wx-editor__line-group";
      row.className = "wx-editor__row";
      row.dataset.wxEditorRow = String(visualRow.docLine + 1);
      row.dataset.wxEditorVisualRow = String(visualRowIndex + 1);

      gutter.className = "wx-editor__gutter";
      gutter.dataset.wxEditorGutter = String(visualRow.docLine + 1);

      content.className = "wx-editor__content";
      content.dataset.wxEditorContent = String(visualRow.docLine + 1);

      row.append(gutter, content);
      host.append(row);

      return {
        visualRowIndex,
        host,
        row,
        gutter,
        content
      };
    },
    tryPatchSimpleCursorMove(previousState, nextState) {
      const uiState = options.getUiState();
      if (uiState.flash.active || uiState.pendingAction !== null) {
        return false;
      }

      const isSimpleSelection = (targetState: EditorState): boolean => {
        if (targetState.selection.ranges.length !== 1) {
          return false;
        }

        const selection = getSelectionOffsets(targetState);
        return targetState.mode === "insert" ? selection.from === selection.to : selection.to === selection.from + 1;
      };

      if (!isSimpleSelection(previousState) || !isSimpleSelection(nextState)) {
        return false;
      }

      if (previousState.mode !== nextState.mode || (nextState.mode !== "normal" && nextState.mode !== "insert")) {
        return false;
      }

      const previousOffset =
        previousState.mode === "insert"
          ? getCursorOffset(previousState.selection)
          : getActiveCharacterOffset(previousState);
      const nextOffset =
        nextState.mode === "insert" ? getCursorOffset(nextState.selection) : getActiveCharacterOffset(nextState);

      if (previousOffset === nextOffset) {
        return false;
      }

      const visualRows = options.getVisualRows();
      const lineVisualRanges = options.getLineVisualRanges();
      const softWrap = options.getSoftWrap();
      const wrapColumns = options.getWrapColumns();
      const previousVisual = getLayoutVisualRowForOffset(
        previousState,
        visualRows,
        lineVisualRanges,
        previousOffset,
        softWrap,
        softWrap ? Math.max(1, wrapColumns) : Number.MAX_SAFE_INTEGER
      );
      const nextVisual = getLayoutVisualRowForOffset(
        nextState,
        visualRows,
        lineVisualRanges,
        nextOffset,
        softWrap,
        softWrap ? Math.max(1, wrapColumns) : Number.MAX_SAFE_INTEGER
      );

      if (
        options.getLineDiagnostics(previousVisual.row.docLine).length > 0 ||
        options.getLineDiagnostics(nextVisual.row.docLine).length > 0
      ) {
        return false;
      }

      const previousView = options.getRowViewByVisualRowIndex(previousVisual.rowIndex);
      const nextView = options.getRowViewByVisualRowIndex(nextVisual.rowIndex);

      if (!previousView || !nextView) {
        return false;
      }

      previousView.row.classList.toggle("wx-row-active", previousVisual.rowIndex === nextVisual.rowIndex);
      nextView.row.classList.add("wx-row-active");
      previousView.gutter.querySelector<HTMLElement>(".wx-editor__gutter-number")?.setAttribute(
        "data-active",
        String(previousVisual.rowIndex === nextVisual.rowIndex)
      );
      nextView.gutter.querySelector<HTMLElement>(".wx-editor__gutter-number")?.setAttribute("data-active", "true");

      if (nextState.mode === "insert") {
        options.root
          .querySelectorAll<HTMLElement>("[data-wx-editor-cursor='true'][data-wx-editor-cursor-kind='line']")
          .forEach((cursor) => cursor.remove());
        ensureLineCursor(nextView, nextVisual.column);
        return true;
      }

      options.root
        .querySelectorAll<HTMLSpanElement>("[data-wx-editor-cursor='true'][data-wx-editor-cursor-kind='block']")
        .forEach((token) => setBlockCursorToken(token, false));

      const lineText = nextView.content.querySelector<HTMLElement>(".wx-editor__line-text");
      if (!lineText) {
        return false;
      }

      const nextToken = findOrSplitTokenAtOffset(lineText, nextOffset);
      if (!nextToken) {
        return false;
      }

      setBlockCursorToken(nextToken, true);
      return true;
    },
    patchRowView(view, layoutRow) {
      const metrics = options.getMetrics();
      const visualRowIndex = layoutRow.visualRowIndex;
      const lineIndex = layoutRow.docLine;
      const gutterMarker = document.createElement("span");
      const gutterNumber = document.createElement("span");
      const gutterChange = document.createElement("span");
      const lineText = document.createElement("span");
      const markerRun = layoutRow.gutterRuns.find((run) => run.part === "gutter-marker");
      const numberRun = layoutRow.gutterRuns.find((run) => run.part === "gutter-number");
      const changeRun = layoutRow.gutterRuns.find((run) => run.part === "gutter-change");

      view.visualRowIndex = visualRowIndex;
      view.row.dataset.wxEditorRow = String(lineIndex + 1);
      view.row.dataset.wxEditorVisualRow = String(visualRowIndex + 1);
      view.gutter.dataset.wxEditorGutter = String(lineIndex + 1);
      view.content.dataset.wxEditorContent = String(lineIndex + 1);
      gutterMarker.className = "wx-editor__gutter-marker";
      gutterMarker.dataset.severity = markerRun?.severity ?? "";
      gutterMarker.dataset.wxEditorDiagnosticMarker = markerRun?.severity ?? "";
      gutterNumber.className = "wx-editor__gutter-number";
      gutterNumber.dataset.active = String(layoutRow.isActive);
      gutterNumber.dataset.jump = String(layoutRow.isJumpHighlighted);
      gutterNumber.textContent = numberRun?.text ?? String(lineIndex + 1);
      gutterChange.className = "wx-editor__gutter-change";
      gutterChange.dataset.change = changeRun?.lineChangeKind ?? "";
      gutterChange.dataset.deleted = String(changeRun?.deleted ?? false);
      gutterChange.dataset.wxEditorLineChange = changeRun?.lineChangeKind ?? (changeRun?.deleted ? "deleted" : "");
      view.gutter.replaceChildren(gutterMarker, gutterNumber, gutterChange);
      view.row.classList.toggle("wx-row-active", layoutRow.isActive);
      view.row.classList.toggle("wx-row-jump-highlighted", layoutRow.isJumpHighlighted);
      view.content.replaceChildren();
      view.host.replaceChildren(view.row);
      lineText.className = "wx-editor__line-text";
      view.content.append(lineText);

      for (const segment of layoutRow.contentRuns) {
        const token = document.createElement("span");
        token.className = "wx-token";
        const highlightRole = tokenToHighlightRole(segment.token);
        const severity = segment.severity ?? tokenToDiagnosticSeverity(segment.token);

        if (highlightRole) {
          token.classList.add(roleClassName(highlightRole));
        }

        addClassName(token, "wx-is-selected", !!segment.selected);
        addClassName(token, "wx-search-match", !!segment.searchMatch);
        addClassName(token, "wx-search-current", !!segment.currentSearchMatch);
        addClassName(token, "wx-flash-target", !!segment.flashTarget);
        addClassName(token, "wx-indent-guide", !!segment.isIndentGuide);
        if (severity) {
          token.classList.add(diagnosticClassName(severity));
        }

        if (segment.cursorBlock) {
          token.classList.add("wx-cursor-block");
          token.dataset.wxEditorCursor = "true";
          token.dataset.wxEditorCursorKind = "block";
        }

        if (segment.sourceRange) {
          token.dataset.wxEditorOffset = String(segment.sourceRange.from);
          token.dataset.wxEditorOffsetEnd = String(segment.sourceRange.to);
        }

        token.textContent = segment.text;
        lineText.append(token);
      }

      const flashHints = layoutRow.overlays.filter((overlay) => overlay.kind === "flash-hint");

      if (flashHints.length > 0) {
        const flashLayer = document.createElement("div");
        flashLayer.className = "wx-editor__flash-layer";

        for (const hint of flashHints) {
          const marker = document.createElement("span");
          marker.className = "wx-editor__flash-hint";
          marker.dataset.wxEditorFlashHint = hint.text;
          marker.style.left = `${Math.max(0, hint.col) * metrics.charWidth}px`;
          marker.style.width = `${Math.max(1, hint.text.length) * metrics.charWidth}px`;
          marker.textContent = hint.text;
          flashLayer.append(marker);
        }

        view.content.append(flashLayer);
      }

      for (const overlay of layoutRow.overlays) {
        if (overlay.kind !== "inline-diagnostic" || overlay.row !== 0) {
          continue;
        }

        const note = document.createElement("span");
        note.className = "wx-editor__eol-diagnostic";
        note.dataset.severity = overlay.severity;
        note.dataset.wxEditorDiagnosticNote = "eol";
        note.textContent = `  ${overlay.text}`;
        view.content.append(note);
      }

      for (const overlay of layoutRow.overlays) {
        if (overlay.kind !== "inline-diagnostic" || overlay.row !== 1) {
          continue;
        }

        const detailRow = document.createElement("div");
        const detailGutter = document.createElement("div");
        const detailContent = document.createElement("div");
        const detail = document.createElement("div");
        const hook = document.createElement("span");
        const text = document.createElement("span");
        detailRow.className = "wx-editor__diagnostic-row";
        detailGutter.className = "wx-editor__diagnostic-gutter";
        detailContent.className = "wx-editor__diagnostic-content";
        detailGutter.textContent = " ";
        detail.className = "wx-editor__inline-diagnostic";
        detail.dataset.severity = overlay.severity;
        detail.dataset.wxEditorDiagnosticNote = "inline";
        detail.style.marginLeft = `${overlay.col * metrics.charWidth}px`;
        hook.className = "wx-editor__inline-diagnostic-hook";
        hook.dataset.wxEditorDiagnosticHook = overlay.severity;
        text.className = "wx-editor__inline-diagnostic-text";
        text.textContent = overlay.text;
        detail.append(hook, text);
        detailContent.append(detail);
        detailRow.append(detailGutter, detailContent);
        view.host.append(detailRow);
      }

      const cursorLine = layoutRow.overlays.find((overlay) => overlay.kind === "cursor-line");

      if (cursorLine) {
        const caret = document.createElement("span");
        const caretHeight = Math.max(14, Math.round(metrics.lineHeight * 0.84));
        const caretTop = Math.max(0, Math.round((metrics.lineHeight - caretHeight) / 2));

        caret.className = "wx-cursor-line";
        caret.dataset.wxEditorCursor = "true";
        caret.dataset.wxEditorCursorKind = "line";
        caret.style.left = `${cursorLine.col * metrics.charWidth}px`;
        caret.style.top = `${caretTop}px`;
        caret.style.height = `${caretHeight}px`;
        view.content.append(caret);
      }
    },
    renderVisibleRows(force = false) {
      const visibleViewport = options.getVisibleViewport();

      if (!force && options.getRenderedViewport().fromLine === visibleViewport.fromLine && options.getRenderedViewport().toLine === visibleViewport.toLine && options.getCurrentLayoutModel()) {
        return;
      }

      options.setRenderedViewport(visibleViewport);
      const layout = options.buildLayoutModelForViewport(visibleViewport);
      const nextRows = layout.document.rows;
      const nextFillerCount = Math.max(0, options.getVisibleLineCapacity() - nextRows.length);
      const rowViews = options.getRowViews();

      if (rowViews.length === nextRows.length && options.viewportRows.children.length === nextRows.length + nextFillerCount) {
        for (let index = 0; index < nextRows.length; index += 1) {
          const view = rowViews[index];
          const layoutRow = nextRows[index];
          if (!view || !layoutRow) {
            force = true;
            break;
          }
          this.patchRowView(view, layoutRow);
        }
        if (!force) {
          let fillerIndex = 0;
          for (let index = nextRows.length; index < options.viewportRows.children.length; index += 1) {
            const fillerRow = options.viewportRows.children[index] as HTMLDivElement;
            const fillerNumber = fillerRow.querySelector(".wx-editor__gutter-number");
            if (fillerNumber) {
              fillerNumber.textContent = fillerIndex === 0 ? "~" : " ";
            }
            fillerRow.dataset.wxEditorFillerRow = String(fillerIndex);
            fillerIndex += 1;
          }
          return;
        }
      }

      const nextRowViews: RowView[] = [];
      const fragment = document.createDocumentFragment();

      for (const row of nextRows) {
        const view = this.createRowView(row.visualRowIndex);
        this.patchRowView(view, row);
        nextRowViews.push(view);
        fragment.append(view.host);
      }

      for (let index = 0; index < nextFillerCount; index += 1) {
        const fillerRow = document.createElement("div");
        const fillerGutter = document.createElement("div");
        const fillerMarker = document.createElement("span");
        const fillerNumber = document.createElement("span");
        const fillerChange = document.createElement("span");
        const fillerContent = document.createElement("div");

        fillerRow.className = "wx-editor__filler-row";
        fillerGutter.className = "wx-editor__filler-gutter";
        fillerMarker.className = "wx-editor__gutter-marker";
        fillerNumber.className = "wx-editor__gutter-number";
        fillerChange.className = "wx-editor__gutter-change";
        fillerContent.className = "wx-editor__content";
        fillerChange.dataset.deleted = "false";
        fillerRow.dataset.wxEditorFillerRow = String(index);
        fillerNumber.textContent = index === 0 ? "~" : " ";
        fillerContent.textContent = " ";
        fillerGutter.append(fillerMarker, fillerNumber, fillerChange);
        fillerRow.append(fillerGutter, fillerContent);
        fragment.append(fillerRow);
      }

      options.setRowViews(nextRowViews);
      options.viewportRows.replaceChildren(fragment);
    },
    renderDirtyRows(dirtyLines) {
      const visibleViewport = options.getVisibleViewport();
      const renderedViewport = options.getRenderedViewport();

      if (renderedViewport.fromLine !== visibleViewport.fromLine || renderedViewport.toLine !== visibleViewport.toLine) {
        return false;
      }

      const nextRows = options.getPresentation().viewport.visibleVisualRows;
      const nextFillerCount = Math.max(0, options.getVisibleLineCapacity() - nextRows.length);
      const rowViews = options.getRowViews();

      if (rowViews.length !== nextRows.length || options.viewportRows.children.length !== nextRows.length + nextFillerCount) {
        return false;
      }

      const state = options.getState();
      const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
      const visualRows = options.getVisualRows();
      const lineVisualRanges = options.getLineVisualRanges();
      const softWrap = options.getSoftWrap();
      const wrapColumns = options.getWrapColumns();
      const activeRow = getLayoutVisualRowForOffset(
        state,
        visualRows,
        lineVisualRanges,
        activeOffset,
        softWrap,
        softWrap ? Math.max(1, wrapColumns) : Number.MAX_SAFE_INTEGER
      );
      let patchedAnyRow = false;

      for (let index = 0; index < nextRows.length; index += 1) {
        const view = rowViews[index];
        const visualRow = nextRows[index];

        if (!view || !visualRow) {
          return false;
        }

        if (!dirtyLines.has(visualRow.docLine)) {
          continue;
        }

        const metrics = options.getMetrics();
        const hoverAnchor = options.getHoverAnchor();
        const layoutRow = buildEditorLayoutRow(
          {
            state,
            presentation: options.getPresentation(),
            hoverAnchor: {
              col: Math.max(0, Math.floor(hoverAnchor.left / Math.max(metrics.charWidth, 1))),
              row: Math.max(0, Math.floor(hoverAnchor.top / Math.max(metrics.lineHeight, 1)))
            },
            indentGuides: options.indentGuides
          },
          visualRow,
          { activeOffset, activeRow }
        );
        this.patchRowView(view, layoutRow);
        patchedAnyRow = true;
      }

      return patchedAnyRow;
    }
  };
}
