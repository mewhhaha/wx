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
  moveLeft,
  moveRight,
  moveUp,
  toggleVisualMode,
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
      overflow: auto;
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

    .whx-editor__row {
      display: grid;
      align-items: center;
      min-height: var(--whx-line-height, 24px);
      white-space: pre;
    }

    .whx-editor__row--active {
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
    }

    .whx-token[data-role="comment"] { color: var(--whx-color-comment); }
    .whx-token[data-role="function"] { color: var(--whx-color-function); }
    .whx-token[data-role="keyword"] { color: var(--whx-color-keyword); }
    .whx-token[data-role="number"] { color: var(--whx-color-number); }
    .whx-token[data-role="operator"] { color: var(--whx-color-operator); }
    .whx-token[data-role="punctuation"] { color: var(--whx-color-punctuation); }
    .whx-token[data-role="string"] { color: var(--whx-color-string); }
    .whx-token[data-role="type"] { color: var(--whx-color-type); }

    .whx-token--selected {
      background: var(--whx-color-selection);
      border-radius: 4px;
    }

    .whx-token--cursor-block {
      display: inline-block;
      min-width: 1ch;
      color: var(--whx-color-cursor-text);
      background: var(--whx-color-cursor);
      border-radius: 4px;
    }

    .whx-editor__caret {
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

    .whx-editor__status-spacer {
      height: var(--whx-line-height, 24px);
      background: #0a0b0f;
      border-top: 1px solid rgba(148, 163, 184, 0.08);
    }
  `;

  styleHost.append(styleElement);
}

import { greet } from "./hello";

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
    case "v":
      return toggleVisualMode;
    default:
      return null;
  }
}

function commandForVisualMode(key: string): Command | null {
  switch (key) {
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
    case "v":
      return toggleVisualMode;
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

function roleAtOffset(spans: HighlightSpan[], offset: number): HighlightRole {
  const span = spans.find((entry) => offset >= entry.from && offset < entry.to);
  return span?.role ?? "text";
}

function renderLineFragments(line: { start: number; text: string }, state: EditorState, spans: HighlightSpan[]): LineFragment[] {
  const fragments: LineFragment[] = [];
  const activeOffset = getActiveCharacterOffset(state);
  const selection = getSelectionOffsets(state);
  const lineEnd = line.start + line.text.length;

  if (state.mode === "insert") {
    for (let index = 0; index < line.text.length; index += 1) {
      const offset = line.start + index;

      fragments.push({
        text: line.text[index] ?? " ",
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
        text: " ",
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

  return fragments;
}

export function createEditor(container: HTMLElement, options: CreateEditorOptions = {}): EditorHandle {
  let state = createEditorState({ value: options.value ?? "" });
  let filePath = options.filePath ?? "untitled.ts";
  let language = options.language ?? null;
  let theme = options.theme ?? defaultTheme;
  let highlights: HighlightSpan[] = [];
  let destroyed = false;

  const root = document.createElement("div");
  const surface = document.createElement("div");
  const rows = document.createElement("div");
  const status = document.createElement("div");
  const statusMode = document.createElement("div");
  const statusFile = document.createElement("div");
  const statusMeta = document.createElement("div");
  const statusSpacer = document.createElement("div");
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

  status.className = "whx-editor__status";
  status.dataset.whxEditor = "status";

  statusMode.className = "whx-editor__status-mode";
  statusMode.dataset.whxEditorStatusMode = "true";

  statusFile.className = "whx-editor__status-file";
  statusFile.dataset.whxEditorStatusFile = "true";

  statusMeta.className = "whx-editor__status-meta";
  statusMeta.dataset.whxEditorStatusMeta = "true";

  statusSpacer.className = "whx-editor__status-spacer";
  statusSpacer.dataset.whxEditorStatusSpacer = "true";

  textarea.className = "whx-editor__input";
  textarea.dataset.whxEditor = "input";
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.autocorrect = "off";

  status.append(statusMode, statusFile, statusMeta);
  surface.append(rows, textarea);
  root.append(surface, status, statusSpacer);
  container.replaceChildren(root);

  function getSnapshot() {
    return {
      revision: state.revision,
      doc: state.doc
    };
  }

  async function refreshHighlights(): Promise<void> {
    if (!language) {
      highlights = [];
      render();
      return;
    }

    const revision = state.revision;
    const next = await language.getHighlightRanges(
      {
        fromLine: 0,
        toLine: Math.max(0, state.doc.lineCount - 1)
      },
      revision
    );

    if (!destroyed && revision === state.revision) {
      highlights = next;
      render();
    }
  }

  async function syncLanguage(changes: readonly TextChange[] = []): Promise<void> {
    if (!language) {
      return;
    }

    if (state.revision === 0) {
      await language.open(getSnapshot());
    } else {
      await language.update(getSnapshot(), changes);
    }

    await refreshHighlights();
  }

  function dispatch(transaction: Transaction): void {
    state = applyTransaction(state, transaction);
    void syncLanguage(transaction.changes ?? []);
    render();
  }

  function runCommand(command: Command): boolean {
    return command(state, dispatch, {
      requestFocus() {
        textarea.focus();
      }
    });
  }

  function render(): void {
    rows.replaceChildren();

    const lineCount = Math.max(1, state.doc.lineCount);
    const activeOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
    const cursorPosition = state.doc.positionAt(activeOffset);
    const gutterDigits = Math.max(2, String(lineCount).length);
    const gutterWidth = gutterDigits * metrics.charWidth + 24;

    for (let index = 0; index < lineCount; index += 1) {
      const line = state.doc.lineAt(index);
      const row = document.createElement("div");
      const gutter = document.createElement("div");
      const content = document.createElement("div");

      row.className = "whx-editor__row";
      if (index === cursorPosition.line) {
        row.classList.add("whx-editor__row--active");
      }
      row.style.gridTemplateColumns = `${gutterWidth}px 1fr`;
      row.dataset.whxEditorRow = String(index + 1);

      gutter.className = "whx-editor__gutter";
      gutter.dataset.whxEditorGutter = String(index + 1);
      gutter.textContent = String(index + 1);

      content.className = "whx-editor__content";
      content.dataset.whxEditorContent = String(index + 1);

      const segments = renderLineFragments(line, state, highlights);

      for (const segment of segments) {
        const token = document.createElement("span");
        token.className = "whx-token";
        if (segment.isSelected) {
          token.classList.add("whx-token--selected");
        }
      if (segment.isCursor) {
          token.classList.add("whx-token--cursor-block");
          token.dataset.whxEditorCursor = "true";
          token.dataset.whxEditorCursorKind = segment.cursorKind ?? "";
        }
        token.dataset.role = segment.role;
        token.textContent = segment.text;
        content.append(token);
      }

      if (state.mode === "insert" && index === cursorPosition.line) {
        const caret = document.createElement("span");
        const caretHeight = Math.max(14, Math.round(metrics.lineHeight * 0.84));
        const caretTop = Math.max(0, Math.round((metrics.lineHeight - caretHeight) / 2));

        caret.className = "whx-editor__caret";
        caret.dataset.whxEditorCursor = "true";
        caret.dataset.whxEditorCursorKind = "line";
        caret.style.left = `${cursorPosition.column * metrics.charWidth}px`;
        caret.style.top = `${caretTop}px`;
        caret.style.height = `${caretHeight}px`;
        content.append(caret);
      }

      row.append(gutter, content);
      rows.append(row);
    }

    statusMode.textContent = state.mode === "insert" ? "INS" : state.mode === "visual" ? "VIS" : "NOR";
    statusFile.textContent = filePath;
    statusMeta.textContent = `1 sel   ${cursorPosition.line + 1}:${cursorPosition.column + 1}`;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) {
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

  root.addEventListener("focus", () => {
    if (document.activeElement !== textarea) {
      textarea.focus();
    }
  });
  root.addEventListener("mousedown", () => {
    textarea.focus();
  });
  textarea.addEventListener("keydown", handleKeydown);

  render();
  void syncLanguage([]);

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
      render();
    },
    async setLanguage(nextLanguage: LanguageProvider | null) {
      language?.destroy?.();
      language = nextLanguage;
      await syncLanguage([]);
    },
    setTheme(nextTheme: ThemeSpec) {
      theme = nextTheme;
      applyThemeVariables(root, theme);
      render();
    },
    async setValue(value: string) {
      state = createEditorState({ value, selection: createSelection(0, 0) });
      render();
      await syncLanguage([]);
    }
  };
}
