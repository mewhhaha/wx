import {
  applyTransaction,
  appendInsertMode,
  createEditorState,
  createSelection,
  deleteBackward,
  deleteForward,
  enterInsertMode,
  enterNormalMode,
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets,
  insertNewline,
  insertText,
  moveDown,
  moveWordBackward,
  moveWordForward,
  gotoFileStart,
  gotoFirstNonWhitespace,
  gotoLastLine,
  gotoLineEnd,
  gotoLineStart,
  moveLeft,
  moveRight,
  moveUp,
  pasteAfter,
  selectAll,
  toggleVisualMode,
  yankSelection,
  type Command,
  type EditorState,
  type TextChange,
  type Transaction
} from "@whx/editor-core";
import type { HighlightRole, HighlightSpan, LanguageProvider } from "@whx/editor-language";
import { defaultTheme, createThemeVariables, type ThemeSpec } from "@whx/editor-theme";

export interface CreateEditorOptions {
  filePath?: string;
  value?: string;
  language?: LanguageProvider | null;
  theme?: ThemeSpec;
}

export interface EditorHandle {
  destroy(): void;
  focus(): void;
  getState(): EditorState;
  setFilePath(filePath: string): void;
  setLanguage(language: LanguageProvider | null): Promise<void>;
  setTheme(theme: ThemeSpec): void;
  setValue(value: string): Promise<void>;
}

interface LineFragment {
  text: string;
  role: HighlightRole;
  isSelected: boolean;
  isCursor: boolean;
  cursorKind: "block" | null;
}

interface CommandLineState {
  active: boolean;
  value: string;
}

type PendingChord = "g" | null;

const SURFACE_VERTICAL_PADDING = 16;
const EMPTY_CELL_TEXT = "\u00a0";
const HIGHLIGHT_CONTEXT_LINES = 2;
const VIEWPORT_OVERSCAN_LINES = 6;

interface RowView {
  lineIndex: number;
  row: HTMLDivElement;
  gutter: HTMLDivElement;
  content: HTMLDivElement;
}

interface LineViewport {
  fromLine: number;
  toLine: number;
}

function addClassName(element: Element, className: string, when: boolean): void {
  if (when) {
    element.classList.add(className);
  }
}

function roleClassName(role: HighlightRole): string {
  return `whx-role-${role}`;
}

function mountStyles(styleHost: HTMLElement): void {
  if (styleHost.querySelector("style[data-whx-style='true']")) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.dataset.whxStyle = "true";
  styleElement.textContent = `
    .whx-editor {
      position: relative;
      display: flex;
      flex-direction: column;
      min-height: 240px;
      overflow: hidden;
      background: var(--whx-color-background);
      color: var(--whx-color-text);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 18px;
      font: 15px/1.6 "Iosevka Web", "SFMono-Regular", "Monaco", monospace;
      box-shadow: 0 24px 80px rgba(2, 8, 23, 0.28);
    }

    .whx-editor__surface {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
      padding: 16px 0;
      outline: none;
    }

    .whx-editor__input {
      position: absolute;
      inset: 0;
      opacity: 0;
      pointer-events: none;
      resize: none;
      width: 1px;
      height: 1px;
    }

    .whx-editor__rows {
      position: relative;
      z-index: 1;
    }

    .whx-editor__spacer {
      height: 0;
      pointer-events: none;
    }

    .whx-editor__row {
      display: grid;
      align-items: center;
      min-height: var(--whx-line-height, 24px);
      white-space: pre;
    }

    .whx-row-active {
      background: color-mix(in srgb, var(--whx-color-current-line) 88%, transparent);
    }

    .whx-editor__gutter {
      padding-right: 14px;
      text-align: right;
      color: var(--whx-color-gutter);
      user-select: none;
    }

    .whx-editor__content {
      position: relative;
      white-space: pre;
      color: var(--whx-color-text);
      min-height: var(--whx-line-height, 24px);
    }

    .whx-role-comment { color: var(--whx-color-comment); }
    .whx-role-function { color: var(--whx-color-function); }
    .whx-role-keyword { color: var(--whx-color-keyword); }
    .whx-role-number { color: var(--whx-color-number); }
    .whx-role-operator { color: var(--whx-color-operator); }
    .whx-role-punctuation { color: var(--whx-color-punctuation); }
    .whx-role-string { color: var(--whx-color-string); }
    .whx-role-type { color: var(--whx-color-type); }

    .whx-is-selected {
      background: var(--whx-color-selection);
      border-radius: 4px;
    }

    .whx-cursor-block {
      display: inline-block;
      min-width: 1ch;
      color: var(--whx-color-cursor-text);
      background: var(--whx-color-cursor);
      border-radius: 4px;
    }

    .whx-cursor-line {
      position: absolute;
      top: 0;
      width: 2px;
      background: var(--whx-color-cursor);
      border-radius: 999px;
      pointer-events: none;
    }

    .whx-editor__status {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      height: var(--whx-line-height, 24px);
      padding: 0 1ch 0 0;
      background: #0b0d12;
      border-top: 1px solid rgba(148, 163, 184, 0.14);
      color: #dbe2f0;
      font-size: 15px;
      line-height: 1;
    }

    .whx-editor__status-mode {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      height: 100%;
      padding: 0 1ch;
      background: #f4f4f5;
      color: #0b0d12;
      font-weight: 700;
      letter-spacing: 0.06em;
    }

    .whx-editor__status-file {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #eef2ff;
    }

    .whx-editor__status-meta {
      display: inline-flex;
      align-items: center;
      gap: 18px;
      color: #c5cedd;
      white-space: nowrap;
    }

    .whx-editor__bottom-row {
      height: var(--whx-line-height, 24px);
      background: #0a0b0f;
      border-top: 1px solid rgba(148, 163, 184, 0.08);
      color: #dbe2f0;
      display: flex;
      align-items: center;
      padding: 0 1ch;
      white-space: pre;
    }

    .whx-editor__bottom-row[data-active="false"] {
      color: transparent;
    }

    .whx-editor__command-prompt {
      color: #eef2ff;
    }

    .whx-editor__command-text {
      color: #dbe2f0;
    }
  `;

  styleHost.append(styleElement);
}

function applyThemeVariables(root: HTMLElement, theme: ThemeSpec): void {
  const variables = createThemeVariables(theme);

  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
}

function measureMetrics(styleHost: HTMLElement): { charWidth: number; lineHeight: number } {
  const probe = document.createElement("span");
  probe.textContent = "MMMMMMMMMM";
  probe.style.font = '15px/1.6 "Iosevka Web", "SFMono-Regular", "Monaco", monospace';
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  styleHost.append(probe);

  const rect = probe.getBoundingClientRect();
  probe.remove();

  const width = rect.width > 0 ? rect.width / 10 : 9;
  const lineHeight = rect.height > 0 ? rect.height : 24;

  return {
    charWidth: width,
    lineHeight
  };
}

function commandForNormalMode(key: string): Command | null {
  switch (key) {
    case "%":
      return selectAll;
    case "a":
      return appendInsertMode;
    case "ArrowLeft":
    case "h":
      return moveLeft;
    case "ArrowRight":
    case "l":
      return moveRight;
    case "ArrowUp":
    case "k":
      return moveUp;
    case "ArrowDown":
    case "j":
      return moveDown;
    case "b":
      return moveWordBackward;
    case "e":
      return moveWordForward;
    case "i":
      return enterInsertMode;
    case "p":
      return pasteAfter;
    case "v":
      return toggleVisualMode;
    case "y":
      return yankSelection;
    default:
      return null;
  }
}

function commandForVisualMode(key: string): Command | null {
  switch (key) {
    case "%":
      return selectAll;
    case "Escape":
      return enterNormalMode;
    case "ArrowLeft":
    case "h":
      return moveLeft;
    case "ArrowRight":
    case "l":
      return moveRight;
    case "ArrowUp":
    case "k":
      return moveUp;
    case "ArrowDown":
    case "j":
      return moveDown;
    case "b":
      return moveWordBackward;
    case "e":
      return moveWordForward;
    case "p":
      return pasteAfter;
    case "v":
      return toggleVisualMode;
    case "y":
      return yankSelection;
    default:
      return null;
  }
}

function commandForInsertMode(key: string): Command | null {
  switch (key) {
    case "Escape":
      return enterNormalMode;
    case "ArrowLeft":
      return moveLeft;
    case "ArrowRight":
      return moveRight;
    case "ArrowUp":
      return moveUp;
    case "ArrowDown":
      return moveDown;
    case "Backspace":
      return deleteBackward;
    case "Delete":
      return deleteForward;
    case "Enter":
      return insertNewline;
    default:
      if (key.length === 1) {
        return insertText(key);
      }

      return null;
  }
}

function movementCommandForDelta(deltaY: number): Command | null {
  if (deltaY > 0) {
    return moveDown;
  }

  if (deltaY < 0) {
    return moveUp;
  }

  return null;
}

function roleAtOffset(spans: HighlightSpan[], offset: number): HighlightRole {
  const span = spans.find((entry) => offset >= entry.from && offset < entry.to);
  return span?.role ?? "text";
}

function selectionFromSyntaxRange(from: number, to: number) {
  return createSelection(from, Math.max(from, to - 1));
}

function commandForGotoPrefix(key: string): Command | null {
  switch (key) {
    case "g":
      return gotoFileStart;
    case "e":
      return gotoLastLine;
    case "h":
      return gotoLineStart;
    case "j":
      return moveDown;
    case "k":
      return moveUp;
    case "l":
      return gotoLineEnd;
    case "s":
      return gotoFirstNonWhitespace;
    default:
      return null;
  }
}

function renderLineFragments(line: { start: number; text: string }, state: EditorState, spans: HighlightSpan[]): LineFragment[] {
  const fragments: LineFragment[] = [];
  const activeOffset = getActiveCharacterOffset(state);
  const selection = getSelectionOffsets(state);
  const lineEnd = line.start + line.text.length;

  if (state.mode === "insert") {
    if (line.text.length === 0) {
      return [
        {
          text: EMPTY_CELL_TEXT,
          role: "text",
          isSelected: false,
          isCursor: false,
          cursorKind: null
        }
      ];
    }

    for (let index = 0; index < line.text.length; index += 1) {
      const offset = line.start + index;

      fragments.push({
        text: line.text[index] ?? EMPTY_CELL_TEXT,
        role: roleAtOffset(spans, offset),
        isSelected: false,
        isCursor: false,
        cursorKind: null
      });
    }

    return fragments;
  }

  if (line.text.length === 0) {
    const selected = selection.from <= line.start && line.start < selection.to;
    return [
      {
        text: EMPTY_CELL_TEXT,
        role: "text",
        isSelected: selected,
        isCursor: activeOffset === line.start,
        cursorKind: activeOffset === line.start ? "block" : null
      }
    ];
  }

  for (let index = 0; index < line.text.length; index += 1) {
    const offset = line.start + index;
    fragments.push({
      text: line.text[index] ?? " ",
      role: roleAtOffset(spans, offset),
      isSelected: offset >= selection.from && offset < selection.to,
      isCursor: offset === activeOffset,
      cursorKind: offset === activeOffset ? "block" : null
    });
  }

  const hasLineEnding = lineEnd < state.doc.length && state.doc.text[lineEnd] === "\n";
  const lineEndingSelected = hasLineEnding && lineEnd >= selection.from && lineEnd < selection.to;
  const lineEndingCursor = hasLineEnding && activeOffset === lineEnd;

  if (lineEndingSelected || lineEndingCursor) {
    fragments.push({
      text: EMPTY_CELL_TEXT,
      role: "text",
      isSelected: lineEndingSelected,
      isCursor: lineEndingCursor,
      cursorKind: lineEndingCursor ? "block" : null
    });
  }

  return fragments;
}

function normalizeViewport(viewport: { fromLine: number; toLine: number }, lineCount: number): { fromLine: number; toLine: number } {
  const maxLine = Math.max(0, lineCount - 1);
  const fromLine = Math.max(0, Math.min(maxLine, viewport.fromLine));
  const toLine = Math.max(fromLine, Math.min(maxLine, viewport.toLine));

  return { fromLine, toLine };
}

export function createEditor(container: HTMLElement, options: CreateEditorOptions = {}): EditorHandle {
  let state = createEditorState({ value: options.value ?? "" });
  let filePath = options.filePath ?? "untitled.ts";
  let language = options.language ?? null;
  let theme = options.theme ?? defaultTheme;
  let highlightCache = new Map<number, HighlightSpan[]>();
  let highlightCoverage = new Set<number>();
  let rowViews: RowView[] = [];
  let renderedViewport: LineViewport = { fromLine: 0, toLine: -1 };
  let commandLine: CommandLineState = { active: false, value: "" };
  let pendingChord: PendingChord = null;
  let languageRevision = -1;
  let lastHighlightedRevision = -1;
  let highlightRequestId = 0;
  let gutterWidth = 0;
  let destroyed = false;

  const root = document.createElement("div");
  const surface = document.createElement("div");
  const rows = document.createElement("div");
  const topSpacer = document.createElement("div");
  const viewportRows = document.createElement("div");
  const bottomSpacer = document.createElement("div");
  const status = document.createElement("div");
  const statusMode = document.createElement("div");
  const statusFile = document.createElement("div");
  const statusMeta = document.createElement("div");
  const bottomRow = document.createElement("div");
  const textarea = document.createElement("textarea");
  const metrics = measureMetrics(container);

  mountStyles(root);
  applyThemeVariables(root, theme);

  root.className = "whx-editor";
  root.dataset.whxEditor = "root";
  root.tabIndex = 0;
  root.style.setProperty("--whx-line-height", `${metrics.lineHeight}px`);

  surface.className = "whx-editor__surface";
  surface.dataset.whxEditor = "surface";

  rows.className = "whx-editor__rows";
  rows.dataset.whxEditor = "rows";

  topSpacer.className = "whx-editor__spacer";
  topSpacer.dataset.whxEditorSpacer = "top";

  viewportRows.dataset.whxEditor = "viewport";

  bottomSpacer.className = "whx-editor__spacer";
  bottomSpacer.dataset.whxEditorSpacer = "bottom";

  status.className = "whx-editor__status";
  status.dataset.whxEditor = "status";

  statusMode.className = "whx-editor__status-mode";
  statusMode.dataset.whxEditorStatusMode = "true";

  statusFile.className = "whx-editor__status-file";
  statusFile.dataset.whxEditorStatusFile = "true";

  statusMeta.className = "whx-editor__status-meta";
  statusMeta.dataset.whxEditorStatusMeta = "true";

  bottomRow.className = "whx-editor__bottom-row";
  bottomRow.dataset.whxEditorBottomRow = "true";

  textarea.className = "whx-editor__input";
  textarea.dataset.whxEditor = "input";
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.autocorrect = "off";

  status.append(statusMode, statusFile, statusMeta);
  rows.append(topSpacer, viewportRows, bottomSpacer);
  surface.append(rows, textarea);
  root.append(surface, status, bottomRow);
  container.replaceChildren(root);

  function getSnapshot() {
    return {
      revision: state.revision,
      doc: state.doc
    };
  }

  function getSelectionLines(targetState: EditorState): Set<number> {
    const lines = new Set<number>();

    if (targetState.mode === "insert") {
      lines.add(targetState.doc.positionAt(getCursorOffset(targetState.selection)).line);
      return lines;
    }

    const selection = getSelectionOffsets(targetState);
    const fromLine = targetState.doc.positionAt(selection.from).line;
    const endOffset = Math.max(selection.from, selection.to - 1);
    const toLine = targetState.doc.positionAt(endOffset).line;

    for (let line = fromLine; line <= toLine; line += 1) {
      lines.add(line);
    }

    return lines;
  }

  function getActiveLine(targetState: EditorState): number {
    const activeOffset =
      targetState.mode === "insert" ? getCursorOffset(targetState.selection) : getActiveCharacterOffset(targetState);
    return targetState.doc.positionAt(activeOffset).line;
  }

  function getVisualDirtyLines(previousState: EditorState, nextState: EditorState): Set<number> {
    const lines = new Set<number>();

    lines.add(getActiveLine(previousState));
    lines.add(getActiveLine(nextState));

    for (const line of getSelectionLines(previousState)) {
      lines.add(line);
    }

    for (const line of getSelectionLines(nextState)) {
      lines.add(line);
    }

    return lines;
  }

  function getChangedLines(previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]): Set<number> {
    const lines = getVisualDirtyLines(previousState, nextState);

    for (const change of changes) {
      const previousStartLine = previousState.doc.positionAt(change.from).line;
      const previousEndLine = previousState.doc.positionAt(change.to > change.from ? change.to - 1 : change.from).line;
      const nextStartLine = nextState.doc.positionAt(change.from).line;
      const nextEndOffset = change.insert.length > 0 ? change.from + change.insert.length - 1 : change.from;
      const nextEndLine = nextState.doc.positionAt(Math.min(nextEndOffset, nextState.doc.length)).line;
      const fromLine = Math.min(previousStartLine, nextStartLine);
      const toLine = Math.max(previousEndLine, nextEndLine);

      for (let line = fromLine; line <= toLine; line += 1) {
        lines.add(line);
      }
    }

    return lines;
  }

  function getHighlightViewportsForChanges(
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ): {
    previousViewport: { fromLine: number; toLine: number };
    nextViewport: { fromLine: number; toLine: number };
  } {
    let previousFromLine = Number.POSITIVE_INFINITY;
    let previousToLine = 0;
    let nextFromLine = Number.POSITIVE_INFINITY;
    let nextToLine = 0;

    for (const change of changes) {
      const previousStartLine = previousState.doc.positionAt(change.from).line;
      const previousEndLine = previousState.doc.positionAt(change.to > change.from ? change.to - 1 : change.from).line;
      const nextStartLine = nextState.doc.positionAt(change.from).line;
      const nextEndOffset = change.insert.length > 0 ? change.from + change.insert.length - 1 : change.from;
      const nextEndLine = nextState.doc.positionAt(Math.min(nextEndOffset, nextState.doc.length)).line;

      previousFromLine = Math.min(previousFromLine, previousStartLine);
      previousToLine = Math.max(previousToLine, previousEndLine);
      nextFromLine = Math.min(nextFromLine, nextStartLine);
      nextToLine = Math.max(nextToLine, nextEndLine);
    }

    return {
      previousViewport: normalizeViewport(
        {
          fromLine: previousFromLine - HIGHLIGHT_CONTEXT_LINES,
          toLine: previousToLine + HIGHLIGHT_CONTEXT_LINES
        },
        previousState.doc.lineCount
      ),
      nextViewport: normalizeViewport(
        {
          fromLine: nextFromLine - HIGHLIGHT_CONTEXT_LINES,
          toLine: nextToLine + HIGHLIGHT_CONTEXT_LINES
        },
        nextState.doc.lineCount
      )
    };
  }

  function createRowView(lineIndex: number): RowView {
    const row = document.createElement("div");
    const gutter = document.createElement("div");
    const content = document.createElement("div");

    row.className = "whx-editor__row";
    row.dataset.whxEditorRow = String(lineIndex + 1);

    gutter.className = "whx-editor__gutter";
    gutter.dataset.whxEditorGutter = String(lineIndex + 1);

    content.className = "whx-editor__content";
    content.dataset.whxEditorContent = String(lineIndex + 1);

    row.append(gutter, content);

    return {
      lineIndex,
      row,
      gutter,
      content
    };
  }

  function viewportEquals(left: LineViewport, right: LineViewport): boolean {
    return left.fromLine === right.fromLine && left.toLine === right.toLine;
  }

  function refreshGutterWidth(force = false): void {
    const nextWidth = Math.max(2, String(Math.max(1, state.doc.lineCount)).length) * metrics.charWidth + 24;

    if (!force && nextWidth === gutterWidth) {
      return;
    }

    gutterWidth = nextWidth;

    for (const view of rowViews) {
      view.row.style.gridTemplateColumns = `${gutterWidth}px 1fr`;
    }
  }

  function getLineHighlights(lineIndex: number): HighlightSpan[] {
    return highlightCache.get(lineIndex) ?? [];
  }

  function patchRowView(view: RowView, lineIndex: number): void {
    const line = state.doc.lineAt(lineIndex);
    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const cursorPosition = state.doc.positionAt(activeOffset);

    view.lineIndex = lineIndex;
    view.row.dataset.whxEditorRow = String(lineIndex + 1);
    view.gutter.dataset.whxEditorGutter = String(lineIndex + 1);
    view.content.dataset.whxEditorContent = String(lineIndex + 1);
    view.gutter.textContent = String(lineIndex + 1);
    view.row.classList.toggle("whx-row-active", lineIndex === cursorPosition.line);
    view.content.replaceChildren();

    for (const segment of renderLineFragments(line, state, getLineHighlights(lineIndex))) {
      const token = document.createElement("span");
      token.className = "whx-token";
      token.classList.add(roleClassName(segment.role));
      addClassName(token, "whx-is-selected", segment.isSelected);

      if (segment.isCursor) {
        token.classList.add("whx-cursor-block");
        token.dataset.whxEditorCursor = "true";
        token.dataset.whxEditorCursorKind = segment.cursorKind ?? "";
      }

      token.textContent = segment.text;
      view.content.append(token);
    }

    if (state.mode === "insert" && lineIndex === cursorPosition.line) {
      const caret = document.createElement("span");
      const caretHeight = Math.max(14, Math.round(metrics.lineHeight * 0.84));
      const caretTop = Math.max(0, Math.round((metrics.lineHeight - caretHeight) / 2));

      caret.className = "whx-cursor-line";
      caret.dataset.whxEditorCursor = "true";
      caret.dataset.whxEditorCursorKind = "line";
      caret.style.left = `${cursorPosition.column * metrics.charWidth}px`;
      caret.style.top = `${caretTop}px`;
      caret.style.height = `${caretHeight}px`;
      view.content.append(caret);
    }
  }

  function getVisibleViewport(): LineViewport {
    const lineCount = Math.max(1, state.doc.lineCount);
    const startOffset = Math.max(0, surface.scrollTop - SURFACE_VERTICAL_PADDING);
    const viewportHeight = Math.max(metrics.lineHeight, surface.clientHeight || metrics.lineHeight * 20);
    const visibleLineCount = Math.max(1, Math.ceil(viewportHeight / metrics.lineHeight));
    const fromLine = Math.max(0, Math.floor(startOffset / metrics.lineHeight));
    const toLine = Math.min(lineCount - 1, fromLine + visibleLineCount - 1);

    return { fromLine, toLine };
  }

  function expandViewport(viewport: LineViewport): LineViewport {
    return normalizeViewport(
      {
        fromLine: viewport.fromLine - VIEWPORT_OVERSCAN_LINES,
        toLine: viewport.toLine + VIEWPORT_OVERSCAN_LINES
      },
      state.doc.lineCount
    );
  }

  function getHighlightViewport(viewport: LineViewport): LineViewport {
    return normalizeViewport(
      {
        fromLine: viewport.fromLine - HIGHLIGHT_CONTEXT_LINES,
        toLine: viewport.toLine + HIGHLIGHT_CONTEXT_LINES
      },
      state.doc.lineCount
    );
  }

  function renderVisibleRows(force = false): void {
    const visibleViewport = getVisibleViewport();
    const nextViewport = expandViewport(visibleViewport);

    if (
      !force &&
      renderedViewport.toLine >= renderedViewport.fromLine &&
      visibleViewport.fromLine >= renderedViewport.fromLine &&
      visibleViewport.toLine <= renderedViewport.toLine
    ) {
      return;
    }

    renderedViewport = nextViewport;
    rowViews = [];
    topSpacer.style.height = `${renderedViewport.fromLine * metrics.lineHeight}px`;
    bottomSpacer.style.height = `${Math.max(0, state.doc.lineCount - renderedViewport.toLine - 1) * metrics.lineHeight}px`;

    const fragment = document.createDocumentFragment();

    for (let lineIndex = renderedViewport.fromLine; lineIndex <= renderedViewport.toLine; lineIndex += 1) {
      const view = createRowView(lineIndex);
      view.row.style.gridTemplateColumns = `${gutterWidth}px 1fr`;
      patchRowView(view, lineIndex);
      rowViews.push(view);
      fragment.append(view.row);
    }

    viewportRows.replaceChildren(fragment);
  }

  function patchVisibleLines(lines: Iterable<number>): void {
    const seen = new Set<number>();

    for (const lineIndex of lines) {
      if (
        seen.has(lineIndex) ||
        lineIndex < renderedViewport.fromLine ||
        lineIndex > renderedViewport.toLine
      ) {
        continue;
      }

      seen.add(lineIndex);
      const view = rowViews[lineIndex - renderedViewport.fromLine];

      if (!view) {
        continue;
      }

      patchRowView(view, lineIndex);
    }
  }

  function patchStatus(): void {
    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const cursorPosition = state.doc.positionAt(activeOffset);

    statusMode.textContent = state.mode === "insert" ? "INS" : state.mode === "visual" ? "VIS" : "NOR";
    statusFile.textContent = filePath;
    statusMeta.textContent = `1 sel   ${cursorPosition.line + 1}:${cursorPosition.column + 1}`;
  }

  function patchBottomRow(): void {
    bottomRow.dataset.active = String(commandLine.active);
    bottomRow.replaceChildren();

    if (commandLine.active) {
      const prompt = document.createElement("span");
      const value = document.createElement("span");

      prompt.className = "whx-editor__command-prompt";
      prompt.dataset.whxEditorCommandPrompt = "true";
      prompt.textContent = ":";

      value.className = "whx-editor__command-text";
      value.dataset.whxEditorCommandText = "true";
      value.textContent = commandLine.value;

      bottomRow.append(prompt, value);
      return;
    }

    bottomRow.textContent = " ";
  }

  function buildHighlightCache(spans: HighlightSpan[]): Map<number, HighlightSpan[]> {
    const cache = new Map<number, HighlightSpan[]>();

    for (const span of spans) {
      if (span.to <= span.from) {
        continue;
      }

      const startLine = state.doc.positionAt(span.from).line;
      const endLine = state.doc.positionAt(span.to - 1).line;

      for (let line = startLine; line <= endLine; line += 1) {
        const lineInfo = state.doc.lineAt(line);
        const from = Math.max(span.from, lineInfo.start);
        const to = Math.min(span.to, lineInfo.end);

        if (to <= from) {
          continue;
        }

        const entry = cache.get(line);
        const clipped = { from, to, role: span.role };

        if (entry) {
          entry.push(clipped);
        } else {
          cache.set(line, [clipped]);
        }
      }
    }

    return cache;
  }

  function spansEqual(left: readonly HighlightSpan[], right: readonly HighlightSpan[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((span, index) => {
      const other = right[index];
      return !!other && span.from === other.from && span.to === other.to && span.role === other.role;
    });
  }

  function replaceHighlightCache(
    spans: HighlightSpan[],
    viewport: { fromLine: number; toLine: number }
  ): Set<number> {
    const nextCache = buildHighlightCache(spans);
    const dirty = new Set<number>();

    for (let index = viewport.fromLine; index <= viewport.toLine; index += 1) {
      highlightCoverage.add(index);
      const previous = highlightCache.get(index) ?? [];
      const next = nextCache.get(index) ?? [];

      if (!spansEqual(previous, next)) {
        dirty.add(index);
      }

      if (next.length > 0) {
        highlightCache.set(index, next);
      } else {
        highlightCache.delete(index);
      }
    }

    return dirty;
  }

  async function refreshHighlights(
    viewport = getHighlightViewport(renderedViewport.toLine >= renderedViewport.fromLine ? renderedViewport : expandViewport(getVisibleViewport())),
    force = false
  ): Promise<void> {
    if (!language || languageRevision < 0) {
      if (highlightCache.size > 0) {
        highlightCache.clear();
        highlightCoverage.clear();
        renderVisibleRows(true);
      }
      return;
    }

    const needsViewportHighlights =
      force ||
      lastHighlightedRevision !== languageRevision ||
      Array.from({ length: viewport.toLine - viewport.fromLine + 1 }, (_, index) => viewport.fromLine + index)
        .some((lineIndex) => !highlightCoverage.has(lineIndex));

    if (!needsViewportHighlights) {
      return;
    }

    const requestId = ++highlightRequestId;
    const next = await language.getHighlightRanges(viewport, languageRevision);

    if (destroyed || requestId !== highlightRequestId) {
      return;
    }

    const dirty = replaceHighlightCache(next, viewport);
    lastHighlightedRevision = languageRevision;
    if (Array.from(dirty).some((lineIndex) => lineIndex >= renderedViewport.fromLine && lineIndex <= renderedViewport.toLine)) {
      patchVisibleLines(dirty);
    }
  }

  async function syncLanguage(
    changes: readonly TextChange[] = [],
    forceDocumentSync = false,
    viewport?: { fromLine: number; toLine: number }
  ): Promise<void> {
    if (!language) {
      return;
    }

    if (forceDocumentSync || languageRevision < 0) {
      await language.open(getSnapshot());
      languageRevision = state.revision;
      lastHighlightedRevision = -1;
      await refreshHighlights(
        getHighlightViewport(
          renderedViewport.toLine >= renderedViewport.fromLine ? renderedViewport : expandViewport(getVisibleViewport())
        ),
        true
      );
      return;
    }

    if (changes.length === 0) {
      return;
    }

    await language.update(getSnapshot(), changes);
    languageRevision = state.revision;
    lastHighlightedRevision = -1;
    await refreshHighlights(
      viewport ?? getHighlightViewport(renderedViewport.toLine >= renderedViewport.fromLine ? renderedViewport : expandViewport(getVisibleViewport())),
      true
    );
  }

  function dispatch(transaction: Transaction): void {
    const previousState = state;
    const nextState = applyTransaction(state, transaction);
    const changes = transaction.changes ?? [];
    const hasDocumentChanges = changes.length > 0;
    const previousDigits = String(Math.max(1, previousState.doc.lineCount)).length;
    const nextDigits = String(Math.max(1, nextState.doc.lineCount)).length;
    const lineStructureChanged = previousState.doc.lineCount !== nextState.doc.lineCount;

    state = nextState;

    if (hasDocumentChanges) {
      lastHighlightedRevision = -1;
      highlightCache.clear();
      highlightCoverage.clear();

      if (previousDigits !== nextDigits) {
        refreshGutterWidth(true);
      }

      patchStatus();
      patchBottomRow();
      revealCursor();
      renderVisibleRows(true);
      void syncLanguage(changes, false, getHighlightViewport(renderedViewport));
      return;
    }

    if (previousDigits !== nextDigits) {
      refreshGutterWidth(true);
    }

    patchStatus();
    patchBottomRow();
    const previousViewport = renderedViewport;
    revealCursor();
    renderVisibleRows();

    if (viewportEquals(previousViewport, renderedViewport)) {
      patchVisibleLines(getVisualDirtyLines(previousState, nextState));
    }
  }

  function openCommandLine(): void {
    pendingChord = null;
    commandLine = { active: true, value: "" };
    patchBottomRow();
  }

  function closeCommandLine(): void {
    commandLine = { active: false, value: "" };
    patchBottomRow();
  }

  function runCommand(command: Command): boolean {
    return command(state, dispatch, {
      requestFocus() {
        textarea.focus();
      }
    });
  }

  function revealCursor(): void {
    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const cursorPosition = state.doc.positionAt(activeOffset);
    const rowTop = SURFACE_VERTICAL_PADDING + cursorPosition.line * metrics.lineHeight;
    const rowBottom = rowTop + metrics.lineHeight;
    const viewportTop = surface.scrollTop;
    const viewportBottom = viewportTop + surface.clientHeight;

    if (rowTop < viewportTop) {
      surface.scrollTop = rowTop;
      return;
    }

    if (rowBottom > viewportBottom) {
      surface.scrollTop = rowBottom - surface.clientHeight;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      state.mode !== "insert" &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      const syntaxSelection =
        event.key === "ArrowUp" ? language?.expandSelection?.bind(language) : language?.shrinkSelection?.bind(language);

      if (syntaxSelection) {
        const revision = state.revision;
        const syntaxRevision = languageRevision;
        const selection = getSelectionOffsets(state);
        const activeOffset = getActiveCharacterOffset(state);

        event.preventDefault();
        void syntaxSelection(selection, activeOffset, syntaxRevision).then((nextSelection) => {
          if (!nextSelection || destroyed || state.revision !== revision || nextSelection.to <= nextSelection.from) {
            return;
          }

          dispatch({
            selection: selectionFromSyntaxRange(nextSelection.from, nextSelection.to)
          });
        });
      }
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (commandLine.active) {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        closeCommandLine();
        textarea.focus();
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        commandLine = {
          ...commandLine,
          value: commandLine.value.slice(0, -1)
        };
        patchBottomRow();
        return;
      }

      if (event.key.length === 1) {
        event.preventDefault();
        commandLine = {
          ...commandLine,
          value: `${commandLine.value}${event.key}`
        };
        patchBottomRow();
      }
      return;
    }

    if (pendingChord) {
      const chordCommand = pendingChord === "g" ? commandForGotoPrefix(event.key) : null;
      pendingChord = null;

      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }

      if (chordCommand) {
        event.preventDefault();
        textarea.value = "";
        runCommand(chordCommand);
        return;
      }
    }

    if ((state.mode === "normal" || state.mode === "visual") && event.key === ":") {
      event.preventDefault();
      textarea.value = "";
      openCommandLine();
      return;
    }

    if ((state.mode === "normal" || state.mode === "visual") && event.key === "g") {
      event.preventDefault();
      pendingChord = "g";
      return;
    }

    const command =
      state.mode === "normal"
        ? commandForNormalMode(event.key)
        : state.mode === "visual"
          ? commandForVisualMode(event.key)
          : commandForInsertMode(event.key);

    if (!command) {
      return;
    }

    event.preventDefault();
    textarea.value = "";
    runCommand(command);
  }

  function handleWheel(event: WheelEvent): void {
    if (event.metaKey || event.ctrlKey || commandLine.active) {
      return;
    }

    const command = movementCommandForDelta(event.deltaY);

    if (!command) {
      return;
    }

    event.preventDefault();
    textarea.focus();
    textarea.value = "";
    runCommand(command);
  }

  function handleScroll(): void {
    renderVisibleRows();
    void refreshHighlights(getHighlightViewport(renderedViewport), false);
  }

  root.addEventListener("focus", () => {
    if (document.activeElement !== textarea) {
      textarea.focus();
    }
  });
  root.addEventListener("mousedown", () => {
    textarea.focus();
  });
  textarea.addEventListener("keydown", handleKeydown);
  surface.addEventListener("wheel", handleWheel, { passive: false });
  surface.addEventListener("scroll", handleScroll);

  refreshGutterWidth(true);
  renderVisibleRows(true);
  patchStatus();
  patchBottomRow();
  void syncLanguage([], true);

  return {
    destroy() {
      destroyed = true;
      language?.destroy?.();
      root.remove();
    },
    focus() {
      textarea.focus();
    },
    getState() {
      return state;
    },
    setFilePath(nextFilePath: string) {
      filePath = nextFilePath;
      patchStatus();
    },
    async setLanguage(nextLanguage: LanguageProvider | null) {
      language?.destroy?.();
      language = nextLanguage;
      languageRevision = -1;
      lastHighlightedRevision = -1;
      highlightCache.clear();
      highlightCoverage.clear();
      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
      await syncLanguage([], true);
    },
    setTheme(nextTheme: ThemeSpec) {
      theme = nextTheme;
      applyThemeVariables(root, theme);
      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
    },
    async setValue(value: string) {
      state = createEditorState({ value, selection: createSelection(0, 0) });
      languageRevision = -1;
      lastHighlightedRevision = -1;
      highlightCache.clear();
      highlightCoverage.clear();
      surface.scrollTop = 0;
      refreshGutterWidth(true);
      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
      await syncLanguage([], true);
    }
  };
}
