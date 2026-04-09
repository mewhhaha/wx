import {
  addSurround,
  appendInsertMode,
  changeSelection,
  createEditorState,
  createCharacterSelection,
  createSelection,
  deleteSurround,
  deleteSelection,
  deleteBackwardIndentAware,
  deleteForward,
  enterInsertMode,
  enterNormalMode,
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets,
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
  replaceSurround,
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
  type EditorJumpEntry,
  type EditorController,
  type EditorUpdate
} from "@wx/editor-controller";
import {
  buildEditorLayout,
  buildEditorLayoutRow,
  type EditorLayoutModel,
  type EditorLayoutPanel,
  type EditorLayoutRow,
  type EditorLayoutRun,
  type EditorLayoutToken
} from "../../editor-layout/src/index";
import type {
  DiagnosticSeverity,
  EditorCodeAction,
  EditorDiagnostic,
  EditorHover,
  EditorLanguageServiceInput,
  EditorLanguageServices,
  HighlightRole,
  HighlightSpan,
  LanguageProvider,
  SyntaxTextobjectMode,
} from "@wx/editor-language";
import { languageProviderToServices } from "@wx/editor-language";
import { defaultTheme, createThemeVariables, type ThemeSpec } from "@wx/editor-theme";

export interface CreateEditorOptions {
  controller?: EditorController;
  filePath?: string;
  host?: EditorHostServices;
  value?: string;
  language?: LanguageProvider | null;
  languageServices?: EditorLanguageServiceInput | null;
  theme?: ThemeSpec;
  commandThemes?: readonly ThemeSpec[];
  softWrap?: boolean;
  indentGuides?: {
    render?: boolean;
    character?: string;
    skipLevels?: number;
  };
}

export type EditorLineChangeKind = "added" | "modified" | "deleted";

export interface EditorLineChange {
  line: number;
  kind: EditorLineChangeKind;
}

export interface EditorHostServices {
  writeFile?(context: { filePath: string; text: string }): Promise<void>;
  getLineChanges?(context: { filePath: string; text: string }): Promise<readonly EditorLineChange[]>;
  didWriteFile?(context: { filePath: string; text: string }): Promise<void> | void;
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
  setLanguageServices(languageServices: EditorLanguageServiceInput | null): Promise<void>;
  setLanguage(language: LanguageProvider | null): Promise<void>;
  setTheme(theme: ThemeSpec): void;
  setValue(value: string): Promise<void>;
}

interface LineFragment {
  offset: number | null;
  endOffset: number | null;
  text: string;
  role: HighlightRole;
  isIndentGuide: boolean;
  isSelected: boolean;
  isCursor: boolean;
  cursorKind: "block" | null;
  diagnosticSeverity: DiagnosticSeverity | null;
  isSearchMatch: boolean;
  isCurrentSearchMatch: boolean;
  isFlashTarget: boolean;
}

interface CommandLineState {
  active: boolean;
  value: string;
  prompt: ":" | "/" | "?";
}

interface SearchPreviewState {
  active: boolean;
  direction: "forward" | "backward";
  selection: EditorState["selection"];
  mode: EditorState["mode"];
  search: ReturnType<EditorController["getSearchState"]>;
  startOffset: number;
}

interface CommandCompletionItem {
  label: string;
  detail?: string;
  run(): void;
}

interface BottomMessageState {
  tone: "info" | "warning" | "error";
  text: string;
}

interface PickerItem {
  label: string;
  detail?: string;
  run(): void | Promise<void>;
}

interface PickerState {
  active: boolean;
  loading: boolean;
  title: string;
  items: readonly PickerItem[];
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

interface FlashHint {
  offset: number;
  label: string;
}

interface FlashState {
  active: boolean;
  target: string;
  input: string;
  hints: readonly FlashHint[];
}

interface LineChangeState {
  kind: Exclude<EditorLineChangeKind, "deleted"> | null;
  deleted: boolean;
}

type LineChangesByLine = Map<number, LineChangeState>;

type PendingAction =
  | null
  | { kind: "g" }
  | { kind: "[" | "]" }
  | { kind: "m" }
  | { kind: "space" }
  | { kind: "flash-target" }
  | { kind: "z"; sticky: boolean }
  | { kind: "find"; variant: "f" | "F" | "t" | "T" }
  | { kind: "textobject"; mode: "around" | "inside" }
  | { kind: "surround-add" }
  | { kind: "surround-delete" }
  | { kind: "surround-replace-from" }
  | { kind: "surround-replace-to"; fromObject: string }
  | { kind: "register-select"; insert: boolean };

type RepeatableMotion =
  | { kind: "find"; variant: "f" | "F" | "t" | "T"; target: string }
  | { kind: "matching-bracket" }
  | { kind: "paragraph"; direction: "next" | "prev" }
  | { kind: "textobject"; mode: "around" | "inside"; object: string }
  | { kind: "search"; reverse: boolean };

const DIAGNOSTIC_SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3
};

const SURFACE_VERTICAL_PADDING = 16;
const EMPTY_CELL_TEXT = "\u00a0";
const INSERT_TAB_TEXT = "  ";
const DEFAULT_INDENT_GUIDE_CHARACTER = "│";
const VIEWPORT_OVERSCAN_LINES = 6;
const VERTICAL_SCROLLOFF_ROWS = 3;
const END_OF_LINE_DIAGNOSTIC_MIN: DiagnosticSeverity = "hint";
const CURSOR_LINE_INLINE_DIAGNOSTIC_MIN: DiagnosticSeverity = "warning";
const OTHER_LINES_INLINE_DIAGNOSTIC_MIN: DiagnosticSeverity = "error";
const FLASH_HOME_BIAS_LETTERS = [..."fjdkslagheruiwovncmptyqbzx"];
const FLASH_ALL_LETTERS = [..."qwertyuiopasdfghjklzxcvbnm"];
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

interface RowView {
  visualRowIndex: number;
  host: HTMLDivElement;
  row: HTMLDivElement;
  gutter: HTMLDivElement;
  content: HTMLDivElement;
}

interface LineViewport {
  fromLine: number;
  toLine: number;
}

interface VisualRow {
  docLine: number;
  visualRowIndex: number;
  segmentStart: number;
  segmentEnd: number;
  startColumn: number;
  isContinuation: boolean;
  isLastSegment: boolean;
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

function tokenToDiagnosticSeverity(
  token: EditorLayoutToken
): DiagnosticSeverity | null {
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

function toneForSeverity(severity: DiagnosticSeverity): "info" | "warning" | "error" {
  return severity === "error" ? "error" : severity === "warning" ? "warning" : "info";
}

function meetsDiagnosticThreshold(severity: DiagnosticSeverity, minimum: DiagnosticSeverity): boolean {
  return DIAGNOSTIC_SEVERITY_ORDER[severity] <= DIAGNOSTIC_SEVERITY_ORDER[minimum];
}

function normalizeLanguageServices(input: EditorLanguageServiceInput | null | undefined): EditorLanguageServices[] {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? [...input] : [input];
}

function normalizeCommandThemes(themes: readonly ThemeSpec[] | undefined, activeTheme: ThemeSpec): ThemeSpec[] {
  const seen = new Set<string>();
  const nextThemes: ThemeSpec[] = [];

  for (const theme of [activeTheme, defaultTheme, ...(themes ?? [])]) {
    const key = theme.name.trim().toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextThemes.push(theme);
  }

  return nextThemes;
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
      box-sizing: border-box;
      background: var(--wx-color-background);
      color: var(--wx-color-text);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 18px;
      font: 15px/1.6 "Monaspace Argon NF", "Monaspace Argon", "Iosevka Web", "SFMono-Regular", "Monaco", monospace;
      font-variant-ligatures: contextual discretionary-ligatures;
      font-feature-settings:
        "calt" 1,
        "liga" 1,
        "ss01" 1,
        "ss02" 1,
        "ss03" 1,
        "ss04" 1,
        "ss05" 1,
        "ss06" 1,
        "ss07" 1,
        "ss08" 1,
        "ss09" 1,
        "ss10" 1;
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

    .wx-editor__viewport {
      display: grid;
      grid-template-columns: 1ch max-content 2ch minmax(0, 1fr);
      column-gap: 0;
    }

    .wx-editor__spacer {
      height: 0;
      pointer-events: none;
    }

    .wx-editor__row {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
      align-items: center;
      min-height: var(--wx-line-height, 24px);
      white-space: pre;
    }

    .wx-editor__line-group {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
    }

    .wx-row-active {
      background: color-mix(in srgb, var(--wx-color-current-line) 88%, transparent);
    }

    .wx-editor__gutter {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / 4;
      align-items: stretch;
      justify-items: stretch;
      color: var(--wx-color-gutter);
      user-select: none;
    }

    .wx-editor__gutter-number {
      display: inline-block;
      min-width: 0;
      width: 100%;
      text-align: right;
      justify-self: stretch;
      grid-column: 2;
    }

    .wx-editor__gutter-change {
      position: relative;
      width: 0.45ch;
      min-height: var(--wx-line-height, 24px);
      height: 100%;
      justify-self: center;
      align-self: stretch;
      visibility: hidden;
      grid-column: 3;
    }

    .wx-editor__gutter-change[data-change="added"] {
      visibility: visible;
      background: #22c55e;
    }

    .wx-editor__gutter-change[data-change="modified"] {
      visibility: visible;
      background: #f59e0b;
    }

    .wx-editor__gutter-change[data-deleted="true"]::after {
      content: "";
      position: absolute;
      left: -0.1ch;
      right: -0.1ch;
      bottom: 0;
      height: 2px;
      background: #ef4444;
    }

    .wx-editor__gutter-marker {
      width: 0.55ch;
      height: 0.55ch;
      border-radius: 999px;
      flex: 0 0 auto;
      justify-self: center;
      align-self: center;
      visibility: hidden;
      grid-column: 1;
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
      grid-column: 4;
    }

    .wx-editor__line-text {
      display: inline-flex;
      flex: 0 0 auto;
      padding-right: 1ch;
      line-height: inherit;
      align-self: baseline;
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

    .wx-indent-guide {
      color: color-mix(in srgb, var(--wx-color-gutter) 88%, transparent);
    }

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
      flex: 1 1 0;
      min-width: 0;
      padding-left: 1ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      line-height: inherit;
      align-self: baseline;
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
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
      align-items: start;
      min-height: calc(var(--wx-line-height, 24px) * 0.95);
    }

    .wx-editor__diagnostic-gutter {
      grid-column: 1 / 4;
      color: transparent;
      user-select: none;
    }

    .wx-editor__diagnostic-content {
      position: relative;
      min-height: calc(var(--wx-line-height, 24px) * 0.95);
      white-space: pre-wrap;
      grid-column: 4;
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
    }

    .wx-search-match {
      background: color-mix(in srgb, #facc15 24%, transparent);
    }

    .wx-search-current {
      background: color-mix(in srgb, #f59e0b 42%, transparent);
    }

    .wx-flash-target {
      background: #fb7185;
      color: transparent;
      text-decoration-color: transparent;
    }

    .wx-editor__flash-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 3;
    }

    .wx-editor__flash-hint {
      position: absolute;
      top: 0;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      height: var(--wx-line-height, 24px);
      min-width: 1ch;
      padding: 0;
      background: transparent;
      color: #fff7ed;
      font-weight: 700;
      line-height: var(--wx-line-height, 24px);
      box-shadow: none;
      white-space: pre;
    }

    .wx-cursor-block {
      display: inline-block;
      min-width: 1ch;
      color: var(--wx-color-cursor-text);
      background: var(--wx-color-cursor);
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
      box-sizing: border-box;
      flex: 0 0 var(--wx-line-height, 24px);
      height: var(--wx-line-height, 24px);
      padding: 0 1ch 0 0;
      background: #0b0d12;
      border-top: 1px solid rgba(148, 163, 184, 0.14);
      color: #dbe2f0;
      font-size: 15px;
      line-height: var(--wx-line-height, 24px);
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
      box-sizing: border-box;
      flex: 0 0 var(--wx-line-height, 24px);
      height: var(--wx-line-height, 24px);
      background: #0a0b0f;
      border-top: 1px solid rgba(148, 163, 184, 0.08);
      color: #dbe2f0;
      display: flex;
      align-items: center;
      padding: 0 1ch;
      line-height: var(--wx-line-height, 24px);
      white-space: pre;
    }

    .wx-editor__command-popover {
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(var(--wx-line-height, 24px) * 2);
      display: flex;
      justify-content: flex-start;
      padding: 0 1ch 8px;
      pointer-events: none;
      z-index: 5;
    }

    .wx-editor__command-popover[hidden] {
      display: none;
    }

    .wx-editor__command-popover-panel {
      min-width: min(42ch, calc(100% - 2ch));
      max-width: min(64ch, calc(100% - 2ch));
      max-height: calc(var(--wx-line-height, 24px) * 6);
      overflow: hidden;
      border: 1px solid rgba(148, 163, 184, 0.16);
      background: rgba(10, 11, 15, 0.98);
      box-shadow: 0 18px 40px rgba(2, 8, 23, 0.35);
    }

    .wx-editor__command-completion {
      display: grid;
      grid-template-columns: minmax(0, auto) minmax(0, 1fr);
      align-items: center;
      gap: 2ch;
      min-height: var(--wx-line-height, 24px);
      padding: 0 1ch;
      color: #dbe2f0;
      white-space: nowrap;
    }

    .wx-editor__command-completion[data-selected="true"] {
      background: color-mix(in srgb, var(--wx-color-selection) 80%, transparent);
      color: #ffffff;
    }

    .wx-editor__command-completion-label {
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 700;
    }

    .wx-editor__command-completion-detail {
      overflow: hidden;
      text-overflow: ellipsis;
      color: #aeb8cb;
      text-align: right;
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
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
      align-items: center;
      min-height: var(--wx-line-height, 24px);
      color: color-mix(in srgb, var(--wx-color-gutter) 80%, transparent);
      user-select: none;
    }

    .wx-editor__filler-gutter {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / 4;
      align-items: center;
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
  probe.style.font =
    '15px/1.6 "Monaspace Argon NF", "Monaspace Argon", "Iosevka Web", "SFMono-Regular", "Monaco", monospace';
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
    case "c":
      return changeSelection;
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
    case "c":
      return changeSelection;
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
    case "Tab":
      return insertText(INSERT_TAB_TEXT);
    case "ArrowLeft":
      return moveLeft;
    case "ArrowRight":
      return moveRight;
    case "ArrowUp":
      return moveUp;
    case "ArrowDown":
      return moveDown;
    case "Backspace":
      return deleteBackwardIndentAware(INSERT_TAB_TEXT);
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keyboardPosition(letter: string): { row: number; column: number } | null {
  const normalized = letter.toLowerCase();

  for (let row = 0; row < KEYBOARD_ROWS.length; row += 1) {
    const column = KEYBOARD_ROWS[row]?.indexOf(normalized) ?? -1;
    if (column >= 0) {
      return { row, column };
    }
  }

  return null;
}

function keyboardDistance(from: string, to: string): number {
  const left = keyboardPosition(from);
  const right = keyboardPosition(to);

  if (!left || !right) {
    return FLASH_ALL_LETTERS.length;
  }

  return Math.abs(left.row - right.row) * 3 + Math.abs(left.column - right.column);
}

function flashAlphabet(target: string): string[] {
  const normalizedTarget = target.toLowerCase();
  const unique = new Set<string>([normalizedTarget, ...FLASH_ALL_LETTERS]);
  return [...unique].sort((left, right) => {
    if (left === normalizedTarget) {
      return -1;
    }

    if (right === normalizedTarget) {
      return 1;
    }

    const distanceDelta = keyboardDistance(normalizedTarget, left) - keyboardDistance(normalizedTarget, right);
    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    return FLASH_HOME_BIAS_LETTERS.indexOf(left) - FLASH_HOME_BIAS_LETTERS.indexOf(right);
  });
}

function buildFlashLabels(target: string, count: number): string[] {
  const alphabet = flashAlphabet(target);
  const labels: string[] = [];

  for (let index = 0; index < count; index += 1) {
    labels.push(alphabet[index % alphabet.length] ?? alphabet[0] ?? target.toLowerCase());
  }

  return labels;
}

function searchFlagsAtOffset(
  matches: readonly { from: number; to: number }[],
  current: { from: number; to: number } | null,
  offset: number
): { isSearchMatch: boolean; isCurrentSearchMatch: boolean } {
  const isSearchMatch = matches.some((entry) => offset >= entry.from && offset < entry.to);
  const isCurrentSearchMatch = !!current && offset >= current.from && offset < current.to;
  return { isSearchMatch, isCurrentSearchMatch };
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

function resolveOffsetWithinRun(
  target: HTMLElement,
  startOffset: number,
  endOffset: number | null,
  clientX: number
): number {
  if (endOffset === null || endOffset <= startOffset + 1) {
    return startOffset;
  }

  const rect = target.getBoundingClientRect();
  const width = rect.width;

  if (!Number.isFinite(width) || width <= 0) {
    return startOffset;
  }

  const runLength = endOffset - startOffset;
  const relativeX = Math.max(0, Math.min(width, clientX - rect.left));
  const ratio = width > 0 ? relativeX / width : 0;
  const index = Math.min(runLength - 1, Math.max(0, Math.floor(ratio * runLength)));
  return startOffset + index;
}

function getIndentGuideOffsets(
  lineText: string,
  lineStart: number,
  options: { render: boolean; character: string; skipLevels: number; indentWidth: number }
): Set<number> {
  const offsets = new Set<number>();

  if (!options.render || !lineText || options.indentWidth <= 0) {
    return offsets;
  }

  let visualColumn = 0;
  let indentLevel = 0;

  for (let index = 0; index < lineText.length; index += 1) {
    const character = lineText[index];

    if (character !== " " && character !== "\t") {
      break;
    }

    if (visualColumn % options.indentWidth === 0) {
      if (indentLevel >= options.skipLevels) {
        offsets.add(lineStart + index);
      }
      indentLevel += 1;
    }

    visualColumn += character === "\t" ? options.indentWidth : 1;
  }

  return offsets;
}

function renderLineFragments(
  line: { start: number; text: string },
  state: EditorState,
  spans: HighlightSpan[],
  lineDiagnostics: readonly EditorDiagnostic[],
  lineSearchMatches: readonly { from: number; to: number }[],
  currentSearchMatch: { from: number; to: number } | null,
  flashOffsets: ReadonlySet<number>,
  segmentStart: number,
  segmentEnd: number,
  includeLineEndingCell: boolean,
  indentGuideOptions: { render: boolean; character: string; skipLevels: number; indentWidth: number }
): LineFragment[] {
  const fragments: LineFragment[] = [];
  const activeOffset = getActiveCharacterOffset(state);
  const selection = getSelectionOffsets(state);
  const lineEnd = line.start + line.text.length;
  const segmentStartIndex = Math.max(0, segmentStart - line.start);
  const segmentEndIndex = Math.max(segmentStartIndex, segmentEnd - line.start);
  const indentGuideOffsets = getIndentGuideOffsets(line.text, line.start, indentGuideOptions);
  const pushFragment = (fragment: LineFragment): void => {
    const previous = fragments[fragments.length - 1];

    if (
      previous &&
      previous.offset !== null &&
      previous.endOffset !== null &&
      fragment.offset !== null &&
      fragment.endOffset !== null &&
      !previous.isCursor &&
      !fragment.isCursor &&
      previous.role === fragment.role &&
      previous.isIndentGuide === fragment.isIndentGuide &&
      previous.isSelected === fragment.isSelected &&
      previous.isSearchMatch === fragment.isSearchMatch &&
      previous.isCurrentSearchMatch === fragment.isCurrentSearchMatch &&
      previous.isFlashTarget === fragment.isFlashTarget &&
      previous.diagnosticSeverity === fragment.diagnosticSeverity &&
      previous.endOffset === fragment.offset
    ) {
      previous.text += fragment.text;
      previous.endOffset = fragment.endOffset;
      return;
    }

    fragments.push(fragment);
  };

  if (state.mode === "insert") {
    if (line.text.length === 0) {
      return [
        {
          offset: line.start,
          endOffset: line.start + 1,
          text: EMPTY_CELL_TEXT,
          role: "text",
          isIndentGuide: false,
          isSelected: false,
          isCursor: false,
          cursorKind: null,
          diagnosticSeverity: null,
          isSearchMatch: false,
          isCurrentSearchMatch: false,
          isFlashTarget: false
        }
      ];
    }

    for (let index = segmentStartIndex; index < segmentEndIndex; index += 1) {
      const offset = line.start + index;

      const searchFlags = searchFlagsAtOffset(lineSearchMatches, currentSearchMatch, offset);
      pushFragment({
        offset,
        endOffset: offset + 1,
        text: indentGuideOffsets.has(offset) ? indentGuideOptions.character : line.text[index] ?? EMPTY_CELL_TEXT,
        role: roleAtOffset(spans, offset),
        isIndentGuide: indentGuideOffsets.has(offset),
        isSelected: false,
        isCursor: false,
        cursorKind: null,
        diagnosticSeverity: diagnosticSeverityAtOffset(lineDiagnostics, offset),
        isSearchMatch: searchFlags.isSearchMatch,
        isCurrentSearchMatch: searchFlags.isCurrentSearchMatch,
        isFlashTarget: flashOffsets.has(offset)
      });
    }

    return fragments;
  }

  if (line.text.length === 0) {
    const selected = selection.from <= line.start && line.start < selection.to;
    return [
      {
        offset: line.start,
        endOffset: line.start + 1,
        text: EMPTY_CELL_TEXT,
        role: "text",
        isIndentGuide: false,
        isSelected: selected,
        isCursor: activeOffset === line.start,
        cursorKind: activeOffset === line.start ? "block" : null,
        diagnosticSeverity: null,
        isSearchMatch: false,
        isCurrentSearchMatch: false,
        isFlashTarget: false
      }
    ];
  }

  for (let index = segmentStartIndex; index < segmentEndIndex; index += 1) {
    const offset = line.start + index;
    const searchFlags = searchFlagsAtOffset(lineSearchMatches, currentSearchMatch, offset);
    pushFragment({
      offset,
      endOffset: offset + 1,
      text: indentGuideOffsets.has(offset) ? indentGuideOptions.character : line.text[index] ?? " ",
      role: roleAtOffset(spans, offset),
      isIndentGuide: indentGuideOffsets.has(offset),
      isSelected: offset >= selection.from && offset < selection.to,
      isCursor: offset === activeOffset,
      cursorKind: offset === activeOffset ? "block" : null,
      diagnosticSeverity: diagnosticSeverityAtOffset(lineDiagnostics, offset),
      isSearchMatch: searchFlags.isSearchMatch,
      isCurrentSearchMatch: searchFlags.isCurrentSearchMatch,
      isFlashTarget: flashOffsets.has(offset)
    });
  }

  const hasLineEnding = lineEnd < state.doc.length && state.doc.text[lineEnd] === "\n";
  const lineEndingSelected = hasLineEnding && lineEnd >= selection.from && lineEnd < selection.to;
  const lineEndingCursor = hasLineEnding && activeOffset === lineEnd;

  if (includeLineEndingCell && (lineEndingSelected || lineEndingCursor)) {
    pushFragment({
      offset: lineEnd,
      endOffset: lineEnd + 1,
      text: EMPTY_CELL_TEXT,
      role: "text",
      isIndentGuide: false,
      isSelected: lineEndingSelected,
      isCursor: lineEndingCursor,
      cursorKind: lineEndingCursor ? "block" : null,
      diagnosticSeverity: null,
      isSearchMatch: false,
      isCurrentSearchMatch: false,
      isFlashTarget: false
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

function expandViewport(
  viewport: { fromLine: number; toLine: number },
  totalVisualRows: number
): { fromLine: number; toLine: number } {
  return normalizeViewport(
    {
      fromLine: viewport.fromLine - VIEWPORT_OVERSCAN_LINES,
      toLine: viewport.toLine + VIEWPORT_OVERSCAN_LINES
    },
    totalVisualRows
  );
}

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
      theme: options.theme?.name
    });
  let state = controller.getState();
  let filePath = options.filePath ?? "untitled.ts";
  const host = options.host ?? null;
  let languageServices = normalizeLanguageServices(
    options.languageServices ?? languageProviderToServices(options.language ?? null)
  );
  let theme = options.theme ?? defaultTheme;
  controller.setFilePath(filePath);
  controller.setThemeName(theme.name);
  controller.setHostServices(host);
  controller.setLanguageServices(languageServices);
  const presentation = controller.getPresentationState();
  const viewportState = presentation.viewport;
  const languageState = presentation.language;
  const uiState = presentation.ui;
  let rowViews: RowView[] = [];
  let renderedViewport: LineViewport = { fromLine: 0, toLine: -1 };
  let visualRows = [...viewportState.visualRows] as VisualRow[];
  let lineVisualRanges = [...viewportState.lineVisualRanges] as Array<{ from: number; to: number }>;
  let wrapColumns = viewportState.wrapColumns;
  let wrapRevision = viewportState.wrapRevision;
  let commandLine: CommandLineState = uiState.commandLine;
  let bottomMessage: BottomMessageState | null = uiState.bottomMessage as BottomMessageState | null;
  let pickerState: PickerState = {
    active: uiState.picker.active,
    loading: uiState.picker.loading,
    title: uiState.picker.title,
    items: [],
    selectedIndex: uiState.picker.selectedIndex,
    error: uiState.picker.error
  };
  let stickyViewMode = uiState.stickyViewMode;
  let hoverState: HoverState = uiState.hover as HoverState;
  let diagnostics = languageState.diagnostics;
  let diagnosticsByLine = languageState.diagnosticsByLine;
  let lineChangesByLine: LineChangesByLine = languageState.lineChangesByLine as LineChangesByLine;
  let pickerActions: readonly PickerItem[] = [];
  let flashState: FlashState = uiState.flash as FlashState;
  let pendingAction: PendingAction = uiState.pendingAction;
  let pendingCount = uiState.pendingCount;
  let lastRepeatableMotion: RepeatableMotion | null = uiState.lastRepeatableMotion;
  let languageRevision = languageState.languageRevision;
  let hoverRenderRequestId = 0;
  let gutterWidth = 0;
  let anchoredTopVisualRow = viewportState.topVisualRow;
  let visibleLineCapacity = viewportState.visibleRowCapacity;
  let commandCompletionIndex = uiState.commandCompletionIndex;
  let previewTheme: ThemeSpec | null = null;
  let destroyed = false;
  let mountedContainer: HTMLElement | null = container;
  let unsubscribeController = () => {};
  let currentLayoutModel: EditorLayoutModel | null = null;
  let searchPreviewState: SearchPreviewState | null = null;
  let pendingMountFrame = 0;
  let resizeObserver: ResizeObserver | null = null;
  let availableCommandThemes = normalizeCommandThemes(options.commandThemes, options.theme ?? defaultTheme);
  previewTheme = uiState.previewTheme
    ? availableCommandThemes.find((entry) => entry.name === uiState.previewTheme) ?? null
    : null;

  function syncViewportMirrors(): void {
    anchoredTopVisualRow = viewportState.topVisualRow;
    visibleLineCapacity = viewportState.visibleRowCapacity;
    wrapColumns = viewportState.wrapColumns;
    wrapRevision = viewportState.wrapRevision;
    visualRows = viewportState.visualRows as VisualRow[];
    lineVisualRanges = viewportState.lineVisualRanges as Array<{ from: number; to: number }>;
  }

  function syncLanguageMirrors(): void {
    diagnostics = languageState.diagnostics;
    diagnosticsByLine = languageState.diagnosticsByLine;
    lineChangesByLine = languageState.lineChangesByLine as LineChangesByLine;
    languageRevision = languageState.languageRevision;
  }

  function syncUiMirrors(): void {
    commandLine = uiState.commandLine;
    bottomMessage = uiState.bottomMessage as BottomMessageState | null;
    stickyViewMode = uiState.stickyViewMode;
    hoverState = uiState.hover as HoverState;
    flashState = uiState.flash as FlashState;
    pendingAction = uiState.pendingAction;
    pendingCount = uiState.pendingCount;
    lastRepeatableMotion = uiState.lastRepeatableMotion;
    pickerState = {
      active: uiState.picker.active,
      loading: uiState.picker.loading,
      title: uiState.picker.title,
      items: uiState.picker.items.map((item) => ({
        label: item.label,
        detail: item.detail,
        run() {}
      })),
      selectedIndex: uiState.picker.selectedIndex,
      error: uiState.picker.error
    };
    commandCompletionIndex = uiState.commandCompletionIndex;
    previewTheme = uiState.previewTheme
      ? availableCommandThemes.find((entry) => entry.name === uiState.previewTheme) ?? null
      : null;
  }

  function syncPresentationMirrors(): void {
    filePath = presentation.filePath;
    syncViewportMirrors();
    syncLanguageMirrors();
    syncUiMirrors();
    currentLayoutModel = null;
  }

  syncPresentationMirrors();

  function updateControllerUiPresentation(
    updater: (ui: typeof uiState) => void,
    effectType = "presentation.ui"
  ): void {
    controller.updatePresentationState((presentation) => {
      updater(presentation.ui);
    }, effectType, { defer: true });
  }

  function setCommandLineState(next: CommandLineState): void {
    if (
      commandLine.active === next.active &&
      commandLine.value === next.value &&
      commandLine.prompt === next.prompt
    ) {
      return;
    }
    commandLine = next;
    currentLayoutModel = null;
    updateControllerUiPresentation((ui) => {
      ui.commandLine = next;
    }, "ui.command-line");
  }

  function setBottomMessageState(next: BottomMessageState | null): void {
    if (
      bottomMessage?.tone === next?.tone &&
      bottomMessage?.text === next?.text &&
      (!!bottomMessage === !!next)
    ) {
      return;
    }
    bottomMessage = next;
    currentLayoutModel = null;
    updateControllerUiPresentation((ui) => {
      ui.bottomMessage = next;
    }, "ui.bottom-message");
  }

  function setHoverPresentation(next: HoverState): void {
    hoverState = next;
    uiState.hover = next;
    currentLayoutModel = null;
  }

  function setFlashPresentation(next: FlashState): void {
    flashState = next;
    uiState.flash = next;
    currentLayoutModel = null;
  }

  function setPendingActionState(next: PendingAction): void {
    pendingAction = next;
    currentLayoutModel = null;
    updateControllerUiPresentation((ui) => {
      ui.pendingAction = next;
    }, "ui.pending-action");
  }

  function setPendingCountState(next: string): void {
    pendingCount = next;
    currentLayoutModel = null;
    updateControllerUiPresentation((ui) => {
      ui.pendingCount = next;
    }, "ui.pending-count");
  }

  function setStickyViewModeState(next: boolean): void {
    stickyViewMode = next;
    currentLayoutModel = null;
    updateControllerUiPresentation((ui) => {
      ui.stickyViewMode = next;
    }, "ui.sticky-view-mode");
  }

  function setCommandCompletionIndexState(next: number): void {
    if (commandCompletionIndex === next) {
      return;
    }
    commandCompletionIndex = next;
    currentLayoutModel = null;
    updateControllerUiPresentation((ui) => {
      ui.commandCompletionIndex = next;
    }, "ui.command-completion-index");
  }

  function setLastRepeatableMotionState(next: RepeatableMotion | null): void {
    lastRepeatableMotion = next;
    currentLayoutModel = null;
    updateControllerUiPresentation((ui) => {
      ui.lastRepeatableMotion = next;
    }, "ui.repeatable-motion");
  }

  function setPreviewThemeState(next: ThemeSpec | null): void {
    if (previewTheme?.name === next?.name || (!previewTheme && !next)) {
      return;
    }
    previewTheme = next;
    currentLayoutModel = null;
    updateControllerUiPresentation((ui) => {
      ui.previewTheme = next?.name ?? null;
    }, "ui.preview-theme");
  }

  function setPickerPresentation(next: PickerState): void {
    if (
      pickerState.active === next.active &&
      pickerState.loading === next.loading &&
      pickerState.title === next.title &&
      pickerState.selectedIndex === next.selectedIndex &&
      pickerState.error === next.error &&
      pickerState.items.length === next.items.length &&
      pickerState.items.every(
        (item, index) =>
          item.label === next.items[index]?.label &&
          item.detail === next.items[index]?.detail
      )
    ) {
      return;
    }
    pickerState = next;
    currentLayoutModel = null;
    updateControllerUiPresentation((ui) => {
      ui.picker = {
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
    }, "ui.picker");
  }

  const getHighlighter = () => languageServices.find((services) => services.highlighter)?.highlighter;
  const getSyntaxSelector = () => languageServices.find((services) => services.syntaxSelector)?.syntaxSelector;
  const getDiagnosticsSource = () => languageServices.find((services) => services.diagnostics)?.diagnostics;
  const getCommentToggler = () => languageServices.find((services) => services.comments)?.comments;
  const getSyntaxTextobjectProvider = () => languageServices.find((services) => services.syntaxTextobjects)?.syntaxTextobjects;
  const getSyntaxNavigationProvider = () => languageServices.find((services) => services.syntaxNavigation)?.syntaxNavigation;

  function buildLayoutModelForViewport(_viewport: LineViewport): EditorLayoutModel {
    if (currentLayoutModel) {
      return currentLayoutModel;
    }

    const model = buildEditorLayout({
      state,
      presentation,
      hoverAnchor: {
        col: Math.max(0, Math.floor(hoverState.left / Math.max(metrics.charWidth, 1))),
        row: Math.max(0, Math.floor(hoverState.top / Math.max(metrics.lineHeight, 1)))
      },
      indentGuides
    });

    currentLayoutModel = model;
    return model;
  }

  function schedulePostMountReveal(): void {
    if (pendingMountFrame) {
      cancelAnimationFrame(pendingMountFrame);
      pendingMountFrame = 0;
    }

    pendingMountFrame = requestAnimationFrame(() => {
      pendingMountFrame = 0;
      if (destroyed || !mountedContainer?.isConnected) {
        return;
      }
      refreshGutterWidth(true);
      refreshViewportMetricsIfNeeded(true);
      revealCursor();
      renderVisibleRows(true);
    });
  }

  const root = document.createElement("div");
  const surface = document.createElement("div");
  const rows = document.createElement("div");
  const viewportRows = document.createElement("div");
  const tooltip = document.createElement("div");
  const commandPopover = document.createElement("div");
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

  viewportRows.className = "wx-editor__viewport";
  viewportRows.dataset.wxEditor = "viewport";

  tooltip.className = "wx-editor__tooltip";
  tooltip.dataset.wxEditorTooltip = "true";
  tooltip.hidden = true;

  commandPopover.className = "wx-editor__command-popover";
  commandPopover.dataset.wxEditorCommandPopover = "true";
  commandPopover.hidden = true;

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
  rows.append(viewportRows);
  surface.append(rows, tooltip, textarea);
  root.append(surface, commandPopover, status, bottomRow);
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

  function getContentColumns(): number {
    if (!softWrap) {
      return Number.MAX_SAFE_INTEGER;
    }

    const surfaceWidth = surface.clientWidth || root.clientWidth || container.clientWidth || 800;
    const contentWidth = Math.max(metrics.charWidth, surfaceWidth - gutterWidth - 8);
    return Math.max(1, Math.floor(contentWidth / metrics.charWidth));
  }

  function measureVisibleLineCapacity(): number {
    const viewportHeight = Math.max(
      metrics.lineHeight,
      (surface.clientHeight || metrics.lineHeight * 20) - SURFACE_VERTICAL_PADDING * 2
    );
    return Math.max(1, Math.ceil(viewportHeight / metrics.lineHeight));
  }

  function syncMeasuredViewportMetrics(force = false): boolean {
    const nextVisibleLineCapacity = measureVisibleLineCapacity();
    const nextWrapColumns = getContentColumns();

    if (
      !force &&
      nextVisibleLineCapacity === visibleLineCapacity &&
      nextWrapColumns === wrapColumns &&
      viewportState.softWrap === softWrap
    ) {
      return false;
    }

    controller.setViewportMetrics({
      visibleRowCapacity: nextVisibleLineCapacity,
      wrapColumns: nextWrapColumns,
      softWrap
    });
    return true;
  }

  function refreshViewportMetricsIfNeeded(force = false): boolean {
    const changed = syncMeasuredViewportMetrics(force);
    if (changed) {
      syncPresentationMirrors();
    }
    return changed;
  }

  function getVisualRow(visualRowIndex: number): VisualRow {
    return visualRows[Math.max(0, Math.min(visualRows.length - 1, visualRowIndex))] ?? {
      docLine: 0,
      visualRowIndex: 0,
      segmentStart: 0,
      segmentEnd: 0,
      startColumn: 0,
      isContinuation: false,
      isLastSegment: true
    };
  }

  function getVisibleLineCountForViewport(viewport: LineViewport): number {
    return Math.max(1, viewport.toLine - viewport.fromLine + 1);
  }

  function getLineViewportForVisualViewport(viewport: LineViewport): LineViewport {
    if (visualRows.length === 0) {
      return { fromLine: 0, toLine: Math.max(0, state.doc.lineCount - 1) };
    }

    const fromRow = getVisualRow(viewport.fromLine);
    const toRow = getVisualRow(viewport.toLine);

    return normalizeViewport(
      {
        fromLine: fromRow.docLine,
        toLine: toRow.docLine
      },
      state.doc.lineCount
    );
  }

  function getVisualRowForOffset(offset: number): { rowIndex: number; column: number; row: VisualRow } {
    const position = state.doc.positionAt(offset);
    const line = state.doc.lineAt(position.line);
    const range = lineVisualRanges[position.line] ?? { from: 0, to: 0 };
    const rowOffset = softWrap && wrapColumns !== Number.MAX_SAFE_INTEGER ? Math.floor(position.column / wrapColumns) : 0;
    const rowIndex = Math.max(range.from, Math.min(range.to, range.from + rowOffset));
    const row = getVisualRow(rowIndex);
    const maxColumn = Math.max(0, line.text.length - row.startColumn);
    return {
      rowIndex,
      column: Math.max(0, Math.min(maxColumn, position.column - row.startColumn)),
      row
    };
  }

  function isDocLineVisible(lineIndex: number): boolean {
    const range = lineVisualRanges[lineIndex];
    return !!range && range.to >= renderedViewport.fromLine && range.from <= renderedViewport.toLine;
  }

  function createRowView(visualRowIndex: number): RowView {
    const visualRow = getVisualRow(visualRowIndex);
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
  }

  function viewportEquals(left: LineViewport, right: LineViewport): boolean {
    return left.fromLine === right.fromLine && left.toLine === right.toLine;
  }

  function refreshGutterWidth(force = false): void {
    const nextWidth = Math.max(metrics.charWidth * 6, measureGutterWidth());

    if (!force && nextWidth === gutterWidth) {
      return;
    }

    gutterWidth = nextWidth;
  }

  function measureGutterWidth(): number {
    const sample = document.createElement("div");
    const marker = document.createElement("span");
    const number = document.createElement("span");
    const change = document.createElement("span");

    sample.className = "wx-editor__gutter";
    marker.className = "wx-editor__gutter-marker";
    number.className = "wx-editor__gutter-number";
    change.className = "wx-editor__gutter-change";
    number.textContent = String(Math.max(1, state.doc.lineCount));
    sample.append(marker, number, change);
    sample.style.position = "absolute";
    sample.style.visibility = "hidden";
    sample.style.pointerEvents = "none";
    root.append(sample);
    const width = Math.ceil(sample.getBoundingClientRect().width);
    sample.remove();
    return width;
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

  function getLineChangeState(lineIndex: number): LineChangeState {
    return lineChangesByLine.get(lineIndex) ?? { kind: null, deleted: false };
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

  function isFlashJumpOffset(offset: number, target: string): boolean {
    const character = state.doc.text[offset] ?? "";

    if (!character || character !== target) {
      return false;
    }

    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    return offset !== activeOffset;
  }

  function getActiveFlashHints(): readonly FlashHint[] {
    if (!flashState.active) {
      return [];
    }
    return flashState.hints;
  }

  function getFlashHintsForVisualRow(visualRow: VisualRow): readonly FlashHint[] {
    const hints = getActiveFlashHints();
    return hints.filter((hint) => hint.offset >= visualRow.segmentStart && hint.offset < visualRow.segmentEnd);
  }

  function getFlashOffsetsForVisualRow(visualRow: VisualRow): ReadonlySet<number> {
    return new Set(getFlashHintsForVisualRow(visualRow).map((hint) => hint.offset));
  }

  function collectVisibleFlashHints(target: string): readonly FlashHint[] {
    const viewport = getVisibleViewport();
    const offsets: number[] = [];

    for (let visualRowIndex = viewport.fromLine; visualRowIndex <= viewport.toLine; visualRowIndex += 1) {
      const visualRow = getVisualRow(visualRowIndex);

      for (let offset = visualRow.segmentStart; offset < visualRow.segmentEnd; offset += 1) {
        if (isFlashJumpOffset(offset, target)) {
          offsets.push(offset);
        }
      }
    }

    const labels = buildFlashLabels(target, offsets.length);
    return offsets.map((offset, index) => ({
      offset,
      label: labels[index] ?? ""
    }));
  }

  function setFlashState(next: FlashState): void {
    setFlashPresentation(next);
    patchBottomRow();
    renderVisibleRows(true);
  }

  function clearFlash(): void {
    if (!flashState.active) {
      return;
    }

    setFlashState({
      active: false,
      target: "",
      input: "",
      hints: []
    });
  }

  function startFlashJump(target: string): void {
    const hints = collectVisibleFlashHints(target);

    if (hints.length === 0) {
      setBottomMessage({ tone: "warning", text: `No visible '${target}' targets` });
      return;
    }

    setBottomMessage(null);
    setFlashState({
      active: true,
      target,
      input: "",
      hints
    });
  }

  function applyFlashJump(targetOffset: number): void {
    clearFlash();
    const targetPosition = state.doc.positionAt(targetOffset);
    dispatchOffsetSelection(targetOffset, targetPosition.column);
  }

  function handleFlashInput(key: string): boolean {
    if (!flashState.active) {
      return false;
    }

    if (key === "Escape") {
      clearFlash();
      return true;
    }

    if (key === "Backspace") {
      clearFlash();
      return true;
    }

    if (!/^[a-z]$/i.test(key)) {
      clearFlash();
      return false;
    }

    const nextInput = `${flashState.input}${key.toLowerCase()}`;
    const matchingHints = flashState.hints.filter((hint) => hint.label === key.toLowerCase());

    if (matchingHints.length === 0) {
      return true;
    }

    if (matchingHints.length === 1) {
      applyFlashJump(matchingHints[0].offset);
      return true;
    }

    const narrowedLabels = buildFlashLabels(key.toLowerCase(), matchingHints.length);
    setFlashState({
      ...flashState,
      input: nextInput,
      hints: matchingHints.map((hint, index) => ({
        offset: hint.offset,
        label: narrowedLabels[index] ?? narrowedLabels[0] ?? flashState.target
      }))
    });
    return true;
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

  function getRenderedLayout(): EditorLayoutModel {
    return buildLayoutModelForViewport(
      renderedViewport.toLine >= renderedViewport.fromLine
        ? renderedViewport
        : expandViewport(getVisibleViewport(), Math.max(1, visualRows.length))
    );
  }

  function getRowViewByVisualRowIndex(visualRowIndex: number): RowView | null {
    return rowViews.find((view) => view.visualRowIndex === visualRowIndex) ?? null;
  }

  function getTokenSourceRange(token: Element): { from: number; to: number } | null {
    if (!(token instanceof HTMLSpanElement)) {
      return null;
    }

    const from = Number(token.dataset.wxEditorOffset);
    const to = Number(token.dataset.wxEditorOffsetEnd);

    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return null;
    }

    return { from, to };
  }

  function cloneTokenSpan(template: HTMLSpanElement, text: string, from: number, to: number): HTMLSpanElement {
    const token = template.cloneNode(false) as HTMLSpanElement;
    token.classList.remove("wx-cursor-block", "wx-is-selected");
    delete token.dataset.wxEditorCursor;
    delete token.dataset.wxEditorCursorKind;
    token.dataset.wxEditorOffset = String(from);
    token.dataset.wxEditorOffsetEnd = String(to);
    token.textContent = text;
    return token;
  }

  function findOrSplitTokenAtOffset(lineText: HTMLElement, offset: number): HTMLSpanElement | null {
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
      const cursorText = text.slice(splitIndex, splitIndex + 1) || EMPTY_CELL_TEXT;
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
  }

  function setBlockCursorToken(token: HTMLSpanElement | null, active: boolean): void {
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
  }

  function getCaretMetrics() {
    const height = Math.max(14, Math.round(metrics.lineHeight * 0.84));
    const top = Math.max(0, Math.round((metrics.lineHeight - height) / 2));
    return { height, top };
  }

  function ensureLineCursor(view: RowView, column: number): void {
    const existing =
      view.content.querySelector<HTMLElement>("[data-wx-editor-cursor='true'][data-wx-editor-cursor-kind='line']") ??
      document.createElement("span");
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
  }

  function tryPatchSimpleCursorMove(previousState: EditorState, nextState: EditorState): boolean {
    if (flashState.active || pendingAction !== null) {
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

    const previousVisual = getVisualRowForOffset(
      previousState,
      visualRows,
      lineVisualRanges,
      previousOffset,
      softWrap,
      softWrap ? Math.max(1, wrapColumns) : Number.MAX_SAFE_INTEGER
    );
    const nextVisual = getVisualRowForOffset(
      nextState,
      visualRows,
      lineVisualRanges,
      nextOffset,
      softWrap,
      softWrap ? Math.max(1, wrapColumns) : Number.MAX_SAFE_INTEGER
    );

    if (
      getLineDiagnostics(previousVisual.row.docLine).length > 0 ||
      getLineDiagnostics(nextVisual.row.docLine).length > 0
    ) {
      return false;
    }

    const previousView = getRowViewByVisualRowIndex(previousVisual.rowIndex);
    const nextView = getRowViewByVisualRowIndex(nextVisual.rowIndex);

    if (!previousView || !nextView) {
      return false;
    }

    previousView.row.classList.toggle("wx-row-active", previousVisual.rowIndex === nextVisual.rowIndex);
    nextView.row.classList.add("wx-row-active");

    if (nextState.mode === "insert") {
      root
        .querySelectorAll<HTMLElement>("[data-wx-editor-cursor='true'][data-wx-editor-cursor-kind='line']")
        .forEach((cursor) => cursor.remove());
      ensureLineCursor(nextView, nextVisual.column);
      return true;
    }

    root
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
  }

  function patchRowView(view: RowView, layoutRow: EditorLayoutModel["document"]["rows"][number]): void {
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
    gutterNumber.textContent = numberRun?.text ?? String(lineIndex + 1);
    gutterChange.className = "wx-editor__gutter-change";
    gutterChange.dataset.change = changeRun?.lineChangeKind ?? "";
    gutterChange.dataset.deleted = String(changeRun?.deleted ?? false);
    gutterChange.dataset.wxEditorLineChange = changeRun?.lineChangeKind ?? (changeRun?.deleted ? "deleted" : "");
    view.gutter.replaceChildren(gutterMarker, gutterNumber, gutterChange);
    view.row.classList.toggle("wx-row-active", layoutRow.isActive);
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
      addClassName(token, diagnosticClassName(severity), !!severity);

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
  }

  function getVisibleViewport(): LineViewport {
    const lineCount = Math.max(1, visualRows.length);
    const fromLine = Math.max(0, Math.min(lineCount - 1, anchoredTopVisualRow));
    const toLine = Math.min(lineCount - 1, fromLine + visibleLineCapacity - 1);

    return { fromLine, toLine };
  }

  function getVisibleLineCapacity(): number {
    return visibleLineCapacity;
  }

  function getVerticalScrolloffRows(): number {
    const capacity = getVisibleLineCapacity();
    return Math.max(0, Math.min(VERTICAL_SCROLLOFF_ROWS, Math.floor((capacity - 1) / 2)));
  }

  function setAnchoredTopVisualRow(rowIndex: number): void {
    const maxFromLine = Math.max(0, visualRows.length - getVisibleLineCapacity());
    anchoredTopVisualRow = Math.max(0, Math.min(maxFromLine, rowIndex));
    viewportState.topVisualRow = anchoredTopVisualRow;
  }

  function renderVisibleRows(force = false): void {
    const visibleViewport = getVisibleViewport();

    if (
      !force &&
      viewportEquals(visibleViewport, renderedViewport) &&
      currentLayoutModel
    ) {
      return;
    }

    renderedViewport = visibleViewport;
    const layout = buildLayoutModelForViewport(renderedViewport);
    const nextRows = layout.document.rows;
    const nextFillerCount = Math.max(0, getVisibleLineCapacity() - nextRows.length);

    if (rowViews.length === nextRows.length && viewportRows.children.length === nextRows.length + nextFillerCount) {
      for (let index = 0; index < nextRows.length; index += 1) {
        const view = rowViews[index];
        const layoutRow = nextRows[index];
        if (!view || !layoutRow) {
          force = true;
          break;
        }
        patchRowView(view, layoutRow);
      }
      if (!force) {
        let fillerIndex = 0;
        for (let index = nextRows.length; index < viewportRows.children.length; index += 1) {
          const fillerRow = viewportRows.children[index] as HTMLDivElement;
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

    rowViews = [];
    const fragment = document.createDocumentFragment();

    for (const row of nextRows) {
      const view = createRowView(row.visualRowIndex);
      patchRowView(view, row);
      rowViews.push(view);
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

    viewportRows.replaceChildren(fragment);
  }

  function renderDirtyRows(dirtyLines: ReadonlySet<number>): boolean {
    const visibleViewport = getVisibleViewport();

    if (!viewportEquals(visibleViewport, renderedViewport)) {
      return false;
    }

    const nextRows = viewportState.visibleVisualRows;
    const nextFillerCount = Math.max(0, getVisibleLineCapacity() - nextRows.length);

    if (rowViews.length !== nextRows.length || viewportRows.children.length !== nextRows.length + nextFillerCount) {
      return false;
    }

    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const activeRow = getVisualRowForOffset(
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

      const layoutRow = buildEditorLayoutRow(
        {
          state,
          presentation,
          hoverAnchor: {
            col: Math.max(0, Math.floor(hoverState.left / Math.max(metrics.charWidth, 1))),
            row: Math.max(0, Math.floor(hoverState.top / Math.max(metrics.lineHeight, 1)))
          },
          indentGuides
        },
        visualRow,
        { activeOffset, activeRow }
      );
      patchRowView(view, layoutRow);
      patchedAnyRow = true;
    }

    return patchedAnyRow;
  }

  function patchStatus(): void {
    const cursorOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const cursorPosition = state.doc.positionAt(cursorOffset);
    const { errors, warnings } = getDiagnosticsSummary();

    statusMode.textContent = state.mode === "insert" ? "INS" : state.mode === "visual" ? "VIS" : "NOR";
    statusFile.textContent = filePath;
    statusMeta.textContent = [
      "1 sel",
      errors > 0 ? `E${errors}` : "",
      warnings > 0 ? `W${warnings}` : "",
      `${cursorPosition.line + 1}:${cursorPosition.column + 1}`
    ]
      .filter(Boolean)
      .join("   ");
  }

  function getViewportContext() {
    const viewport = getLineViewportForVisualViewport(getVisibleViewport());
    return {
      ...viewport,
      visibleLineCount: getVisibleLineCountForViewport(getVisibleViewport())
    };
  }

  function patchBottomRow(): void {
    const layout = getRenderedLayout();
    bottomRow.dataset.active = String(layout.bottomBar.active);
    bottomRow.replaceChildren();
    patchCommandPopover();
    const promptRun = layout.bottomBar.runs.find((run) => run.part === "command-prompt");
    const commandTextRun = layout.bottomBar.runs.find((run) => run.part === "command-text");
    const pickerRuns = layout.bottomBar.runs.filter((run) => run.part === "code-action");
    const pickerMessage = layout.bottomBar.runs.find((run) => run.part === "picker-loading" || run.part === "picker-error");
    const messageRun = layout.bottomBar.runs.find((run) => run.part === "bottom-message");
    const prefixRun = layout.bottomBar.runs.find((run) => run.part === "prefix-hint");

    if (promptRun) {
      const prompt = document.createElement("span");
      const value = document.createElement("span");

      prompt.className = "wx-editor__command-prompt";
      prompt.dataset.wxEditorCommandPrompt = "true";
      prompt.textContent = promptRun.text;

      value.className = "wx-editor__command-text";
      value.dataset.wxEditorCommandText = "true";
      value.textContent = commandTextRun?.text ?? "";

      bottomRow.append(prompt, value);
      return;
    }

    if (pickerRuns.length > 0 || pickerMessage) {
      const actions = document.createElement("div");
      actions.className = "wx-editor__code-actions";
      actions.dataset.wxEditorCodeActions = "true";
      actions.dataset.wxEditorPicker = "true";

      if (pickerMessage) {
        actions.textContent = pickerMessage.text;
      } else {
        pickerRuns.forEach((entry, index) => {
          const pickerItem = document.createElement("span");
          pickerItem.className = "wx-editor__code-action";
          pickerItem.dataset.selected = String(!!entry.selectedInPicker);
          pickerItem.dataset.wxEditorCodeAction = String(index + 1);
          pickerItem.textContent = entry.text;
          actions.append(pickerItem);
        });
      }

      bottomRow.append(actions);
      return;
    }

    if (messageRun) {
      const message = document.createElement("span");
      message.className = "wx-editor__bottom-message";
      message.dataset.tone = messageRun.tone ?? "info";
      message.dataset.wxEditorBottomMessage = "true";
      message.textContent = messageRun.text;
      bottomRow.append(message);
      return;
    }

    if (prefixRun) {
      const prefix = document.createElement("span");
      prefix.className = "wx-editor__prefix-hint";
      prefix.dataset.wxEditorPrefixHint =
        flashState.active
          ? "flash"
          : pendingAction?.kind === "flash-target"
            ? "flash-target"
            : pendingAction?.kind === "space"
              ? "space"
              : pendingAction?.kind === "z"
                ? (pendingAction.sticky ? "Z" : "z")
                : pendingAction?.kind ?? (pendingCount ? "count" : "prefix");
      prefix.textContent = prefixRun.text;
      bottomRow.append(prefix);
      return;
    }

    bottomRow.textContent = " ";
  }

  function handleControllerUpdate(update: EditorUpdate): void {
    const previousState = update.prevState;
    const nextState = update.nextState;
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

    state = nextState;
    syncPresentationMirrors();
    syncRenderedThemeFromPresentation();

    if (isPresentationOnlyUpdate) {
      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
      patchTooltip();
      return;
    }

    if (hasDocumentChanges) {
      if (flashState.active) {
        setFlashPresentation({ active: false, target: "", input: "", hints: [] });
      }
      invalidateHover();

      if (previousDigits !== nextDigits) {
        refreshGutterWidth(true);
        if (refreshViewportMetricsIfNeeded(true)) {
          return;
        }
      }

      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
      patchTooltip();
      return;
    }

    if (previousDigits !== nextDigits) {
      refreshGutterWidth(true);
      if (refreshViewportMetricsIfNeeded(true)) {
        return;
      }
    }

    if (dirtyLines && tryPatchSimpleCursorMove(previousState, nextState)) {
      patchStatus();
      patchTooltip();
      return;
    }

    if (dirtyLines && renderDirtyRows(dirtyLines)) {
      patchStatus();
      if (update.modeChanged) {
        patchBottomRow();
      }
      patchTooltip();
      return;
    }

    renderVisibleRows(true);
    patchStatus();
    if (update.modeChanged) {
      patchBottomRow();
    }
    patchTooltip();
  }

  function openCommandLine(prompt: ":" | "/" | "?" = ":"): void {
    setPendingActionState(null);
    clearFlash();
    clearHover();
    setCommandCompletionIndexState(0);
    if (prompt === "/" || prompt === "?") {
      searchPreviewState = {
        active: true,
        direction: prompt === "/" ? "forward" : "backward",
        selection: state.selection,
        mode: state.mode,
        search: { ...controller.getSearchState() },
        startOffset: state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state)
      };
    } else {
      searchPreviewState = null;
    }
    setCommandLineState({ active: true, value: "", prompt });
    patchBottomRow();
  }

  function applyRenderedTheme(nextTheme: ThemeSpec): void {
    applyThemeVariables(root, nextTheme);
    renderVisibleRows(true);
    patchStatus();
  }

  function syncRenderedThemeFromPresentation(): void {
    const previewName = presentation.ui.previewTheme;
    if (previewName) {
      const nextTheme = availableCommandThemes.find((entry) => entry.name === previewName);
      if (nextTheme) {
        applyThemeVariables(root, nextTheme);
        return;
      }
    }

    const committedName = presentation.themeName;
    if (committedName) {
      const nextTheme = availableCommandThemes.find((entry) => entry.name === committedName);
      if (nextTheme) {
        theme = nextTheme;
        availableCommandThemes = normalizeCommandThemes(options.commandThemes, theme);
        applyThemeVariables(root, nextTheme);
        return;
      }
    }

    applyThemeVariables(root, theme);
  }

  function previewThemeByName(name: string | null): void {
    if (!name) {
      if (!previewTheme) {
        return;
      }

      setPreviewThemeState(null);
      applyRenderedTheme(theme);
      return;
    }

    const nextTheme = availableCommandThemes.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase());

    if (!nextTheme) {
      return;
    }

    if (previewTheme?.name === nextTheme.name || (!previewTheme && theme.name === nextTheme.name)) {
      return;
    }

    setPreviewThemeState(nextTheme);
    applyRenderedTheme(nextTheme);
  }

  function closeCommandLine(restorePreview = true): void {
    if (restorePreview) {
      previewThemeByName(null);
      restoreSearchPreview();
    }
    setCommandCompletionIndexState(0);
    setCommandLineState({ active: false, value: "", prompt: ":" });
    patchBottomRow();
  }

  function closePicker(): void {
    if (!pickerState.active && !pickerState.loading && pickerState.items.length === 0 && !pickerState.error) {
      return;
    }
    setPickerPresentation({
      active: false,
      loading: false,
      title: "",
      items: [],
      selectedIndex: 0,
      error: null
    });
    pickerActions = [];
    patchBottomRow();
  }

  function setBottomMessage(message: BottomMessageState | null): void {
    if (
      bottomMessage?.tone === message?.tone &&
      bottomMessage?.text === message?.text &&
      (!!bottomMessage === !!message)
    ) {
      return;
    }
    setBottomMessageState(message);
    patchBottomRow();
  }

  function updateCommandLineValue(value: string, preserveCompletionIndex = false): void {
    if (!preserveCompletionIndex) {
      setCommandCompletionIndexState(0);
    }
    setCommandLineState({
      ...commandLine,
      value
    });
    if (commandLine.prompt === "/" || commandLine.prompt === "?") {
      previewSearch(value, commandLine.prompt === "/" ? "forward" : "backward");
    }
    patchBottomRow();
  }

  function restoreSearchPreview(): void {
    if (!searchPreviewState?.active) {
      searchPreviewState = null;
      return;
    }

    controller.setSearchState(searchPreviewState.search);
    controller.dispatch({
      selection: searchPreviewState.selection,
      mode: searchPreviewState.mode
    });
    revealCursor();
    renderVisibleRows(true);
    searchPreviewState = null;
  }

  function findSearchMatch(
    matches: readonly { from: number; to: number }[],
    offset: number,
    direction: "forward" | "backward",
    reverse = false
  ): { from: number; to: number } | null {
    const forward = reverse ? direction === "backward" : direction === "forward";

    return forward
      ? matches.find((entry) => entry.from > offset || (entry.from <= offset && offset < entry.to)) ?? matches[0] ?? null
      : [...matches].reverse().find((entry) => entry.to - 1 < offset || (entry.from <= offset && offset < entry.to)) ??
          matches[matches.length - 1] ??
          null;
  }

  function previewSearch(rawQuery: string, direction: "forward" | "backward"): void {
    if (!searchPreviewState?.active) {
      return;
    }

    const query = rawQuery.trim();

    if (!query) {
      controller.setSearchState(searchPreviewState.search);
      controller.dispatch({
        selection: searchPreviewState.selection,
        mode: searchPreviewState.mode
      });
      revealCursor();
      renderVisibleRows(true);
      return;
    }

    controller.setSearchState({
      query,
      direction,
      lastMatch: null
    });
    const matches = controller.getPresentationState().search.matches;

    if (matches.length === 0) {
      controller.setSearchState(searchPreviewState.search);
      controller.dispatch({
        selection: searchPreviewState.selection,
        mode: searchPreviewState.mode
      });
      revealCursor();
      renderVisibleRows(true);
      return;
    }

    const match = findSearchMatch(matches, searchPreviewState.startOffset, direction);

    if (!match) {
      controller.setSearchState(searchPreviewState.search);
      controller.dispatch({
        selection: searchPreviewState.selection,
        mode: searchPreviewState.mode
      });
      revealCursor();
      renderVisibleRows(true);
      return;
    }

    controller.setSearchState({
      query,
      direction,
      lastMatch: match
    });
    applySelectionRange(match.from, match.to);
    revealCursor();
    renderVisibleRows(true);
  }

  function setThemeByName(name: string): boolean {
    const normalized = name.trim().toLowerCase();
    const nextTheme = availableCommandThemes.find((entry) => entry.name.toLowerCase() === normalized);

    if (!nextTheme) {
      setBottomMessage({ tone: "warning", text: `Unknown theme: ${name}` });
      return false;
    }

    theme = nextTheme;
    controller.setThemeName(nextTheme.name);
    setPreviewThemeState(null);
    availableCommandThemes = normalizeCommandThemes(options.commandThemes, theme);
    applyRenderedTheme(theme);
    patchBottomRow();
    setBottomMessage({ tone: "info", text: `Theme ${nextTheme.name}` });
    return true;
  }

  function getCommandCompletionItems(): readonly CommandCompletionItem[] {
    if (!commandLine.active || commandLine.prompt !== ":") {
      return [];
    }

    const rawValue = commandLine.value;
    const trimmedStart = rawValue.trimStart();

    if (!trimmedStart) {
      return [
        {
          label: "theme",
          detail: "switch theme",
          run: () => {
            updateCommandLineValue("theme ");
          }
        },
        {
          label: "write",
          detail: "save document",
          run: () => {
            closeCommandLine();
            void saveDocument(filePath);
          }
        },
        {
          label: "format",
          detail: "format document",
          run: () => {
            closeCommandLine();
            void formatDocument();
          }
        },
        {
          label: "code-actions",
          detail: "show code actions",
          run: () => {
            closeCommandLine();
            void loadCodeActions();
          }
        }
      ];
    }

    const parts = trimmedStart.split(/\s+/);
    const commandName = (parts[0] ?? "").toLowerCase();
    const hasArgumentSpace = /\s$/.test(rawValue);
    const commandArgument = trimmedStart.slice(parts[0]?.length ?? 0).trim();

    if (commandName === "theme") {
      const query = commandArgument;
      const filteredThemes = availableCommandThemes.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase()));

      return filteredThemes.map((entry) => ({
        label: entry.name,
        detail: "theme",
        run: () => {
          closeCommandLine(false);
          setThemeByName(entry.name);
        }
      }));
    }

    if (!hasArgumentSpace) {
      const commands = [
        { label: "theme", detail: "switch theme", run: () => updateCommandLineValue("theme ") },
        { label: "write", detail: "save document", run: () => updateCommandLineValue("write ") },
        { label: "format", detail: "format document", run: () => updateCommandLineValue("format") },
        { label: "code-actions", detail: "show code actions", run: () => updateCommandLineValue("code-actions") }
      ];

      return commands.filter((entry) => entry.label.startsWith(commandName));
    }

    return [];
  }

  function hasRunnableCommandLineValue(rawValue: string): boolean {
    const trimmed = rawValue.trim();

    if (!trimmed) {
      return false;
    }

    const [commandName = "", ...argumentParts] = trimmed.split(/\s+/);
    const value = commandName.toLowerCase();
    const commandArgument = argumentParts.join(" ").trim();

    if (["format", "fmt", "w", "write", "code-actions", "codeaction", "ca"].includes(value)) {
      return true;
    }

    if (value !== "theme") {
      return false;
    }

    if (!commandArgument) {
      return true;
    }

    const normalizedArgument = commandArgument.toLowerCase();
    return availableCommandThemes.some(
      (entry) =>
        entry.name.toLowerCase() === normalizedArgument ||
        entry.name.toLowerCase().startsWith(normalizedArgument)
    );
  }

  function patchCommandPopover(): void {
    const items = getCommandCompletionItems();
    const rawValue = commandLine.value.trimStart();
    const activeCommandName = rawValue.split(/\s+/)[0]?.toLowerCase() ?? "";

    if (items.length === 0 || !commandLine.active || commandLine.prompt !== ":") {
      previewThemeByName(null);
      commandPopover.hidden = true;
      commandPopover.replaceChildren();
      return;
    }

    commandPopover.hidden = false;
    setCommandCompletionIndexState(Math.max(0, Math.min(items.length - 1, commandCompletionIndex)));

    if (activeCommandName === "theme") {
      previewThemeByName(items[commandCompletionIndex]?.label ?? null);
    } else {
      previewThemeByName(null);
    }

    const panel = document.createElement("div");
    panel.className = "wx-editor__command-popover-panel";

    items.slice(0, 6).forEach((item, index) => {
      const row = document.createElement("div");
      const label = document.createElement("span");
      const detail = document.createElement("span");

      row.className = "wx-editor__command-completion";
      row.dataset.selected = String(index === commandCompletionIndex);
      row.dataset.wxEditorCommandCompletion = item.label;

      label.className = "wx-editor__command-completion-label";
      label.textContent = item.label;

      detail.className = "wx-editor__command-completion-detail";
      detail.textContent = item.detail ?? "";

      row.append(label, detail);
      panel.append(row);
    });

    commandPopover.replaceChildren(panel);
  }

  function patchTooltip(): void {
    const panel = getRenderedLayout().panels[0];

    if (!panel) {
      tooltip.hidden = true;
      tooltip.replaceChildren();
      return;
    }

    tooltip.hidden = false;
    tooltip.dataset.tone = panel.tone ?? "info";
    tooltip.style.left = `${panel.anchor.col * metrics.charWidth}px`;
    tooltip.style.top = `${panel.anchor.row * metrics.lineHeight}px`;
    tooltip.replaceChildren();

    for (const row of panel.rows) {
      for (const run of row) {
        if (run.part === "tooltip-source") {
          const source = document.createElement("span");
          source.className = "wx-editor__tooltip-source";
          source.textContent = run.text;
          tooltip.append(source);
          continue;
        }

        const body = document.createElement("div");
        body.textContent = run.text;
        tooltip.append(body);
      }
    }
  }

  function setHoverState(next: HoverState): void {
    setHoverPresentation(next);
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

  function invalidateHover(keepPosition = true): void {
    controller.dismissHover();
    hoverRenderRequestId += 1;

    if (!hoverState.active) {
      return;
    }

    setHoverState({
      active: false,
      pinned: false,
      offset: null,
      content: "",
      tone: "info",
      left: keepPosition ? hoverState.left : 16,
      top: keepPosition ? hoverState.top : 16
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
    if (hoverState.active && hoverState.offset === offset && hoverState.pinned === pinned) {
      return true;
    }

    const requestId = ++hoverRenderRequestId;
    const nextHover = await controller.requestHover(offset);

    if (destroyed || requestId !== hoverRenderRequestId) {
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

  async function applyCodeActionInternal(action: EditorCodeAction): Promise<boolean> {
    const applied = await controller.applyCodeAction(action);

    if (!applied) {
      setBottomMessage({ tone: "warning", text: `No edits for ${action.title}` });
      return false;
    }
    closePicker();
    setBottomMessage({ tone: "info", text: `Applied ${action.title}` });
    return true;
  }

  function setPickerState(next: PickerState): void {
    setPickerPresentation(next);
    patchBottomRow();
  }

  async function loadCodeActions(): Promise<readonly EditorCodeAction[]> {
    setPickerState({
      active: true,
      loading: true,
      title: "code actions",
      items: [],
      selectedIndex: 0,
      error: null
    });

    let actions: readonly EditorCodeAction[];

    try {
      actions = await controller.requestCodeActions();
    } catch {
      closePicker();
      setBottomMessage({ tone: "error", text: "Code actions request failed" });
      return [];
    }

    setPickerState({
      active: true,
      loading: false,
      title: "code actions",
      items: actions.map((action) => ({
        label: action.title,
        run: () => {
          void applyCodeActionInternal(action);
        }
      })),
      selectedIndex: 0,
      error: actions.length === 0 ? "No code actions" : null
    });

    if (actions.length === 0) {
      closePicker();
      setBottomMessage({ tone: "warning", text: "No code actions available" });
    }

    return actions;
  }

  async function formatDocument(): Promise<boolean> {
    let didFormat = false;

    try {
      didFormat = await controller.formatDocument();
    } catch {
      setBottomMessage({ tone: "error", text: "Formatting failed" });
      return false;
    }

    if (!didFormat) {
      setBottomMessage({ tone: "info", text: "Already formatted" });
      return false;
    }
    setBottomMessage({ tone: "info", text: "Formatted document" });
    return true;
  }

  async function saveDocument(targetFilePath = filePath): Promise<boolean> {
    if (!host?.writeFile) {
      setBottomMessage({ tone: "warning", text: "No file writer available" });
      return false;
    }

    try {
      const didSave = await controller.saveDocument(targetFilePath);
      if (!didSave) {
        setBottomMessage({ tone: "error", text: `Write failed for ${targetFilePath}` });
        return false;
      }
    } catch {
      setBottomMessage({ tone: "error", text: `Write failed for ${targetFilePath}` });
      return false;
    }

    filePath = targetFilePath;
    patchStatus();
    setBottomMessage({ tone: "info", text: `Wrote ${targetFilePath}` });
    return true;
  }

  function applySelectionRange(from: number, to: number): boolean {
    if (state.mode === "visual") {
      const anchor = state.selection.ranges[state.selection.primaryIndex]?.anchor ?? from;
      controller.dispatch({
        selection: createSelection(anchor, Math.max(from, to - 1)),
        mode: "visual"
      });
      return true;
    }

    controller.dispatch({
      selection: createSelection(from, Math.max(from, to - 1)),
      mode: "normal"
    });
    return true;
  }

  function runSearch(query: string, direction: "forward" | "backward", reverse = false, startOffset?: number): boolean {
    const previousSearch = { ...controller.getSearchState() };
    controller.setSearchState({
      query,
      direction,
      lastMatch: null
    });
    const nextMatches = controller.getPresentationState().search.matches;

    if (nextMatches.length === 0) {
      controller.setSearchState(previousSearch);
      setBottomMessage({ tone: "warning", text: `No matches for ${query}` });
      renderVisibleRows(true);
      return false;
    }

    const offset = startOffset ?? (state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state));
    const match = findSearchMatch(nextMatches, offset, direction, reverse);

    if (!match) {
      controller.setSearchState(previousSearch);
      return false;
    }

    controller.setSearchState({
      query,
      direction,
      lastMatch: match
    });
    controller.setRegister("/", query);
    applySelectionRange(match.from, match.to);
    revealCursor();
    renderVisibleRows(true);
    setLastRepeatableMotionState({ kind: "search", reverse });
    return true;
  }

  function repeatSearch(reverseAgainstDirection = false): boolean {
    const search = controller.getSearchState();

    if (!search.query) {
      setBottomMessage({ tone: "warning", text: "No active search" });
      return false;
    }

    const baseOffset =
      search.lastMatch
        ? reverseAgainstDirection
          ? search.lastMatch.from - 1
          : search.lastMatch.to
        : undefined;
    const didRun = runSearch(search.query, search.direction, reverseAgainstDirection, baseOffset);

    if (didRun) {
      setLastRepeatableMotionState({ kind: "search", reverse: reverseAgainstDirection });
    }

    return didRun;
  }

  function searchFromSelection(reverse = false): boolean {
    const selection = getSelectionOffsets(state);
    const query = escapeRegex(state.doc.slice(selection.from, selection.to));

    if (!query) {
      return false;
    }

    return runSearch(query, reverse ? "backward" : "forward");
  }

  function selectRegisterForNext(name: string | null): void {
    controller.selectRegister(name);
    setBottomMessage(name ? { tone: "info", text: `Register "${name}" selected` } : null);
  }

  function consumeSelectedRegister(): string | null {
    const selected = controller.getSelectedRegister();
    controller.selectRegister(null);
    return selected;
  }

  async function readSystemClipboard(): Promise<string | null> {
    const clipboard = navigator.clipboard;

    if (!clipboard?.readText) {
      setBottomMessage({ tone: "warning", text: "System clipboard is unavailable" });
      return null;
    }

    try {
      return await clipboard.readText();
    } catch {
      setBottomMessage({ tone: "error", text: "Could not read the system clipboard" });
      return null;
    }
  }

  function primeRegisterForPaste(): void {
    const selected = consumeSelectedRegister();

    if (!selected) {
      return;
    }

    const value = controller.getRegister(selected);
    controller.dispatch({
      yankBuffer: value
    });
  }

  async function insertRegisterValue(name: string): Promise<boolean> {
    const value = name === "+" ? await readSystemClipboard() : controller.getRegister(name);
    controller.selectRegister(null);

    if (!value) {
      setBottomMessage({ tone: "warning", text: `Register ${name} is empty` });
      return false;
    }

    return runCommand(insertText(value));
  }

  async function pasteSystemClipboard(count: number): Promise<boolean> {
    const value = await readSystemClipboard();
    controller.selectRegister(null);

    if (!value) {
      setBottomMessage({ tone: "warning", text: 'Register "+" is empty' });
      return false;
    }

    controller.dispatch({
      yankBuffer: value
    });

    let applied = false;

    for (let index = 0; index < count; index += 1) {
      const previousMode = state.mode;
      const previousRevision = state.revision;
      const didRun = runCommand(pasteAfter);

      if (!didRun) {
        break;
      }

      applied = true;

      if (state.mode !== previousMode || state.revision === previousRevision) {
        break;
      }
    }

    return applied;
  }

  function pushCurrentJump(): boolean {
    return controller.pushJump();
  }

  function restoreJump(entry: EditorJumpEntry | null): boolean {
    if (!entry) {
      return false;
    }

    controller.dispatch({
      selection: entry.selection,
      mode: entry.mode
    });
    revealCursor();
    renderVisibleRows(true);
    return true;
  }

  function jumpBackward(): boolean {
    return restoreJump(controller.jumpBackward());
  }

  function jumpForward(): boolean {
    return restoreJump(controller.jumpForward());
  }

  function openDiagnosticsPicker(): void {
    const items = diagnostics.map((entry) => {
      const position = state.doc.positionAt(entry.from);
      const lineText = state.doc.lineAt(position.line).text.trim();
      return {
        label: `${position.line + 1}:${position.column + 1} ${entry.message}`,
        detail: lineText,
        run: () => {
          pushCurrentJump();
          applySelectionRange(entry.from, entry.to);
          closePicker();
        }
      };
    });

    if (items.length === 0) {
      setBottomMessage({ tone: "warning", text: "No diagnostics" });
      return;
    }

    setPickerState({
      active: true,
      loading: false,
      title: "diagnostics",
      items,
      selectedIndex: 0,
      error: null
    });
  }

  function openJumpListPicker(): void {
    const items = controller.getJumpList().map((entry, index) => {
      const offset = state.mode === "insert" ? getCursorOffset(entry.selection) : getCursorOffset(entry.selection);
      const position = state.doc.positionAt(offset);
      const lineText = state.doc.lineAt(position.line).text.trim();
      return {
        label: `${index + 1}:${position.line + 1}:${position.column + 1}`,
        detail: lineText,
        run: () => {
          restoreJump(entry);
          closePicker();
        }
      };
    });

    if (items.length === 0) {
      setBottomMessage({ tone: "warning", text: "Jump list is empty" });
      return;
    }

    setPickerState({
      active: true,
      loading: false,
      title: "jumps",
      items,
      selectedIndex: Math.max(0, items.length - 1),
      error: null
    });
  }

  function runCommandLineCommand(rawValue: string): void {
    const prompt = commandLine.prompt;
    const trimmed = rawValue.trim();
    const [commandName = "", ...argumentParts] = trimmed.split(/\s+/);
    const value = commandName.toLowerCase();
    const commandArgument = argumentParts.join(" ").trim();

    if (prompt === "/" || prompt === "?") {
      closeCommandLine(false);
      searchPreviewState = null;
      void runSearch(trimmed, prompt === "/" ? "forward" : "backward");
      return;
    }

    closeCommandLine();

    if (!value) {
      return;
    }

    if (value === "format" || value === "fmt") {
      void formatDocument();
      return;
    }

    if (value === "w" || value === "write") {
      void saveDocument(commandArgument || filePath);
      return;
    }

    if (value === "theme") {
      if (!commandArgument) {
        setBottomMessage({ tone: "warning", text: "Theme name required" });
        return;
      }

      const normalizedArgument = commandArgument.toLowerCase();
      const matchingThemes = availableCommandThemes.filter((entry) => entry.name.toLowerCase().startsWith(normalizedArgument));

      if (matchingThemes.length === 1) {
        setThemeByName(matchingThemes[0].name);
        return;
      }

      if (setThemeByName(commandArgument)) {
        return;
      }

      return;
    }

    if (value === "code-actions" || value === "codeaction" || value === "ca") {
      void loadCodeActions();
      return;
    }

    setBottomMessage({ tone: "warning", text: `Unknown command: ${rawValue}` });
  }

  function dispatchOffsetSelection(targetOffset: number, preferredColumn: number | null): boolean {
    if (state.mode === "insert") {
      controller.dispatch({
        selection: createSelection(targetOffset, targetOffset, preferredColumn)
      });
      return true;
    }

    if (state.mode === "visual") {
      const anchor = state.selection.ranges[state.selection.primaryIndex]?.anchor ?? targetOffset;
      controller.dispatch({
        selection: createSelection(anchor, targetOffset, preferredColumn)
      });
      return true;
    }

    controller.dispatch({
      selection: createCharacterSelection(state.doc, targetOffset, preferredColumn)
    });
    return true;
  }

  function moveByVisualRows(delta: number): boolean {
    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const current = getVisualRowForOffset(activeOffset);
    const preferredColumn = state.selection.ranges[state.selection.primaryIndex]?.preferredColumn ?? current.column;
    const targetRowIndex = Math.max(0, Math.min(visualRows.length - 1, current.rowIndex + delta));
    const targetRow = getVisualRow(targetRowIndex);
    const segmentLength = targetRow.segmentEnd - targetRow.segmentStart;
    const maxColumn = state.mode === "insert" ? segmentLength : Math.max(0, segmentLength - 1);
    const targetColumn = Math.max(0, Math.min(preferredColumn, maxColumn));
    const targetOffset =
      segmentLength === 0 ? targetRow.segmentStart : targetRow.segmentStart + targetColumn;
    return dispatchOffsetSelection(targetOffset, preferredColumn);
  }

  function gotoVisibleRow(position: "top" | "center" | "bottom"): boolean {
    const viewport = getVisibleViewport();
    const targetRowIndex =
      position === "top"
        ? viewport.fromLine
        : position === "bottom"
          ? viewport.toLine
          : Math.floor((viewport.fromLine + viewport.toLine) / 2);
    const targetRow = getVisualRow(targetRowIndex);
    return dispatchOffsetSelection(targetRow.segmentStart, 0);
  }

  function readPendingCount(): number {
    if (!pendingCount) {
      return 1;
    }

    const parsed = Number.parseInt(pendingCount, 10);
    setPendingCountState("");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  function clearPendingCount(): void {
    setPendingCountState("");
  }

  function runCommandWithCount(command: Command, explicitCount?: number): boolean {
    const count = explicitCount ?? readPendingCount();
    const selectedRegister = controller.getSelectedRegister();

    if (command === pasteAfter && selectedRegister === "+") {
      void pasteSystemClipboard(count);
      return true;
    }

    let applied = false;

    for (let index = 0; index < count; index += 1) {
      const previousMode = state.mode;
      const previousRevision = state.revision;
      const didRun = runCommand(command);

      if (!didRun) {
        break;
      }

      applied = true;

      if (state.mode !== previousMode || state.revision === previousRevision) {
        break;
      }
    }

    return applied;
  }

  function runCommand(command: Command): boolean {
    setBottomMessage(null);
    clearFlash();
    clearHover();
    closePicker();
    const selectedRegister = controller.getSelectedRegister();

    if (command === pasteAfter) {
      primeRegisterForPaste();
    }

    if (softWrap) {
      if (command === moveUp) {
        return moveByVisualRows(-1);
      }

      if (command === moveDown) {
        return moveByVisualRows(1);
      }

      if (command === pageUp) {
        return moveByVisualRows(-(Math.max(1, getVisibleLineCountForViewport(getVisibleViewport()) - 1)));
      }

      if (command === pageDown) {
        return moveByVisualRows(Math.max(1, getVisibleLineCountForViewport(getVisibleViewport()) - 1));
      }

      if (command === halfPageUp) {
        return moveByVisualRows(-Math.max(1, Math.floor(getVisibleLineCountForViewport(getVisibleViewport()) / 2)));
      }

      if (command === halfPageDown) {
        return moveByVisualRows(Math.max(1, Math.floor(getVisibleLineCountForViewport(getVisibleViewport()) / 2)));
      }

      if (command === gotoWindowTop) {
        return gotoVisibleRow("top");
      }

      if (command === gotoWindowCenter) {
        return gotoVisibleRow("center");
      }

      if (command === gotoWindowBottom) {
        return gotoVisibleRow("bottom");
      }
    }

    const didRun = controller.execute(command, {
      requestFocus() {
        textarea.focus();
      },
      viewport: getViewportContext()
    });

    if (didRun && [yankSelection, deleteSelection, changeSelection].includes(command)) {
      if (selectedRegister) {
        controller.setRegister(selectedRegister, controller.getState().yankBuffer);
      }
      controller.selectRegister(null);
    }

    return didRun;
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
      case "search":
        return repeatSearch(motion.reverse);
    }

    return false;
  }

  function recordRepeatableMotion(candidate: RepeatableMotion, didChange: boolean): void {
    if (didChange) {
      setLastRepeatableMotionState(candidate);
    }
  }

  async function toggleComments(): Promise<boolean> {
    const toggler = getCommentToggler();

    if (!toggler) {
      setBottomMessage({ tone: "warning", text: "No comment provider" });
      return false;
    }

    let changes: readonly TextChange[];

    try {
      changes = await toggler.toggleLineComments({
        document: getSnapshot(),
        selection: getSelectionOffsets(state)
      });
    } catch {
      setBottomMessage({ tone: "error", text: "Comment toggle failed" });
      return false;
    }

    if (!changes.length) {
      setBottomMessage({ tone: "info", text: "Nothing to comment" });
      return false;
    }

    controller.dispatch({
      changes,
      effects: [{ type: "language.comment-toggle" }]
    });
    setBottomMessage({ tone: "info", text: "Toggled comments" });
    return true;
  }

  function scrollViewportBy(rowsDelta: number): boolean {
    if (rowsDelta === 0) {
      return true;
    }

    controller.scrollViewportBy(rowsDelta);
    syncViewportMirrors();
    renderVisibleRows();
    return true;
  }

  function alignViewportToCursor(position: "top" | "center" | "bottom"): boolean {
    controller.alignViewportToSelection(position);
    syncViewportMirrors();
    renderVisibleRows();
    return true;
  }

  function navigateDiagnostic(direction: "next" | "prev", extreme = false): boolean {
    if (diagnostics.length === 0) {
      setBottomMessage({ tone: "warning", text: "No diagnostics" });
      return false;
    }

    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const ordered = [...diagnostics].sort((left, right) => left.from - right.from);
    const target =
      direction === "next"
        ? extreme
          ? ordered[ordered.length - 1]
          : ordered.find((entry) => entry.from > activeOffset) ?? ordered[0]
        : extreme
          ? ordered[0]
          : [...ordered].reverse().find((entry) => entry.to - 1 < activeOffset) ?? ordered[ordered.length - 1];

    if (!target) {
      return false;
    }

    pushCurrentJump();
    applySelectionRange(target.from, target.to);
    revealCursor();
    return true;
  }

  async function selectTextobjectWithFallback(mode: SyntaxTextobjectMode, object: string): Promise<boolean> {
    if (["w", "W", "p", "'", "\"", "`", "(", ")", "[", "]", "{", "}", "<", ">"].includes(object)) {
      return runCommand(selectTextobject(mode, object));
    }

    const provider = getSyntaxTextobjectProvider();

    if (!provider) {
      return false;
    }

    const selection = getSelectionOffsets(state);
    const activeOffset = getActiveCharacterOffset(state);
    const next = await provider.selectTextobject({
      document: getSnapshot(),
      selection,
      activeOffset,
      object,
      mode
    });

    if (!next) {
      return false;
    }

    applySelectionRange(next.from, next.to);
    return true;
  }

  async function navigateSyntax(direction: "next" | "prev", kind: string): Promise<boolean> {
    const provider = getSyntaxNavigationProvider();
    const navigate = direction === "next" ? provider?.gotoNext : provider?.gotoPrev;

    if (!navigate) {
      return false;
    }

    const next = await navigate({
      document: getSnapshot(),
      activeOffset: getActiveCharacterOffset(state),
      kind
    });

    if (!next) {
      return false;
    }

    pushCurrentJump();
    applySelectionRange(next.from, next.to);
    revealCursor();
    return true;
  }

  function revealCursor(): void {
    controller.revealSelection();
    syncViewportMirrors();
  }

  function keyboardInputForEvent(event: KeyboardEvent) {
    return {
      key: event.key,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      text: event.key.length === 1 ? event.key : undefined,
      source: "dom" as const
    };
  }

  function isControllerHandledModifierKey(event: KeyboardEvent): boolean {
    if (event.metaKey && !event.ctrlKey && !event.altKey) {
      return false;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      return (
        state.mode !== "insert" &&
        (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "." || event.key === "*")
      );
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      return ["s", "r", "o", "i", "b", "d", "f", "u"].includes(event.key);
    }

    return false;
  }

  function syncKeyboardHoverAnchor(): void {
    if (!hoverState.active || !hoverState.pinned) {
      return;
    }

    if (hoverState.left !== 16 || hoverState.top !== 16) {
      return;
    }

    const anchorElement = root.querySelector<HTMLElement>("[data-wx-editor-cursor='true']");
    const anchorRect = anchorElement?.getBoundingClientRect() ?? root.getBoundingClientRect();
    setHoverState({
      ...hoverState,
      ...getTooltipAnchorForRect(anchorRect)
    });
  }

  async function forwardKeydownToController(event: KeyboardEvent): Promise<void> {
    const result = await controller.handleKeyInput(keyboardInputForEvent(event), {
      themeNames: availableCommandThemes.map((entry) => entry.name),
      readClipboardText: readSystemClipboard
    });

    if (destroyed) {
      return;
    }

    syncPresentationMirrors();
    syncRenderedThemeFromPresentation();
    syncKeyboardHoverAnchor();

    if (result.themeName !== undefined) {
      syncRenderedThemeFromPresentation();
      patchBottomRow();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    const browserPasteShortcut =
      state.mode === "insert" &&
      !commandLine.active &&
      !pickerState.active &&
      !event.altKey &&
      ((event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "v") ||
        (event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "v"));

    if (browserPasteShortcut) {
      return;
    }

    const hasCommandState =
      flashState.active || commandLine.active || pickerState.active || !!pendingAction || stickyViewMode || hoverState.active;
    const plainEditorKey = !event.metaKey && !event.ctrlKey && !event.altKey;
    const shouldRoute =
      hasCommandState ||
      plainEditorKey ||
      isControllerHandledModifierKey(event);

    if (!shouldRoute) {
      return;
    }

    event.preventDefault();
    textarea.value = "";
    void forwardKeydownToController(event);
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

  function handlePaste(event: ClipboardEvent): void {
    if (state.mode !== "insert" || commandLine.active || pickerState.active) {
      return;
    }

    const pastedText = event.clipboardData?.getData("text/plain") ?? "";

    if (!pastedText) {
      return;
    }

    event.preventDefault();
    textarea.value = "";
    runCommand(insertText(pastedText));
  }

  function handleMouseMove(event: MouseEvent): void {
    if (commandLine.active || pickerState.active) {
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
    const offset =
      target && target.dataset.wxEditorOffset
        ? resolveOffsetWithinRun(
            target,
            Number(target.dataset.wxEditorOffset),
            target.dataset.wxEditorOffsetEnd ? Number(target.dataset.wxEditorOffsetEnd) : null,
            event.clientX
          )
        : null;

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
  textarea.addEventListener("paste", handlePaste);
  surface.addEventListener("wheel", handleWheel, { passive: false });
  viewportRows.addEventListener("mousemove", handleMouseMove);
  viewportRows.addEventListener("mouseleave", handleMouseLeave);
  unsubscribeController = controller.subscribe(handleControllerUpdate);

  refreshGutterWidth(true);
  refreshViewportMetricsIfNeeded(true);
  revealCursor();
  renderVisibleRows(true);
  patchStatus();
  patchBottomRow();
  schedulePostMountReveal();

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      refreshGutterWidth(true);
      if (refreshViewportMetricsIfNeeded()) {
        return;
      }
      renderVisibleRows(true);
    });
    resizeObserver.observe(surface);
  }

  return {
    controller,
    mount(nextContainer: HTMLElement) {
      mountedContainer = nextContainer;
      mountedContainer.replaceChildren(root);
      refreshGutterWidth(true);
      refreshViewportMetricsIfNeeded(true);
      revealCursor();
      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
      schedulePostMountReveal();
    },
    destroy() {
      destroyed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (pendingMountFrame) {
        cancelAnimationFrame(pendingMountFrame);
        pendingMountFrame = 0;
      }
      unsubscribeController();
      for (const services of languageServices) {
        services.highlighter?.destroy?.();
      }
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
      controller.setFilePath(nextFilePath);
      patchStatus();
    },
    async setLanguageServices(nextLanguageServices: EditorLanguageServiceInput | null) {
      for (const services of languageServices) {
        services.highlighter?.destroy?.();
      }
      languageServices = normalizeLanguageServices(nextLanguageServices);
      controller.setLanguageServices(languageServices);
      syncLanguageMirrors();
      renderVisibleRows(true);
      patchStatus();
      patchBottomRow();
    },
    async setLanguage(nextLanguage: LanguageProvider | null) {
      await this.setLanguageServices(languageProviderToServices(nextLanguage));
    },
    setTheme(nextTheme: ThemeSpec) {
      theme = nextTheme;
      controller.setThemeName(nextTheme.name);
      setPreviewThemeState(null);
      availableCommandThemes = normalizeCommandThemes(options.commandThemes, theme);
      applyRenderedTheme(theme);
      patchBottomRow();
    },
    async setValue(value: string) {
      setAnchoredTopVisualRow(0);
      controller.replaceState(createEditorState({ value, selection: createSelection(0, 0) }));
      syncLanguageMirrors();
    }
  };
}
