import {
  appendInsertMode,
  createEditorState,
  createSelection,
  deleteSelection,
  deleteBackward,
  deleteForward,
  enterInsertMode,
  enterNormalMode,
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets,
  mapOffsetThroughChanges,
  gotoMatchingBracket,
  gotoNextParagraph,
  gotoPrevParagraph,
  gotoWindowBottom,
  gotoWindowCenter,
  gotoWindowTop,
  halfPageDown,
  halfPageUp,
  insertNewline,
  insertText,
  findNextChar,
  findPrevChar,
  findTillNextChar,
  findTillPrevChar,
  moveDown,
  moveNextLongWordEnd,
  moveNextLongWordStart,
  moveNextWordStart,
  movePrevLongWordStart,
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
  pageDown,
  pageUp,
  openAbove,
  openBelow,
  pasteAfter,
  redo,
  selectAll,
  selectLineBelow,
  selectTextobject,
  toggleVisualMode,
  undo,
  yankSelection,
  type Command,
  type EditorState,
  type TextChange
} from "@wx/editor-core";
import {
  createEditorController,
  type EditorController,
  type EditorUpdate
} from "@wx/editor-controller";
import type {
  DiagnosticSeverity,
  EditorCodeAction,
  EditorDiagnostic,
  EditorHover,
  EditorLanguageServices,
  EditorLineRange,
  HighlightRole,
  HighlightSpan,
  LanguageProvider
} from "@wx/editor-language";
import { languageProviderToServices } from "@wx/editor-language";
import { defaultTheme, createThemeVariables, type ThemeSpec } from "@wx/editor-theme";

export interface CreateEditorOptions {
  controller?: EditorController;
  filePath?: string;
  value?: string;
  language?: LanguageProvider | null;
  languageServices?: EditorLanguageServices | null;
  theme?: ThemeSpec;
}

export interface EditorHandle {
  controller: EditorController;
  mount(container: HTMLElement): void;
  destroy(): void;
  focus(): void;
  format(): Promise<boolean>;
  getCodeActions(): Promise<readonly EditorCodeAction[]>;
  applyCodeAction(action: EditorCodeAction): Promise<boolean>;
  subscribe(listener: (update: EditorUpdate) => void): () => void;
  getState(): EditorState;
  setFilePath(filePath: string): void;
  setLanguageServices(languageServices: EditorLanguageServices | null): Promise<void>;
  setLanguage(language: LanguageProvider | null): Promise<void>;
  setTheme(theme: ThemeSpec): void;
  setValue(value: string): Promise<void>;
}

interface LineFragment {
  offset: number | null;
  text: string;
  role: HighlightRole;
  isSelected: boolean;
  isCursor: boolean;
  cursorKind: "block" | null;
  diagnosticSeverity: DiagnosticSeverity | null;
}

interface CommandLineState {
  active: boolean;
  value: string;
}

interface BottomMessageState {
  tone: "info" | "warning" | "error";
  text: string;
}

interface CodeActionMenuState {
  active: boolean;
  loading: boolean;
  actions: readonly EditorCodeAction[];
  selectedIndex: number;
  error: string | null;
}

interface HoverState {
  active: boolean;
  pinned: boolean;
  offset: number | null;
  content: string;
  source?: string;
  tone: "info" | "warning" | "error";
  left: number;
  top: number;
}

type PendingAction =
  | null
  | { kind: "g" }
  | { kind: "[" | "]" }
  | { kind: "m" }
  | { kind: "space" }
  | { kind: "find"; variant: "f" | "F" | "t" | "T" }
  | { kind: "textobject"; mode: "around" | "inside" };

type RepeatableMotion =
  | { kind: "find"; variant: "f" | "F" | "t" | "T"; target: string }
  | { kind: "matching-bracket" }
  | { kind: "paragraph"; direction: "next" | "prev" }
  | { kind: "textobject"; mode: "around" | "inside"; object: string };

const DIAGNOSTIC_SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3
};

const SURFACE_VERTICAL_PADDING = 16;
const EMPTY_CELL_TEXT = "\u00a0";
const HIGHLIGHT_CONTEXT_LINES = 2;
const VIEWPORT_OVERSCAN_LINES = 6;
const END_OF_LINE_DIAGNOSTIC_MIN: DiagnosticSeverity = "hint";
const CURSOR_LINE_INLINE_DIAGNOSTIC_MIN: DiagnosticSeverity = "warning";
const OTHER_LINES_INLINE_DIAGNOSTIC_MIN: DiagnosticSeverity = "error";

interface RowView {
  lineIndex: number;
  host: HTMLDivElement;
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
  return `wx-role-${role}`;
}

function diagnosticClassName(severity: DiagnosticSeverity): string {
  return `wx-diagnostic-${severity}`;
}

function toneForSeverity(severity: DiagnosticSeverity): "info" | "warning" | "error" {
  return severity === "error" ? "error" : severity === "warning" ? "warning" : "info";
}

function meetsDiagnosticThreshold(severity: DiagnosticSeverity, minimum: DiagnosticSeverity): boolean {
  return DIAGNOSTIC_SEVERITY_ORDER[severity] <= DIAGNOSTIC_SEVERITY_ORDER[minimum];
}

function mountStyles(styleHost: HTMLElement): void {
  if (styleHost.querySelector("style[data-wx-style='true']")) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.dataset.wxStyle = "true";
  styleElement.textContent = `
    .wx-editor {
      position: relative;
      display: flex;
      flex-direction: column;
      min-height: 240px;
      overflow: hidden;
      background: var(--wx-color-background);
      color: var(--wx-color-text);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 18px;
      font: 15px/1.6 "Monaspace Argon Var", "Iosevka Web", "SFMono-Regular", "Monaco", monospace;
      box-shadow: 0 24px 80px rgba(2, 8, 23, 0.28);
    }

    .wx-editor__surface {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
      padding: 16px 0;
      outline: none;
    }

    .wx-editor__input {
      position: absolute;
      inset: 0;
      opacity: 0;
      pointer-events: none;
      resize: none;
      width: 1px;
      height: 1px;
    }

    .wx-editor__rows {
      position: relative;
      z-index: 1;
    }

    .wx-editor__spacer {
      height: 0;
      pointer-events: none;
    }

    .wx-editor__row {
      display: grid;
      align-items: center;
      min-height: var(--wx-line-height, 24px);
      white-space: pre;
    }

    .wx-editor__line-group {
      display: block;
    }

    .wx-row-active {
      background: color-mix(in srgb, var(--wx-color-current-line) 88%, transparent);
    }

    .wx-editor__gutter {
      display: inline-grid;
      grid-template-columns: 1ch minmax(0, 1fr);
      align-items: center;
      gap: 0.5ch;
      padding-right: 14px;
      text-align: right;
      color: var(--wx-color-gutter);
      user-select: none;
    }

    .wx-editor__gutter-number {
      display: inline-block;
      min-width: 0;
    }

    .wx-editor__gutter-marker {
      width: 0.55ch;
      height: 0.55ch;
      border-radius: 999px;
      flex: 0 0 auto;
      justify-self: center;
      visibility: hidden;
    }

    .wx-editor__gutter-marker[data-severity="error"] {
      visibility: visible;
      background: var(--wx-color-diagnostic-error);
    }

    .wx-editor__gutter-marker[data-severity="warning"] {
      visibility: visible;
      background: var(--wx-color-diagnostic-warning);
    }

    .wx-editor__gutter-marker[data-severity="info"] {
      visibility: visible;
      background: var(--wx-color-diagnostic-info);
    }

    .wx-editor__gutter-marker[data-severity="hint"] {
      visibility: visible;
      background: var(--wx-color-diagnostic-hint);
    }

    .wx-editor__content {
      position: relative;
      display: flex;
      align-items: baseline;
      justify-content: flex-start;
      color: var(--wx-color-text);
      min-height: var(--wx-line-height, 24px);
      min-width: 0;
      overflow: hidden;
    }

    .wx-editor__line-text {
      display: inline-flex;
      flex: 0 1 auto;
      min-width: 0;
      padding-right: 1ch;
      white-space: pre;
    }

    .wx-role-comment { color: var(--wx-color-comment); }
    .wx-role-function { color: var(--wx-color-function); }
    .wx-role-keyword { color: var(--wx-color-keyword); }
    .wx-role-number { color: var(--wx-color-number); }
    .wx-role-operator { color: var(--wx-color-operator); }
    .wx-role-punctuation { color: var(--wx-color-punctuation); }
    .wx-role-string { color: var(--wx-color-string); }
    .wx-role-type { color: var(--wx-color-type); }

    .wx-diagnostic-error {
      text-decoration: underline wavy var(--wx-color-diagnostic-error);
      text-underline-offset: 0.18em;
    }

    .wx-diagnostic-warning {
      text-decoration: underline wavy var(--wx-color-diagnostic-warning);
      text-underline-offset: 0.18em;
    }

    .wx-diagnostic-info {
      text-decoration: underline dotted var(--wx-color-diagnostic-info);
      text-underline-offset: 0.18em;
    }

    .wx-diagnostic-hint {
      text-decoration: underline dotted var(--wx-color-diagnostic-hint);
      text-underline-offset: 0.18em;
    }

    .wx-editor__eol-diagnostic {
      display: inline-block;
      flex: 1 1 auto;
      min-width: 0;
      padding-left: 2ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }

    .wx-editor__inline-diagnostic {
      display: inline-flex;
      align-items: flex-start;
      gap: 0.75ch;
      margin-top: 2px;
      white-space: pre-wrap;
      line-height: 1.35;
      opacity: 0.95;
      font-weight: 600;
      position: relative;
    }

    .wx-editor__inline-diagnostic-hook {
      position: relative;
      flex: 0 0 auto;
      width: 1.2ch;
      height: calc(var(--wx-line-height, 24px) * 0.72);
      margin-top: 0.1em;
    }

    .wx-editor__inline-diagnostic-hook::before {
      content: "";
      position: absolute;
      left: 0.4ch;
      top: 0;
      width: 0.8ch;
      height: 0.72em;
      border-left: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      border-bottom-left-radius: 6px;
      opacity: 0.9;
    }

    .wx-editor__inline-diagnostic-text {
      min-width: 0;
    }

    .wx-editor__diagnostic-row {
      display: grid;
      align-items: start;
      min-height: calc(var(--wx-line-height, 24px) * 0.95);
    }

    .wx-editor__diagnostic-gutter {
      color: transparent;
      user-select: none;
      padding-right: 14px;
    }

    .wx-editor__diagnostic-content {
      position: relative;
      min-height: calc(var(--wx-line-height, 24px) * 0.95);
      white-space: pre-wrap;
    }

    .wx-editor__inline-diagnostic[data-severity="error"],
    .wx-editor__eol-diagnostic[data-severity="error"] {
      color: var(--wx-color-diagnostic-error);
    }

    .wx-editor__inline-diagnostic[data-severity="warning"],
    .wx-editor__eol-diagnostic[data-severity="warning"] {
      color: var(--wx-color-diagnostic-warning);
    }

    .wx-editor__inline-diagnostic[data-severity="info"],
    .wx-editor__eol-diagnostic[data-severity="info"] {
      color: var(--wx-color-diagnostic-info);
    }

    .wx-editor__inline-diagnostic[data-severity="hint"],
    .wx-editor__eol-diagnostic[data-severity="hint"] {
      color: var(--wx-color-diagnostic-hint);
    }

    .wx-is-selected {
      background: var(--wx-color-selection);
      border-radius: 4px;
    }

    .wx-cursor-block {
      display: inline-block;
      min-width: 1ch;
      color: var(--wx-color-cursor-text);
      background: var(--wx-color-cursor);
      border-radius: 4px;
    }

    .wx-cursor-line {
      position: absolute;
      top: 0;
      width: 2px;
      background: var(--wx-color-cursor);
      border-radius: 999px;
      pointer-events: none;
    }

    .wx-editor__status {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      height: var(--wx-line-height, 24px);
      padding: 0 1ch 0 0;
      background: #0b0d12;
      border-top: 1px solid rgba(148, 163, 184, 0.14);
      color: #dbe2f0;
      font-size: 15px;
      line-height: 1;
    }

    .wx-editor__status-mode {
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

    .wx-editor__status-file {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #eef2ff;
    }

    .wx-editor__status-meta {
      display: inline-flex;
      align-items: center;
      gap: 18px;
      color: #c5cedd;
      white-space: nowrap;
    }

    .wx-editor__bottom-row {
      height: var(--wx-line-height, 24px);
      background: #0a0b0f;
      border-top: 1px solid rgba(148, 163, 184, 0.08);
      color: #dbe2f0;
      display: flex;
      align-items: center;
      padding: 0 1ch;
      white-space: pre;
    }

    .wx-editor__bottom-row[data-active="false"] {
      color: transparent;
    }

    .wx-editor__command-prompt {
      color: #eef2ff;
    }

    .wx-editor__command-text {
      color: #dbe2f0;
    }

    .wx-editor__bottom-message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wx-editor__bottom-message[data-tone="error"] {
      color: var(--wx-color-diagnostic-error);
    }

    .wx-editor__bottom-message[data-tone="warning"] {
      color: var(--wx-color-diagnostic-warning);
    }

    .wx-editor__bottom-message[data-tone="info"] {
      color: #dbe2f0;
    }

    .wx-editor__prefix-hint {
      color: #eef2ff;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .wx-editor__code-actions {
      display: flex;
      align-items: center;
      gap: 1ch;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
    }

    .wx-editor__code-action {
      display: inline-flex;
      align-items: center;
      gap: 0.5ch;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .wx-editor__code-action[data-selected="true"] {
      color: #ffffff;
      font-weight: 700;
    }

    .wx-editor__tooltip {
      position: absolute;
      z-index: 6;
      max-width: min(56ch, calc(100% - 32px));
      padding: 8px 10px;
      border-radius: 10px;
      background: rgba(10, 11, 15, 0.98);
      border: 1px solid rgba(148, 163, 184, 0.22);
      box-shadow: 0 18px 40px rgba(2, 8, 23, 0.35);
      color: #eef2ff;
      line-height: 1.35;
      pointer-events: none;
      white-space: pre-wrap;
    }

    .wx-editor__tooltip[data-tone="error"] {
      border-color: color-mix(in srgb, var(--wx-color-diagnostic-error) 60%, rgba(148, 163, 184, 0.22));
    }

    .wx-editor__tooltip[data-tone="warning"] {
      border-color: color-mix(in srgb, var(--wx-color-diagnostic-warning) 60%, rgba(148, 163, 184, 0.22));
    }

    .wx-editor__tooltip[data-tone="info"] {
      border-color: color-mix(in srgb, var(--wx-color-diagnostic-info) 45%, rgba(148, 163, 184, 0.22));
    }

    .wx-editor__tooltip-source {
      display: block;
      margin-bottom: 4px;
      font-size: 0.85em;
      opacity: 0.75;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .wx-editor__filler-row {
      display: grid;
      align-items: center;
      min-height: var(--wx-line-height, 24px);
      color: color-mix(in srgb, var(--wx-color-gutter) 80%, transparent);
      user-select: none;
    }

    .wx-editor__filler-gutter {
      padding-right: 14px;
      text-align: right;
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
  probe.style.font = '15px/1.6 "Monaspace Argon Var", "Iosevka Web", "SFMono-Regular", "Monaco", monospace';
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
    case "B":
      return movePrevLongWordStart;
    case "E":
      return moveNextLongWordEnd;
    case "End":
      return gotoLineEnd;
    case "Home":
      return gotoLineStart;
    case "PageDown":
      return pageDown;
    case "PageUp":
      return pageUp;
    case "W":
      return moveNextLongWordStart;
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
    case "d":
      return deleteSelection;
    case "e":
      return moveWordForward;
    case "i":
      return enterInsertMode;
    case "o":
      return openBelow;
    case "O":
      return openAbove;
    case "p":
      return pasteAfter;
    case "u":
      return undo;
    case "U":
      return redo;
    case "v":
      return toggleVisualMode;
    case "w":
      return moveNextWordStart;
    case "x":
      return selectLineBelow;
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
    case "B":
      return movePrevLongWordStart;
    case "E":
      return moveNextLongWordEnd;
    case "Escape":
      return enterNormalMode;
    case "End":
      return gotoLineEnd;
    case "Home":
      return gotoLineStart;
    case "PageDown":
      return pageDown;
    case "PageUp":
      return pageUp;
    case "W":
      return moveNextLongWordStart;
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
    case "d":
      return deleteSelection;
    case "e":
      return moveWordForward;
    case "o":
      return openBelow;
    case "O":
      return openAbove;
    case "p":
      return pasteAfter;
    case "u":
      return undo;
    case "U":
      return redo;
    case "v":
      return toggleVisualMode;
    case "w":
      return moveNextWordStart;
    case "x":
      return selectLineBelow;
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
    case "b":
      return gotoWindowBottom;
    case "c":
      return gotoWindowCenter;
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
    case "t":
      return gotoWindowTop;
    default:
      return null;
  }
}

function commandForBracketPrefix(direction: "[" | "]", key: string): Command | null {
  if (key !== "p") {
    return null;
  }

  return direction === "[" ? gotoPrevParagraph : gotoNextParagraph;
}

function diagnosticSeverityAtOffset(entries: readonly EditorDiagnostic[], offset: number): DiagnosticSeverity | null {
  let best: DiagnosticSeverity | null = null;

  for (const entry of entries) {
    if (offset < entry.from || offset >= entry.to) {
      continue;
    }

    if (!best || DIAGNOSTIC_SEVERITY_ORDER[entry.severity] < DIAGNOSTIC_SEVERITY_ORDER[best]) {
      best = entry.severity;
    }
  }

  return best;
}

function renderLineFragments(
  line: { start: number; text: string },
  state: EditorState,
  spans: HighlightSpan[],
  lineDiagnostics: readonly EditorDiagnostic[]
): LineFragment[] {
  const fragments: LineFragment[] = [];
  const activeOffset = getActiveCharacterOffset(state);
  const selection = getSelectionOffsets(state);
  const lineEnd = line.start + line.text.length;

  if (state.mode === "insert") {
    if (line.text.length === 0) {
      return [
        {
          offset: line.start,
          text: EMPTY_CELL_TEXT,
          role: "text",
          isSelected: false,
          isCursor: false,
          cursorKind: null,
          diagnosticSeverity: null
        }
      ];
    }

    for (let index = 0; index < line.text.length; index += 1) {
      const offset = line.start + index;

      fragments.push({
        offset,
        text: line.text[index] ?? EMPTY_CELL_TEXT,
        role: roleAtOffset(spans, offset),
        isSelected: false,
        isCursor: false,
        cursorKind: null,
        diagnosticSeverity: diagnosticSeverityAtOffset(lineDiagnostics, offset)
      });
    }

    return fragments;
  }

  if (line.text.length === 0) {
    const selected = selection.from <= line.start && line.start < selection.to;
    return [
      {
        offset: line.start,
        text: EMPTY_CELL_TEXT,
        role: "text",
        isSelected: selected,
        isCursor: activeOffset === line.start,
        cursorKind: activeOffset === line.start ? "block" : null,
        diagnosticSeverity: null
      }
    ];
  }

  for (let index = 0; index < line.text.length; index += 1) {
    const offset = line.start + index;
    fragments.push({
      offset,
      text: line.text[index] ?? " ",
      role: roleAtOffset(spans, offset),
      isSelected: offset >= selection.from && offset < selection.to,
      isCursor: offset === activeOffset,
      cursorKind: offset === activeOffset ? "block" : null,
      diagnosticSeverity: diagnosticSeverityAtOffset(lineDiagnostics, offset)
    });
  }

  const hasLineEnding = lineEnd < state.doc.length && state.doc.text[lineEnd] === "\n";
  const lineEndingSelected = hasLineEnding && lineEnd >= selection.from && lineEnd < selection.to;
  const lineEndingCursor = hasLineEnding && activeOffset === lineEnd;

  if (lineEndingSelected || lineEndingCursor) {
    fragments.push({
      offset: lineEnd,
      text: EMPTY_CELL_TEXT,
      role: "text",
      isSelected: lineEndingSelected,
      isCursor: lineEndingCursor,
      cursorKind: lineEndingCursor ? "block" : null,
      diagnosticSeverity: null
    });
  }

  return fragments;
}

function selectDiagnostic(
  entries: readonly EditorDiagnostic[],
  minimum: DiagnosticSeverity,
  excluding: EditorDiagnostic | null = null
): EditorDiagnostic | null {
  let best: EditorDiagnostic | null = null;

  for (const entry of entries) {
    if (excluding && entry === excluding) {
      continue;
    }

    if (!meetsDiagnosticThreshold(entry.severity, minimum)) {
      continue;
    }

    if (!best || DIAGNOSTIC_SEVERITY_ORDER[entry.severity] < DIAGNOSTIC_SEVERITY_ORDER[best.severity]) {
      best = entry;
    }
  }

  return best;
}

function normalizeViewport(viewport: { fromLine: number; toLine: number }, lineCount: number): { fromLine: number; toLine: number } {
  const maxLine = Math.max(0, lineCount - 1);
  const fromLine = Math.max(0, Math.min(maxLine, viewport.fromLine));
  const toLine = Math.max(fromLine, Math.min(maxLine, viewport.toLine));

  return { fromLine, toLine };
}

export function createEditor(container: HTMLElement, options: CreateEditorOptions = {}): EditorHandle {
  const controller =
    options.controller ??
    createEditorController({
      value: options.value ?? "",
      theme: options.theme?.name
    });
  let state = controller.getState();
  let filePath = options.filePath ?? "untitled.ts";
  let languageServices = options.languageServices ?? languageProviderToServices(options.language ?? null);
  let theme = options.theme ?? defaultTheme;
  let highlightCache = new Map<number, HighlightSpan[]>();
  let highlightCoverage = new Set<number>();
  let rowViews: RowView[] = [];
  let renderedViewport: LineViewport = { fromLine: 0, toLine: -1 };
  let commandLine: CommandLineState = { active: false, value: "" };
  let bottomMessage: BottomMessageState | null = null;
  let codeActionMenu: CodeActionMenuState = {
    active: false,
    loading: false,
    actions: [],
    selectedIndex: 0,
    error: null
  };
  let hoverState: HoverState = {
    active: false,
    pinned: false,
    offset: null,
    content: "",
    tone: "info",
    left: 16,
    top: 16
  };
  let diagnostics: readonly EditorDiagnostic[] = [];
  let diagnosticsByLine = new Map<number, EditorDiagnostic[]>();
  let pendingAction: PendingAction = null;
  let lastRepeatableMotion: RepeatableMotion | null = null;
  let languageRevision = -1;
  let lastHighlightedRevision = -1;
  let highlightRequestId = 0;
  let diagnosticsRequestId = 0;
  let hoverRequestId = 0;
  let gutterWidth = 0;
  let destroyed = false;
  let mountedContainer: HTMLElement | null = container;
  let unsubscribeController = () => {};

  const root = document.createElement("div");
  const surface = document.createElement("div");
  const rows = document.createElement("div");
  const topSpacer = document.createElement("div");
  const viewportRows = document.createElement("div");
  const bottomSpacer = document.createElement("div");
  const tooltip = document.createElement("div");
  const status = document.createElement("div");
  const statusMode = document.createElement("div");
  const statusFile = document.createElement("div");
  const statusMeta = document.createElement("div");
  const bottomRow = document.createElement("div");
  const textarea = document.createElement("textarea");
  const metrics = measureMetrics(container);

  mountStyles(root);
  applyThemeVariables(root, theme);

  root.className = "wx-editor";
  root.dataset.wxEditor = "root";
  root.tabIndex = 0;
  root.style.setProperty("--wx-line-height", `${metrics.lineHeight}px`);

  surface.className = "wx-editor__surface";
  surface.dataset.wxEditor = "surface";

  rows.className = "wx-editor__rows";
  rows.dataset.wxEditor = "rows";

  topSpacer.className = "wx-editor__spacer";
  topSpacer.dataset.wxEditorSpacer = "top";

  viewportRows.dataset.wxEditor = "viewport";

  bottomSpacer.className = "wx-editor__spacer";
  bottomSpacer.dataset.wxEditorSpacer = "bottom";

  tooltip.className = "wx-editor__tooltip";
  tooltip.dataset.wxEditorTooltip = "true";
  tooltip.hidden = true;

  status.className = "wx-editor__status";
  status.dataset.wxEditor = "status";

  statusMode.className = "wx-editor__status-mode";
  statusMode.dataset.wxEditorStatusMode = "true";

  statusFile.className = "wx-editor__status-file";
  statusFile.dataset.wxEditorStatusFile = "true";

  statusMeta.className = "wx-editor__status-meta";
  statusMeta.dataset.wxEditorStatusMeta = "true";

  bottomRow.className = "wx-editor__bottom-row";
  bottomRow.dataset.wxEditorBottomRow = "true";

  textarea.className = "wx-editor__input";
  textarea.dataset.wxEditor = "input";
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.autocorrect = "off";

  status.append(statusMode, statusFile, statusMeta);
  rows.append(topSpacer, viewportRows, bottomSpacer);
  surface.append(rows, tooltip, textarea);
  root.append(surface, status, bottomRow);
  mountedContainer.replaceChildren(root);

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
    const host = document.createElement("div");
    const row = document.createElement("div");
    const gutter = document.createElement("div");
    const content = document.createElement("div");

    host.className = "wx-editor__line-group";
    row.className = "wx-editor__row";
    row.dataset.wxEditorRow = String(lineIndex + 1);

    gutter.className = "wx-editor__gutter";
    gutter.dataset.wxEditorGutter = String(lineIndex + 1);

    content.className = "wx-editor__content";
    content.dataset.wxEditorContent = String(lineIndex + 1);

    row.append(gutter, content);
    host.append(row);

    return {
      lineIndex,
      host,
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

  function getLineDiagnostics(lineIndex: number): readonly EditorDiagnostic[] {
    return diagnosticsByLine.get(lineIndex) ?? [];
  }

  function getLineDiagnosticSeverity(lineIndex: number): DiagnosticSeverity | null {
    const entries = getLineDiagnostics(lineIndex);
    let best: DiagnosticSeverity | null = null;

    for (const entry of entries) {
      if (!best || DIAGNOSTIC_SEVERITY_ORDER[entry.severity] < DIAGNOSTIC_SEVERITY_ORDER[best]) {
        best = entry.severity;
      }
    }

    return best;
  }

  function getInlineDiagnosticForLine(lineIndex: number): EditorDiagnostic | null {
    const entries = getLineDiagnostics(lineIndex);
    const activeLine = getActiveLine(state);
    return selectDiagnostic(
      entries,
      lineIndex === activeLine ? CURSOR_LINE_INLINE_DIAGNOSTIC_MIN : OTHER_LINES_INLINE_DIAGNOSTIC_MIN
    );
  }

  function getEndOfLineDiagnosticForLine(lineIndex: number): EditorDiagnostic | null {
    const entries = getLineDiagnostics(lineIndex);
    return selectDiagnostic(entries, END_OF_LINE_DIAGNOSTIC_MIN, getInlineDiagnosticForLine(lineIndex));
  }

  function getDiagnosticsSummary(): { errors: number; warnings: number } {
    let errors = 0;
    let warnings = 0;

    for (const entry of diagnostics) {
      if (entry.severity === "error") {
        errors += 1;
      } else if (entry.severity === "warning") {
        warnings += 1;
      }
    }

    return { errors, warnings };
  }

  function getCurrentDiagnostic(): EditorDiagnostic | null {
    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const activeLine = state.doc.positionAt(activeOffset).line;
    const activeLineDiagnostics = getLineDiagnostics(activeLine);

    for (const entry of activeLineDiagnostics) {
      if (activeOffset >= entry.from && activeOffset < entry.to) {
        return entry;
      }
    }

    return activeLineDiagnostics[0] ?? null;
  }

  function patchRowView(view: RowView, lineIndex: number): void {
    const line = state.doc.lineAt(lineIndex);
    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const cursorPosition = state.doc.positionAt(activeOffset);
    const lineDiagnostics = getLineDiagnostics(lineIndex);
    const lineDiagnosticSeverity = getLineDiagnosticSeverity(lineIndex);
    const inlineDiagnostic = getInlineDiagnosticForLine(lineIndex);
    const endOfLineDiagnostic = getEndOfLineDiagnosticForLine(lineIndex);
    const gutterMarker = document.createElement("span");
    const gutterNumber = document.createElement("span");
    const lineText = document.createElement("span");

    view.lineIndex = lineIndex;
    view.row.dataset.wxEditorRow = String(lineIndex + 1);
    view.gutter.dataset.wxEditorGutter = String(lineIndex + 1);
    view.content.dataset.wxEditorContent = String(lineIndex + 1);
    gutterMarker.className = "wx-editor__gutter-marker";
    gutterMarker.dataset.severity = lineDiagnosticSeverity ?? "";
    gutterMarker.dataset.wxEditorDiagnosticMarker = lineDiagnosticSeverity ?? "";
    gutterNumber.className = "wx-editor__gutter-number";
    gutterNumber.textContent = String(lineIndex + 1);
    view.gutter.replaceChildren(gutterMarker, gutterNumber);
    view.row.classList.toggle("wx-row-active", lineIndex === cursorPosition.line);
    view.content.replaceChildren();
    view.host.replaceChildren(view.row);
    lineText.className = "wx-editor__line-text";
    view.content.append(lineText);

    for (const segment of renderLineFragments(line, state, getLineHighlights(lineIndex), lineDiagnostics)) {
      const token = document.createElement("span");
      token.className = "wx-token";
      token.classList.add(roleClassName(segment.role));
      addClassName(token, "wx-is-selected", segment.isSelected);
      addClassName(token, diagnosticClassName(segment.diagnosticSeverity), !!segment.diagnosticSeverity);

      if (segment.isCursor) {
        token.classList.add("wx-cursor-block");
        token.dataset.wxEditorCursor = "true";
        token.dataset.wxEditorCursorKind = segment.cursorKind ?? "";
      }

      if (segment.offset !== null) {
        token.dataset.wxEditorOffset = String(segment.offset);
      }

      token.textContent = segment.text;
      lineText.append(token);
    }

    if (endOfLineDiagnostic) {
      const note = document.createElement("span");
      note.className = "wx-editor__eol-diagnostic";
      note.dataset.severity = endOfLineDiagnostic.severity;
      note.dataset.wxEditorDiagnosticNote = "eol";
      note.textContent = `  ${endOfLineDiagnostic.message}`;
      view.content.append(note);
    }

    if (inlineDiagnostic) {
      const detailRow = document.createElement("div");
      const detailGutter = document.createElement("div");
      const detailContent = document.createElement("div");
      const detail = document.createElement("div");
      const hook = document.createElement("span");
      const text = document.createElement("span");
      const diagnosticStartColumn = Math.max(
        0,
        inlineDiagnostic.from > line.start ? state.doc.positionAt(inlineDiagnostic.from).column : 0
      );
      detailRow.className = "wx-editor__diagnostic-row";
      detailGutter.className = "wx-editor__diagnostic-gutter";
      detailContent.className = "wx-editor__diagnostic-content";
      detailRow.style.gridTemplateColumns = `${gutterWidth}px 1fr`;
      detailGutter.textContent = " ";
      detail.className = "wx-editor__inline-diagnostic";
      detail.dataset.severity = inlineDiagnostic.severity;
      detail.dataset.wxEditorDiagnosticNote = "inline";
      detail.style.marginLeft = `${diagnosticStartColumn * metrics.charWidth}px`;
      hook.className = "wx-editor__inline-diagnostic-hook";
      hook.dataset.wxEditorDiagnosticHook = inlineDiagnostic.severity;
      text.className = "wx-editor__inline-diagnostic-text";
      text.textContent = inlineDiagnostic.message;
      detail.append(hook, text);
      detailContent.append(detail);
      detailRow.append(detailGutter, detailContent);
      view.host.append(detailRow);
    }

    if (state.mode === "insert" && lineIndex === cursorPosition.line) {
      const caret = document.createElement("span");
      const caretHeight = Math.max(14, Math.round(metrics.lineHeight * 0.84));
      const caretTop = Math.max(0, Math.round((metrics.lineHeight - caretHeight) / 2));

      caret.className = "wx-cursor-line";
      caret.dataset.wxEditorCursor = "true";
      caret.dataset.wxEditorCursorKind = "line";
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

  function getVisibleLineCapacity(): number {
    const viewportHeight = Math.max(metrics.lineHeight, surface.clientHeight || metrics.lineHeight * 20);
    return Math.max(1, Math.ceil(viewportHeight / metrics.lineHeight));
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
      fragment.append(view.host);
    }

    const fillerCount = Math.max(0, getVisibleLineCapacity() - rowViews.length);

    for (let index = 0; index < fillerCount; index += 1) {
      const fillerRow = document.createElement("div");
      const fillerGutter = document.createElement("div");
      const fillerContent = document.createElement("div");

      fillerRow.className = "wx-editor__filler-row";
      fillerGutter.className = "wx-editor__filler-gutter";
      fillerContent.className = "wx-editor__content";
      fillerRow.style.gridTemplateColumns = `${gutterWidth}px 1fr`;
      fillerRow.dataset.wxEditorFillerRow = String(index);
      fillerGutter.textContent = "~";
      fillerContent.textContent = " ";
      fillerRow.append(fillerGutter, fillerContent);
      fragment.append(fillerRow);
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
    const { errors, warnings } = getDiagnosticsSummary();
    const parts = ["1 sel"];

    if (errors > 0) {
      parts.push(`E${errors}`);
    }

    if (warnings > 0) {
      parts.push(`W${warnings}`);
    }

    parts.push(`${cursorPosition.line + 1}:${cursorPosition.column + 1}`);

    statusMode.textContent = state.mode === "insert" ? "INS" : state.mode === "visual" ? "VIS" : "NOR";
    statusFile.textContent = filePath;
    statusMeta.textContent = parts.join("   ");
  }

  function getViewportContext() {
    const viewport = getVisibleViewport();
    return {
      ...viewport,
      visibleLineCount: Math.max(1, viewport.toLine - viewport.fromLine + 1)
    };
  }

  function patchBottomRow(): void {
    bottomRow.dataset.active = String(commandLine.active || codeActionMenu.active || !!bottomMessage || pendingAction?.kind === "space");
    bottomRow.replaceChildren();

    if (commandLine.active) {
      const prompt = document.createElement("span");
      const value = document.createElement("span");

      prompt.className = "wx-editor__command-prompt";
      prompt.dataset.wxEditorCommandPrompt = "true";
      prompt.textContent = ":";

      value.className = "wx-editor__command-text";
      value.dataset.wxEditorCommandText = "true";
      value.textContent = commandLine.value;

      bottomRow.append(prompt, value);
      return;
    }

    if (codeActionMenu.active) {
      const actions = document.createElement("div");
      actions.className = "wx-editor__code-actions";
      actions.dataset.wxEditorCodeActions = "true";

      if (codeActionMenu.loading) {
        actions.textContent = "Loading code actions...";
      } else if (codeActionMenu.error) {
        actions.textContent = codeActionMenu.error;
      } else {
        codeActionMenu.actions.slice(0, 9).forEach((action, index) => {
          const item = document.createElement("span");
          item.className = "wx-editor__code-action";
          item.dataset.selected = String(index === codeActionMenu.selectedIndex);
          item.dataset.wxEditorCodeAction = String(index + 1);
          item.textContent = `${index + 1}:${action.title}`;
          actions.append(item);
        });
      }

      bottomRow.append(actions);
      return;
    }

    if (bottomMessage) {
      const message = document.createElement("span");
      message.className = "wx-editor__bottom-message";
      message.dataset.tone = bottomMessage.tone;
      message.dataset.wxEditorBottomMessage = "true";
      message.textContent = bottomMessage.text;
      bottomRow.append(message);
      return;
    }

    if (pendingAction?.kind === "space") {
      const prefix = document.createElement("span");
      prefix.className = "wx-editor__prefix-hint";
      prefix.dataset.wxEditorPrefixHint = "space";
      prefix.textContent = "<space>";
      bottomRow.append(prefix);
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

  function buildDiagnosticsCache(nextDiagnostics: readonly EditorDiagnostic[]): Map<number, EditorDiagnostic[]> {
    const nextByLine = new Map<number, EditorDiagnostic[]>();

    for (const diagnostic of nextDiagnostics) {
      const safeFrom = Math.max(0, Math.min(state.doc.length, diagnostic.from));
      const safeTo = Math.max(safeFrom, Math.min(state.doc.length, Math.max(diagnostic.from + 1, diagnostic.to)));
      const startLine = state.doc.positionAt(safeFrom).line;
      const endLine = state.doc.positionAt(Math.max(safeFrom, safeTo - 1)).line;

      for (let line = startLine; line <= endLine; line += 1) {
        const entry = nextByLine.get(line);

        if (entry) {
          entry.push({ ...diagnostic, from: safeFrom, to: safeTo });
        } else {
          nextByLine.set(line, [{ ...diagnostic, from: safeFrom, to: safeTo }]);
        }
      }
    }

    return nextByLine;
  }

  function refreshDiagnostics(): void {
    const diagnosticsSource = languageServices?.diagnostics;
    const requestId = ++diagnosticsRequestId;

    if (!diagnosticsSource) {
      if (diagnostics.length > 0 || diagnosticsByLine.size > 0) {
        diagnostics = [];
        diagnosticsByLine = new Map();
        patchStatus();
        patchBottomRow();
        renderVisibleRows(true);
      }
      return;
    }

    void diagnosticsSource
      .diagnostics(getSnapshot())
      .then((nextDiagnostics) => {
        if (destroyed || requestId !== diagnosticsRequestId) {
          return;
        }

        diagnostics = nextDiagnostics;
        diagnosticsByLine = buildDiagnosticsCache(nextDiagnostics);
        patchStatus();
        patchBottomRow();
        renderVisibleRows(true);
      })
      .catch(() => {
        if (destroyed || requestId !== diagnosticsRequestId) {
          return;
        }

        diagnostics = [];
        diagnosticsByLine = new Map();
        setBottomMessage({ tone: "error", text: "Diagnostics request failed" });
        patchStatus();
        renderVisibleRows(true);
      });
  }

  function remapHighlightCacheForChanges(
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ): void {
    if (changes.length === 0) {
      return;
    }

    const nextCache = new Map<number, HighlightSpan[]>();

    for (const spans of highlightCache.values()) {
      for (const span of spans) {
        const mappedFrom = Math.max(0, Math.min(nextState.doc.length, mapOffsetThroughChanges(span.from, changes, "left")));
        const mappedTo = Math.max(mappedFrom, Math.min(nextState.doc.length, mapOffsetThroughChanges(span.to, changes, "right")));

        if (mappedTo <= mappedFrom) {
          continue;
        }

        const startLine = nextState.doc.positionAt(mappedFrom).line;
        const endLine = nextState.doc.positionAt(Math.max(mappedFrom, mappedTo - 1)).line;

        for (let line = startLine; line <= endLine; line += 1) {
          const lineInfo = nextState.doc.lineAt(line);
          const from = Math.max(mappedFrom, lineInfo.start);
          const to = Math.min(mappedTo, lineInfo.end);

          if (to <= from) {
            continue;
          }

          const entry = nextCache.get(line);
          const clipped = { from, to, role: span.role };

          if (entry) {
            entry.push(clipped);
          } else {
            nextCache.set(line, [clipped]);
          }
        }
      }
    }

    highlightCache = nextCache;
  }

  function remapHighlightCoverageForChanges(
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ): void {
    if (changes.length === 0) {
      return;
    }

    const nextCoverage = new Set<number>();

    for (const lineIndex of highlightCoverage) {
      const previousLine = previousState.doc.lineAt(lineIndex);
      const mappedOffset = Math.max(
        0,
        Math.min(nextState.doc.length, mapOffsetThroughChanges(previousLine.start, changes, "left"))
      );
      nextCoverage.add(nextState.doc.positionAt(mappedOffset).line);
    }

    highlightCoverage = nextCoverage;
  }

  function invalidateHighlightViewport(viewport: { fromLine: number; toLine: number }): void {
    for (let index = viewport.fromLine; index <= viewport.toLine; index += 1) {
      highlightCoverage.delete(index);
    }
  }

  async function refreshHighlights(
    viewport = getHighlightViewport(renderedViewport.toLine >= renderedViewport.fromLine ? renderedViewport : expandViewport(getVisibleViewport())),
    force = false
  ): Promise<void> {
    const highlighter = languageServices?.highlighter;

    if (!highlighter || languageRevision < 0) {
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
    const next = await highlighter.getHighlights(viewport, languageRevision);

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
    const highlighter = languageServices?.highlighter;

    if (!highlighter) {
      return;
    }

    if (forceDocumentSync || languageRevision < 0) {
      await highlighter.open(getSnapshot());
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

    await highlighter.update(getSnapshot(), changes);
    languageRevision = state.revision;
    lastHighlightedRevision = -1;
    await refreshHighlights(
      viewport ?? getHighlightViewport(renderedViewport.toLine >= renderedViewport.fromLine ? renderedViewport : expandViewport(getVisibleViewport())),
      true
    );
  }

  function handleControllerUpdate(update: EditorUpdate): void {
    const previousState = update.prevState;
    const nextState = update.nextState;
    const changes = update.transaction.changes ?? [];
    const hasDocumentChanges = update.docChanged || changes.length > 0;
    const previousDigits = String(Math.max(1, previousState.doc.lineCount)).length;
    const nextDigits = String(Math.max(1, nextState.doc.lineCount)).length;
    const highlightViewports = hasDocumentChanges && changes.length > 0
      ? getHighlightViewportsForChanges(previousState, nextState, changes)
      : null;

    state = nextState;

    if (hasDocumentChanges) {
      lastHighlightedRevision = -1;
      if (changes.length > 0) {
        remapHighlightCacheForChanges(previousState, nextState, changes);
        remapHighlightCoverageForChanges(previousState, nextState, changes);
      } else {
        highlightCache.clear();
        highlightCoverage.clear();
      }

      if (highlightViewports) {
        invalidateHighlightViewport(highlightViewports.nextViewport);
      }

      if (previousDigits !== nextDigits) {
        refreshGutterWidth(true);
      }

      patchStatus();
      patchBottomRow();
      revealCursor();
      renderVisibleRows(true);
      revealCursor();
      void syncLanguage(
        changes,
        changes.length === 0,
        highlightViewports?.nextViewport ?? getHighlightViewport(renderedViewport)
      );
      refreshDiagnostics();
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
    revealCursor();

    if (viewportEquals(previousViewport, renderedViewport)) {
      patchVisibleLines(getVisualDirtyLines(previousState, nextState));
    }
  }

  function openCommandLine(): void {
    pendingAction = null;
    clearHover();
    commandLine = { active: true, value: "" };
    patchBottomRow();
  }

  function closeCommandLine(): void {
    commandLine = { active: false, value: "" };
    patchBottomRow();
  }

  function closeCodeActionMenu(): void {
    codeActionMenu = {
      active: false,
      loading: false,
      actions: [],
      selectedIndex: 0,
      error: null
    };
    patchBottomRow();
  }

  function setBottomMessage(message: BottomMessageState | null): void {
    bottomMessage = message;
    patchBottomRow();
  }

  function patchTooltip(): void {
    if (!hoverState.active) {
      tooltip.hidden = true;
      tooltip.replaceChildren();
      return;
    }

    tooltip.hidden = false;
    tooltip.dataset.tone = hoverState.tone;
    tooltip.style.left = `${hoverState.left}px`;
    tooltip.style.top = `${hoverState.top}px`;
    tooltip.replaceChildren();

    if (hoverState.source) {
      const source = document.createElement("span");
      source.className = "wx-editor__tooltip-source";
      source.textContent = hoverState.source;
      tooltip.append(source);
    }

    const body = document.createElement("div");
    body.textContent = hoverState.content;
    tooltip.append(body);
  }

  function setHoverState(next: HoverState): void {
    hoverState = next;
    patchTooltip();
  }

  function clearHover(preservePinned = false): void {
    if (preservePinned && hoverState.pinned) {
      return;
    }

    if (!hoverState.active) {
      return;
    }

    setHoverState({
      active: false,
      pinned: false,
      offset: null,
      content: "",
      tone: "info",
      left: hoverState.left,
      top: hoverState.top
    });
  }

  function normalizeHover(hover: EditorHover | null): HoverState | null {
    if (!hover || !hover.content.trim()) {
      return null;
    }

    return {
      active: true,
      pinned: false,
      offset: null,
      content: hover.content,
      source: hover.source,
      tone: "info",
      left: 16,
      top: 16
    };
  }

  function getTooltipAnchorForRect(rect: DOMRect): { left: number; top: number } {
    const rootRect = root.getBoundingClientRect();
    const left = Math.max(8, rect.left - rootRect.left);
    const top = Math.max(8, rect.bottom - rootRect.top + 6);
    return { left, top };
  }

  function showDiagnosticTooltip(diagnostic: EditorDiagnostic, anchor: DOMRect, pinned = false): void {
    setBottomMessage(null);
    setHoverState({
      active: true,
      pinned,
      offset: diagnostic.from,
      content: diagnostic.message,
      source: diagnostic.source,
      tone: toneForSeverity(diagnostic.severity),
      ...getTooltipAnchorForRect(anchor)
    });
  }

  async function requestHover(offset: number, anchor: DOMRect, pinned = false): Promise<boolean> {
    const hoverSource = languageServices?.hover;

    if (!hoverSource) {
      if (pinned) {
        setBottomMessage({ tone: "warning", text: "No hover provider" });
      }
      return false;
    }

    if (hoverState.active && hoverState.offset === offset && hoverState.pinned === pinned) {
      return true;
    }

    const requestId = ++hoverRequestId;
    const nextHover = await hoverSource.hover(getSnapshot(), offset);

    if (destroyed || requestId !== hoverRequestId) {
      return false;
    }

    const normalized = normalizeHover(nextHover);

    if (!normalized) {
      if (pinned) {
        setBottomMessage({ tone: "info", text: "No hover information" });
      } else {
        clearHover();
      }
      return false;
    }

    setBottomMessage(null);
    setHoverState({
      ...normalized,
      pinned,
      offset,
      ...getTooltipAnchorForRect(anchor)
    });
    return true;
  }

  function getCodeActionContext() {
    const selection = getSelectionOffsets(state);
    const overlappingDiagnostics = diagnostics.filter(
      (entry) => entry.from < selection.to && entry.to > selection.from
    );
    const fallbackDiagnostics =
      overlappingDiagnostics.length > 0 ? overlappingDiagnostics : getLineDiagnostics(getActiveLine(state));

    return {
      document: getSnapshot(),
      selection,
      diagnostics: fallbackDiagnostics
    };
  }

  async function resolveCodeActionChanges(action: EditorCodeAction): Promise<readonly TextChange[] | null> {
    if (action.changes && action.changes.length > 0) {
      return action.changes;
    }

    return (await action.apply?.(getCodeActionContext())) ?? null;
  }

  async function applyCodeActionInternal(action: EditorCodeAction): Promise<boolean> {
    const changes = await resolveCodeActionChanges(action);

    if (!changes || changes.length === 0) {
      setBottomMessage({ tone: "warning", text: `No edits for ${action.title}` });
      return false;
    }

    controller.dispatch({
      changes,
      effects: [{ type: "language.code-action", value: action.title }]
    });
    closeCodeActionMenu();
    setBottomMessage({ tone: "info", text: `Applied ${action.title}` });
    return true;
  }

  async function loadCodeActions(): Promise<readonly EditorCodeAction[]> {
    const codeActionSource = languageServices?.codeActions;

    if (!codeActionSource) {
      setBottomMessage({ tone: "warning", text: "No code actions provider" });
      return [];
    }

    codeActionMenu = {
      active: true,
      loading: true,
      actions: [],
      selectedIndex: 0,
      error: null
    };
    patchBottomRow();

    let actions: readonly EditorCodeAction[];

    try {
      actions = await codeActionSource.getCodeActions(getCodeActionContext());
    } catch {
      closeCodeActionMenu();
      setBottomMessage({ tone: "error", text: "Code actions request failed" });
      return [];
    }

    codeActionMenu = {
      active: true,
      loading: false,
      actions,
      selectedIndex: 0,
      error: actions.length === 0 ? "No code actions" : null
    };
    patchBottomRow();

    if (actions.length === 0) {
      closeCodeActionMenu();
      setBottomMessage({ tone: "warning", text: "No code actions available" });
    }

    return actions;
  }

  async function formatDocument(): Promise<boolean> {
    const formatter = languageServices?.formatter;

    if (!formatter) {
      setBottomMessage({ tone: "warning", text: "No formatter provider" });
      return false;
    }

    let changes: readonly TextChange[];

    try {
      changes = await formatter.format({
        document: getSnapshot(),
        selection: getSelectionOffsets(state)
      });
    } catch {
      setBottomMessage({ tone: "error", text: "Formatting failed" });
      return false;
    }

    if (!changes || changes.length === 0) {
      setBottomMessage({ tone: "info", text: "Already formatted" });
      return false;
    }

    controller.dispatch({
      changes,
      effects: [{ type: "language.format" }]
    });
    setBottomMessage({ tone: "info", text: "Formatted document" });
    return true;
  }

  function runCommandLineCommand(rawValue: string): void {
    const value = rawValue.trim().toLowerCase();

    closeCommandLine();

    if (!value) {
      return;
    }

    if (value === "format" || value === "fmt") {
      void formatDocument();
      return;
    }

    if (value === "code-actions" || value === "codeaction" || value === "ca") {
      void loadCodeActions();
      return;
    }

    setBottomMessage({ tone: "warning", text: `Unknown command: ${rawValue}` });
  }

  function runCommand(command: Command): boolean {
    setBottomMessage(null);
    clearHover();
    closeCodeActionMenu();
    return controller.execute(command, {
      requestFocus() {
        textarea.focus();
      },
      viewport: getViewportContext()
    });
  }

  function runRepeatableMotion(motion: RepeatableMotion): boolean {
    switch (motion.kind) {
      case "find":
        switch (motion.variant) {
          case "f":
            return runCommand(findNextChar(motion.target));
          case "F":
            return runCommand(findPrevChar(motion.target));
          case "t":
            return runCommand(findTillNextChar(motion.target));
          case "T":
            return runCommand(findTillPrevChar(motion.target));
        }
      case "matching-bracket":
        return runCommand(gotoMatchingBracket);
      case "paragraph":
        return runCommand(motion.direction === "next" ? gotoNextParagraph : gotoPrevParagraph);
      case "textobject":
        return runCommand(selectTextobject(motion.mode, motion.object));
    }

    return false;
  }

  function recordRepeatableMotion(candidate: RepeatableMotion, didChange: boolean): void {
    if (didChange) {
      lastRepeatableMotion = candidate;
    }
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
      const syntaxSelector = languageServices?.syntaxSelector;
      const syntaxSelection =
        event.key === "ArrowUp"
          ? syntaxSelector?.expandSelection?.bind(syntaxSelector)
          : syntaxSelector?.shrinkSelection?.bind(syntaxSelector);

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

          controller.dispatch({
            selection: selectionFromSyntaxRange(nextSelection.from, nextSelection.to)
          });
        });
      }
      return;
    }

    if (
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      state.mode !== "insert" &&
      event.key === "."
    ) {
      if (!lastRepeatableMotion) {
        return;
      }

      event.preventDefault();
      textarea.value = "";
      runRepeatableMotion(lastRepeatableMotion);
      return;
    }

    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      state.mode !== "insert" &&
      ["b", "d", "f", "u"].includes(event.key)
    ) {
      const command =
        event.key === "b" ? pageUp : event.key === "f" ? pageDown : event.key === "u" ? halfPageUp : halfPageDown;

      event.preventDefault();
      textarea.value = "";
      runCommand(command);
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (codeActionMenu.active) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCodeActionMenu();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "h" || event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        if (codeActionMenu.actions.length > 0) {
          codeActionMenu = {
            ...codeActionMenu,
            selectedIndex: Math.max(0, codeActionMenu.selectedIndex - 1)
          };
          patchBottomRow();
        }
        return;
      }

      if (event.key === "ArrowRight" || event.key === "l" || event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        if (codeActionMenu.actions.length > 0) {
          codeActionMenu = {
            ...codeActionMenu,
            selectedIndex: Math.min(codeActionMenu.actions.length - 1, codeActionMenu.selectedIndex + 1)
          };
          patchBottomRow();
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const action = codeActionMenu.actions[codeActionMenu.selectedIndex];
        if (action) {
          void applyCodeActionInternal(action);
        } else {
          closeCodeActionMenu();
        }
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const action = codeActionMenu.actions[Number(event.key) - 1];
        if (action) {
          void applyCodeActionInternal(action);
        }
        return;
      }

      return;
    }

    if (commandLine.active) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandLine();
        textarea.focus();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const nextValue = commandLine.value;
        runCommandLineCommand(nextValue);
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

    if (hoverState.active && event.key === "Escape") {
      event.preventDefault();
      clearHover();
      return;
    }

    if (pendingAction) {
      const nextPending = pendingAction;
      pendingAction = null;
      patchBottomRow();

      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }

      if (nextPending.kind === "g") {
        const chordCommand = commandForGotoPrefix(event.key);

        if (chordCommand) {
          event.preventDefault();
          textarea.value = "";
          runCommand(chordCommand);
          return;
        }
      }

      if (nextPending.kind === "[" || nextPending.kind === "]") {
        const chordCommand = commandForBracketPrefix(nextPending.kind, event.key);

        if (chordCommand) {
          event.preventDefault();
          textarea.value = "";
          const previousRevision = state.revision;
          runCommand(chordCommand);
          recordRepeatableMotion(
            { kind: "paragraph", direction: nextPending.kind === "]" ? "next" : "prev" },
            state.revision !== previousRevision
          );
          return;
        }
      }

      if (nextPending.kind === "m") {
        if (event.key === "m") {
          event.preventDefault();
          textarea.value = "";
          const previousRevision = state.revision;
          runCommand(gotoMatchingBracket);
          recordRepeatableMotion({ kind: "matching-bracket" }, state.revision !== previousRevision);
          return;
        }

        if (event.key === "a" || event.key === "i") {
          event.preventDefault();
          pendingAction = {
            kind: "textobject",
            mode: event.key === "a" ? "around" : "inside"
          };
          return;
        }
      }

      if (nextPending.kind === "space") {
        event.preventDefault();

        if (event.key === "a") {
          void loadCodeActions();
          return;
        }

        if (event.key === "k") {
          const hoverOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
          const anchorElement = root.querySelector<HTMLElement>("[data-wx-editor-cursor='true']");
          const anchorRect = anchorElement?.getBoundingClientRect() ?? root.getBoundingClientRect();
          const activeDiagnostic = diagnostics.find((entry) => hoverOffset >= entry.from && hoverOffset < entry.to) ?? null;

          if (activeDiagnostic) {
            showDiagnosticTooltip(activeDiagnostic, anchorRect, true);
          } else {
            void requestHover(hoverOffset, anchorRect, true);
          }
          return;
        }
      }

      if (nextPending.kind === "find") {
        event.preventDefault();
        textarea.value = "";
        const previousRevision = state.revision;
        const command =
          nextPending.variant === "f"
            ? findNextChar(event.key)
            : nextPending.variant === "F"
              ? findPrevChar(event.key)
              : nextPending.variant === "t"
                ? findTillNextChar(event.key)
                : findTillPrevChar(event.key);
        runCommand(command);
        recordRepeatableMotion(
          { kind: "find", variant: nextPending.variant, target: event.key },
          state.revision !== previousRevision
        );
        return;
      }

      if (nextPending.kind === "textobject") {
        event.preventDefault();
        textarea.value = "";
        const previousRevision = state.revision;
        runCommand(selectTextobject(nextPending.mode, event.key));
        recordRepeatableMotion(
          { kind: "textobject", mode: nextPending.mode, object: event.key },
          state.revision !== previousRevision
        );
        return;
      }
    }

    if ((state.mode === "normal" || state.mode === "visual") && event.key === ":") {
      event.preventDefault();
      textarea.value = "";
      openCommandLine();
      return;
    }

    if ((state.mode === "normal" || state.mode === "visual") && event.key === " ") {
      event.preventDefault();
      pendingAction = { kind: "space" };
      patchBottomRow();
      return;
    }

    if ((state.mode === "normal" || state.mode === "visual") && event.key === "g") {
      event.preventDefault();
      pendingAction = { kind: "g" };
      return;
    }

    if ((state.mode === "normal" || state.mode === "visual") && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      pendingAction = { kind: event.key };
      return;
    }

    if ((state.mode === "normal" || state.mode === "visual") && event.key === "m") {
      event.preventDefault();
      pendingAction = { kind: "m" };
      return;
    }

    if ((state.mode === "normal" || state.mode === "visual") && ["f", "F", "t", "T"].includes(event.key)) {
      event.preventDefault();
      pendingAction = { kind: "find", variant: event.key as "f" | "F" | "t" | "T" };
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

  function handleMouseMove(event: MouseEvent): void {
    if (commandLine.active || codeActionMenu.active) {
      return;
    }

    const sourceElement = event.target instanceof Element ? event.target : null;
    const marker = sourceElement?.closest<HTMLElement>("[data-wx-editor-diagnostic-marker]");

    if (marker?.dataset.wxEditorDiagnosticMarker) {
      const row = marker.closest<HTMLElement>("[data-wx-editor-row]");
      const lineIndex = row?.dataset.wxEditorRow ? Number(row.dataset.wxEditorRow) - 1 : null;
      const diagnostic = lineIndex === null || Number.isNaN(lineIndex) ? null : getLineDiagnostics(lineIndex)[0] ?? null;

      if (diagnostic) {
        showDiagnosticTooltip(diagnostic, marker.getBoundingClientRect(), false);
        return;
      }
    }

    const target = sourceElement?.closest<HTMLElement>("[data-wx-editor-offset]") ?? null;
    const offset = target?.dataset.wxEditorOffset ? Number(target.dataset.wxEditorOffset) : null;

    if (offset === null || Number.isNaN(offset)) {
      clearHover(true);
      return;
    }

    if (hoverState.active && hoverState.offset === offset && !hoverState.pinned) {
      return;
    }

    const activeDiagnostic = diagnostics.find((entry) => offset >= entry.from && offset < entry.to) ?? null;

    if (activeDiagnostic) {
      showDiagnosticTooltip(activeDiagnostic, target.getBoundingClientRect(), false);
      return;
    }

    void requestHover(offset, target.getBoundingClientRect(), false);
  }

  function handleMouseLeave(): void {
    clearHover(true);
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
  viewportRows.addEventListener("mousemove", handleMouseMove);
  viewportRows.addEventListener("mouseleave", handleMouseLeave);
  unsubscribeController = controller.subscribe(handleControllerUpdate);

  refreshGutterWidth(true);
  renderVisibleRows(true);
  patchStatus();
  patchBottomRow();
  void syncLanguage([], true);
  refreshDiagnostics();

  return {
    controller,
    mount(nextContainer: HTMLElement) {
      mountedContainer = nextContainer;
      mountedContainer.replaceChildren(root);
      refreshGutterWidth(true);
      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
    },
    destroy() {
      destroyed = true;
      unsubscribeController();
      languageServices?.highlighter?.destroy?.();
      root.remove();
    },
    focus() {
      textarea.focus();
    },
    format() {
      return formatDocument();
    },
    getCodeActions() {
      return loadCodeActions();
    },
    applyCodeAction(action: EditorCodeAction) {
      return applyCodeActionInternal(action);
    },
    subscribe(listener) {
      return controller.subscribe(listener);
    },
    getState() {
      return controller.getState();
    },
    setFilePath(nextFilePath: string) {
      filePath = nextFilePath;
      patchStatus();
    },
    async setLanguageServices(nextLanguageServices: EditorLanguageServices | null) {
      languageServices?.highlighter?.destroy?.();
      languageServices = nextLanguageServices;
      languageRevision = -1;
      lastHighlightedRevision = -1;
      highlightCache.clear();
      highlightCoverage.clear();
      diagnostics = [];
      diagnosticsByLine = new Map();
      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
      await syncLanguage([], true);
      refreshDiagnostics();
    },
    async setLanguage(nextLanguage: LanguageProvider | null) {
      await this.setLanguageServices(languageProviderToServices(nextLanguage));
    },
    setTheme(nextTheme: ThemeSpec) {
      theme = nextTheme;
      applyThemeVariables(root, theme);
      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
    },
    async setValue(value: string) {
      highlightCache.clear();
      highlightCoverage.clear();
      languageRevision = -1;
      lastHighlightedRevision = -1;
      diagnostics = [];
      diagnosticsByLine = new Map();
      surface.scrollTop = 0;
      controller.replaceState(createEditorState({ value, selection: createSelection(0, 0) }));
      await syncLanguage([], true);
      refreshDiagnostics();
    }
  };
}
