import {
  collectSearchMatches,
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets,
  getSelectionRanges,
  type EditorState
} from "@wx/editor-core";
import type { DiagnosticSeverity, EditorDiagnostic, HighlightRole, HighlightSpan } from "@wx/editor-language";

export type EditorLayoutToken =
  | "text"
  | "comment"
  | "function"
  | "gutter"
  | "keyword"
  | "number"
  | "operator"
  | "punctuation"
  | "selection"
  | "string"
  | "type"
  | "cursor"
  | "status"
  | "status-mode"
  | "bottom"
  | "bottom-prompt"
  | "search-match"
  | "search-current"
  | "flash-target"
  | "diagnostic-error"
  | "diagnostic-warning"
  | "diagnostic-info"
  | "diagnostic-hint"
  | "tooltip"
  | "tooltip-source"
  | "picker"
  | "picker-selected";

export interface EditorLayoutViewport {
  cols: number;
  rows: number;
  topVisualRow: number;
}

export interface EditorLayoutRun {
  col: number;
  text: string;
  token: EditorLayoutToken;
  part?: string;
  tone?: "info" | "warning" | "error";
  sourceRange?: { from: number; to: number };
  isIndentGuide?: boolean;
  selected?: boolean;
  searchMatch?: boolean;
  currentSearchMatch?: boolean;
  flashTarget?: boolean;
  cursorBlock?: boolean;
  severity?: DiagnosticSeverity;
  lineChangeKind?: "added" | "modified" | "deleted";
  deleted?: boolean;
  selectedInPicker?: boolean;
}

export type EditorLayoutOverlay =
  | {
      kind: "cursor-line";
      row: number;
      col: number;
      height: number;
      token: "cursor";
      sourceRange?: { from: number; to: number };
    }
  | {
      kind: "inline-diagnostic";
      row: number;
      col: number;
      text: string;
      token:
        | "diagnostic-error"
        | "diagnostic-warning"
        | "diagnostic-info"
        | "diagnostic-hint";
      severity: DiagnosticSeverity;
      sourceRange?: { from: number; to: number };
    }
  | {
      kind: "flash-hint";
      row: number;
      col: number;
      text: string;
      token: "flash-target";
      sourceRange?: { from: number; to: number };
    }
  | {
      kind: "selection-block";
      row: number;
      col: number;
      width: number;
      height: number;
      token: "selection";
      sourceRange?: { from: number; to: number };
    }
  | {
      kind: "panel-border";
      row: number;
      col: number;
      width: number;
      height: number;
      token: "tooltip" | "picker";
    };

export interface EditorLayoutPanel {
  kind: "tooltip" | "picker";
  token: "tooltip" | "picker";
  anchor: { col: number; row: number };
  rows: ReadonlyArray<readonly EditorLayoutRun[]>;
  tone?: "info" | "warning" | "error";
  width: number;
  height: number;
}

export interface EditorLayoutRow {
  docLine: number;
  visualRowIndex: number;
  isContinuation: boolean;
  isActive: boolean;
  isJumpHighlighted: boolean;
  gutterRuns: readonly EditorLayoutRun[];
  contentRuns: readonly EditorLayoutRun[];
  overlays: readonly EditorLayoutOverlay[];
  segmentStart: number;
  segmentEnd: number;
  startColumn: number;
  isLastSegment: boolean;
  diagnosticSeverity: DiagnosticSeverity | null;
  lineChangeKind: "added" | "modified" | null;
  deletedLineChange: boolean;
}

export interface EditorLayoutModel {
  document: {
    totalVisualRows: number;
    visibleRange: { fromVisualRow: number; toVisualRow: number };
    rows: readonly EditorLayoutRow[];
    visualRows: ReadonlyArray<{
      docLine: number;
      visualRowIndex: number;
      segmentStart: number;
      segmentEnd: number;
      startColumn: number;
      isContinuation: boolean;
      isLastSegment: boolean;
    }>;
    lineVisualRanges: ReadonlyArray<{ from: number; to: number }>;
  };
  statusBar: readonly EditorLayoutRun[];
  bottomBar: {
    active: boolean;
    runs: readonly EditorLayoutRun[];
  };
  panels: readonly EditorLayoutPanel[];
}

export interface EditorVisualRow {
  docLine: number;
  visualRowIndex: number;
  segmentStart: number;
  segmentEnd: number;
  startColumn: number;
  isContinuation: boolean;
  isLastSegment: boolean;
}

export interface EditorLineVisualRange {
  from: number;
  to: number;
}

export interface EditorVisualRowsInput {
  state: EditorState;
  viewport: EditorLayoutViewport;
  softWrap: boolean;
}

export interface EditorLayoutLineChangeState {
  kind: "added" | "modified" | null;
  deleted: boolean;
}

export interface EditorLayoutCommandLineState {
  active: boolean;
  value: string;
  prompt: ":" | "/" | "?";
}

export interface EditorLayoutPickerItemState {
  label: string;
  detail?: string;
  selected?: boolean;
}

export interface EditorLayoutPickerState {
  active: boolean;
  loading: boolean;
  title: string;
  items: readonly EditorLayoutPickerItemState[];
  selectedIndex: number;
  error: string | null;
  query: string;
  variant: "bar" | "modal";
  previewTitle: string;
  previewContent: string;
  previewLoading: boolean;
}

export interface EditorLayoutBottomMessageState {
  tone: "info" | "warning" | "error";
  text: string;
}

export interface EditorLayoutHoverState {
  active: boolean;
  content: string;
  source?: string;
  tone: "info" | "warning" | "error";
}

export interface EditorLayoutFlashHintState {
  offset: number;
  label: string;
}

export interface EditorLayoutFlashState {
  active: boolean;
  target: string;
  input: string;
  hints: readonly EditorLayoutFlashHintState[];
}

export type EditorLayoutPendingAction =
  | null
  | { kind: "g" | "[" | "]" | "m" | "?" | "space" | "flash-target" }
  | { kind: "z"; sticky: boolean }
  | { kind: "find"; variant: "f" | "F" | "t" | "T" }
  | { kind: "textobject"; mode: "around" | "inside" }
  | { kind: "surround-add" }
  | { kind: "surround-delete" }
  | { kind: "surround-replace-from" }
  | { kind: "surround-replace-to"; fromObject: string }
  | { kind: "register-select"; insert: boolean };

export interface EditorLayoutPresentationState {
  filePath: string;
  viewport: {
    topVisualRow: number;
    visibleRowCapacity: number;
    wrapColumns: number;
    softWrap: boolean;
    visualRows: readonly EditorVisualRow[];
    visibleVisualRows: readonly EditorVisualRow[];
    lineVisualRanges: readonly EditorLineVisualRange[];
  };
  language: {
    diagnostics: readonly EditorDiagnostic[];
    diagnosticsByLine: ReadonlyMap<number, readonly EditorDiagnostic[]>;
    lineChangesByLine: ReadonlyMap<number, EditorLayoutLineChangeState>;
    visibleHighlightsByLine: ReadonlyMap<number, readonly HighlightSpan[]>;
  };
  search: {
    lastMatch: { from: number; to: number } | null;
    visibleMatchesByLine: ReadonlyMap<number, readonly { from: number; to: number }[]>;
  };
  ui: {
    commandLine: EditorLayoutCommandLineState;
    picker: EditorLayoutPickerState;
    bottomMessage: EditorLayoutBottomMessageState | null;
    hover: EditorLayoutHoverState;
    flash: EditorLayoutFlashState;
    pendingAction: EditorLayoutPendingAction;
    pendingCount: string;
  };
}

export interface EditorLayoutInput {
  state: EditorState;
  presentation: EditorLayoutPresentationState;
  hoverAnchor: {
    col: number;
    row: number;
  };
  indentGuides: {
    render: boolean;
    character: string;
    skipLevels: number;
    indentWidth: number;
  };
}

interface EditorLayoutRowBuildContext {
  activeOffset: number;
  activeRow: ReturnType<typeof getVisualRowForOffset>;
}

const EMPTY_CELL_TEXT = "\u00a0";
const END_OF_LINE_DIAGNOSTIC_MIN: DiagnosticSeverity = "hint";
const CURSOR_LINE_INLINE_DIAGNOSTIC_MIN: DiagnosticSeverity = "warning";
const OTHER_LINES_INLINE_DIAGNOSTIC_MIN: DiagnosticSeverity = "error";
const FLASH_HOME_BIAS_LETTERS = [..."fjdkslagheruiwovncmptyqbzx"];
const FLASH_ALL_LETTERS = [..."qwertyuiopasdfghjklzxcvbnm"];
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

const DIAGNOSTIC_SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3
};

function tokenForDiagnosticSeverity(
  severity: DiagnosticSeverity
): "diagnostic-error" | "diagnostic-warning" | "diagnostic-info" | "diagnostic-hint" {
  return severity === "error"
    ? "diagnostic-error"
    : severity === "warning"
      ? "diagnostic-warning"
      : severity === "info"
        ? "diagnostic-info"
        : "diagnostic-hint";
}

function meetsDiagnosticThreshold(severity: DiagnosticSeverity, minimum: DiagnosticSeverity): boolean {
  return DIAGNOSTIC_SEVERITY_ORDER[severity] <= DIAGNOSTIC_SEVERITY_ORDER[minimum];
}

function buildHighlightCache(state: EditorState, spans: readonly HighlightSpan[]): Map<number, HighlightSpan[]> {
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

function buildDiagnosticsCache(state: EditorState, diagnostics: readonly EditorDiagnostic[]): Map<number, EditorDiagnostic[]> {
  const nextByLine = new Map<number, EditorDiagnostic[]>();

  for (const diagnostic of diagnostics) {
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

function buildLineChangesMap(
  changes: ReadonlyArray<{ line: number; kind: "added" | "modified" | "deleted" }>
): Map<number, { kind: "added" | "modified" | null; deleted: boolean }> {
  const next = new Map<number, { kind: "added" | "modified" | null; deleted: boolean }>();

  for (const change of changes) {
    if (change.line < 0 || !Number.isFinite(change.line)) {
      continue;
    }

    if (change.kind === "deleted") {
      const previous = next.get(change.line) ?? { kind: null, deleted: false };
      next.set(change.line, { ...previous, deleted: true });
      continue;
    }

    const previous = next.get(change.line) ?? { kind: null, deleted: false };
    next.set(change.line, {
      kind: change.kind === "modified" || previous.kind === "modified" ? "modified" : change.kind,
      deleted: previous.deleted
    });
  }

  return next;
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

export function buildFlashLabels(target: string, count: number): string[] {
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

function roleAtOffset(spans: readonly HighlightSpan[], offset: number): HighlightRole {
  const span = spans.find((entry) => offset >= entry.from && offset < entry.to);
  return span?.role ?? "text";
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

export function buildVisualRows(input: EditorVisualRowsInput): {
  visualRows: EditorVisualRow[];
  lineVisualRanges: EditorLineVisualRange[];
} {
  const wrapColumns = !input.softWrap ? Number.MAX_SAFE_INTEGER : Math.max(1, input.viewport.cols);
  const visualRows: Array<{
    docLine: number;
    visualRowIndex: number;
    segmentStart: number;
    segmentEnd: number;
    startColumn: number;
    isContinuation: boolean;
    isLastSegment: boolean;
  }> = [];
  const lineVisualRanges: Array<{ from: number; to: number }> = [];

  for (let lineIndex = 0; lineIndex < input.state.doc.lineCount; lineIndex += 1) {
    const line = input.state.doc.lineAt(lineIndex);
    const lineStartRow = visualRows.length;
    const textLength = line.text.length;

    if (!input.softWrap || textLength <= wrapColumns || wrapColumns === Number.MAX_SAFE_INTEGER) {
      visualRows.push({
        docLine: lineIndex,
        visualRowIndex: visualRows.length,
        segmentStart: line.start,
        segmentEnd: line.end,
        startColumn: 0,
        isContinuation: false,
        isLastSegment: true
      });
    } else {
      for (let startColumn = 0; startColumn < textLength; startColumn += wrapColumns) {
        const endColumn = Math.min(textLength, startColumn + wrapColumns);
        visualRows.push({
          docLine: lineIndex,
          visualRowIndex: visualRows.length,
          segmentStart: line.start + startColumn,
          segmentEnd: line.start + endColumn,
          startColumn,
          isContinuation: startColumn > 0,
          isLastSegment: endColumn >= textLength
        });
      }
    }

    if (visualRows.length === lineStartRow) {
      visualRows.push({
        docLine: lineIndex,
        visualRowIndex: visualRows.length,
        segmentStart: line.start,
        segmentEnd: line.start,
        startColumn: 0,
        isContinuation: false,
        isLastSegment: true
      });
    }

    lineVisualRanges[lineIndex] = {
      from: lineStartRow,
      to: visualRows.length - 1
    };
  }

  return { visualRows, lineVisualRanges };
}

function getActiveOffset(state: EditorState): number {
  return state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
}

export function getVisualRowForOffset(
  state: EditorState,
  visualRows: ReadonlyArray<EditorVisualRow>,
  lineVisualRanges: ReadonlyArray<EditorLineVisualRange>,
  offset: number,
  softWrap: boolean,
  cols: number
) {
  const fallback = visualRows[0] ?? {
    docLine: 0,
    visualRowIndex: 0,
    segmentStart: 0,
    segmentEnd: 0,
    startColumn: 0,
    isContinuation: false,
    isLastSegment: true
  };
  const position = state.doc.positionAt(offset);
  const line = state.doc.lineAt(position.line);
  const range = lineVisualRanges[position.line] ?? { from: 0, to: 0 };
  const rowOffset = softWrap && cols !== Number.MAX_SAFE_INTEGER ? Math.floor(position.column / cols) : 0;
  const rowIndex = Math.max(range.from, Math.min(range.to, range.from + rowOffset));
  const row = visualRows[rowIndex] ?? fallback;
  const maxColumn = Math.max(0, line.text.length - row.startColumn);
  return {
    rowIndex,
    column: Math.max(0, Math.min(maxColumn, position.column - row.startColumn)),
    row
  };
}

function toneForSeverity(severity: DiagnosticSeverity): "info" | "warning" | "error" {
  return severity === "error" ? "error" : severity === "warning" ? "warning" : "info";
}

function getStatusModeText(input: EditorLayoutInput): string {
  if (input.presentation.ui.flash.active || input.presentation.ui.pendingAction?.kind === "flash-target") {
    return " JMP ";
  }

  if (input.state.mode === "insert") {
    return " INS ";
  }

  if (input.state.mode === "visual") {
    return " VIS ";
  }

  return " NOR ";
}

function renderLineRuns(args: {
  state: EditorState;
  spans: readonly HighlightSpan[];
  lineDiagnostics: readonly EditorDiagnostic[];
  lineSearchMatches: readonly { from: number; to: number }[];
  currentSearchMatch: { from: number; to: number } | null;
  flashOffsets: ReadonlySet<number>;
  segmentStart: number;
  segmentEnd: number;
  includeLineEndingCell: boolean;
  indentGuideOptions: { render: boolean; character: string; skipLevels: number; indentWidth: number };
}) {
  const { state } = args;
  const line = state.doc.lineAt(state.doc.positionAt(args.segmentStart).line);
  const fragments: EditorLayoutRun[] = [];
  const activeOffset = getActiveCharacterOffset(state);
  const selections = getSelectionRanges(state);
  const lineEnd = line.start + line.text.length;
  const segmentStartIndex = Math.max(0, args.segmentStart - line.start);
  const segmentEndIndex = Math.max(segmentStartIndex, args.segmentEnd - line.start);
  const indentGuideOffsets = getIndentGuideOffsets(line.text, line.start, args.indentGuideOptions);
  const isSelectedOffset = (offset: number) => selections.some((selection) => offset >= selection.from && offset < selection.to);
  const pushRun = (run: EditorLayoutRun) => {
    const previous = fragments[fragments.length - 1];

    if (
      previous &&
      previous.sourceRange &&
      run.sourceRange &&
      !previous.cursorBlock &&
      !run.cursorBlock &&
      previous.token === run.token &&
      previous.isIndentGuide === run.isIndentGuide &&
      previous.selected === run.selected &&
      previous.searchMatch === run.searchMatch &&
      previous.currentSearchMatch === run.currentSearchMatch &&
      previous.flashTarget === run.flashTarget &&
      previous.severity === run.severity &&
      previous.sourceRange.to === run.sourceRange.from &&
      previous.col + previous.text.length === run.col
    ) {
      previous.text += run.text;
      previous.sourceRange = {
        from: previous.sourceRange.from,
        to: run.sourceRange.to
      };
      return;
    }

    fragments.push(run);
  };

  if (state.mode === "insert") {
    if (line.text.length === 0) {
      return [
        {
          col: 0,
          text: EMPTY_CELL_TEXT,
          token: "text" as const,
          sourceRange: { from: line.start, to: line.start + 1 }
        }
      ];
    }

    for (let index = segmentStartIndex; index < segmentEndIndex; index += 1) {
      const offset = line.start + index;
      const searchFlags = searchFlagsAtOffset(args.lineSearchMatches, args.currentSearchMatch, offset);
      const token = roleAtOffset(args.spans, offset) as EditorLayoutToken;
      pushRun({
        col: index - segmentStartIndex,
        text: indentGuideOffsets.has(offset) ? args.indentGuideOptions.character : (line.text[index] ?? EMPTY_CELL_TEXT),
        token,
        sourceRange: { from: offset, to: offset + 1 },
        isIndentGuide: indentGuideOffsets.has(offset),
        severity: diagnosticSeverityAtOffset(args.lineDiagnostics, offset) ?? undefined,
        searchMatch: searchFlags.isSearchMatch,
        currentSearchMatch: searchFlags.isCurrentSearchMatch,
        flashTarget: args.flashOffsets.has(offset)
      });
    }

    return fragments;
  }

  if (line.text.length === 0) {
    const selected = isSelectedOffset(line.start);
    return [
      {
        col: 0,
        text: EMPTY_CELL_TEXT,
        token: "text" as const,
        sourceRange: { from: line.start, to: line.start + 1 },
        selected,
        cursorBlock: activeOffset === line.start
      }
    ];
  }

  for (let index = segmentStartIndex; index < segmentEndIndex; index += 1) {
    const offset = line.start + index;
    const searchFlags = searchFlagsAtOffset(args.lineSearchMatches, args.currentSearchMatch, offset);
    const token = roleAtOffset(args.spans, offset) as EditorLayoutToken;
    pushRun({
      col: index - segmentStartIndex,
      text: indentGuideOffsets.has(offset) ? args.indentGuideOptions.character : (line.text[index] ?? " "),
      token,
      sourceRange: { from: offset, to: offset + 1 },
      isIndentGuide: indentGuideOffsets.has(offset),
      selected: isSelectedOffset(offset),
      cursorBlock: offset === activeOffset,
      severity: diagnosticSeverityAtOffset(args.lineDiagnostics, offset) ?? undefined,
      searchMatch: searchFlags.isSearchMatch,
      currentSearchMatch: searchFlags.isCurrentSearchMatch,
      flashTarget: args.flashOffsets.has(offset)
    });
  }

  const hasLineEnding = lineEnd < state.doc.length && state.doc.text[lineEnd] === "\n";
  const lineEndingSelected = hasLineEnding && isSelectedOffset(lineEnd);
  const lineEndingCursor = hasLineEnding && activeOffset === lineEnd;

  if (args.includeLineEndingCell && (lineEndingSelected || lineEndingCursor)) {
    pushRun({
      col: Math.max(0, segmentEndIndex - segmentStartIndex),
      text: EMPTY_CELL_TEXT,
      token: "text",
      sourceRange: { from: lineEnd, to: lineEnd + 1 },
      selected: lineEndingSelected,
      cursorBlock: lineEndingCursor
    });
  }

  return fragments;
}

function getLineSearchMatches(lineIndex: number, state: EditorState, searchMatches: readonly { from: number; to: number }[]) {
  const line = state.doc.lineAt(lineIndex);
  const lineEnd = line.start + line.text.length;
  return searchMatches.filter((entry) => entry.from < lineEnd && entry.to > line.start);
}

function getLineDiagnosticSeverity(entries: readonly EditorDiagnostic[]): DiagnosticSeverity | null {
  let best: DiagnosticSeverity | null = null;

  for (const entry of entries) {
    if (!best || DIAGNOSTIC_SEVERITY_ORDER[entry.severity] < DIAGNOSTIC_SEVERITY_ORDER[best]) {
      best = entry.severity;
    }
  }

  return best;
}

function getDiagnosticsSummary(diagnostics: readonly EditorDiagnostic[]): { errors: number; warnings: number } {
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

function splitPanelRows(token: "tooltip" | "tooltip-source", text: string, part: string): EditorLayoutRun[][] {
  if (!text) {
    return [];
  }

  return text.split("\n").map((line) => [
    {
      col: 0,
      text: line || " ",
      token,
      part
    }
  ]);
}

function truncatePanelText(text: string, width: number): string {
  const normalized = text.replace(/\t/g, "  ");

  if (width <= 0) {
    return "";
  }

  if (normalized.length <= width) {
    return normalized;
  }

  if (width === 1) {
    return normalized.slice(0, 1);
  }

  return `${normalized.slice(0, Math.max(0, width - 1))}…`;
}

function buildPickerPanel(input: EditorLayoutInput): EditorLayoutPanel | null {
  const picker = input.presentation.ui.picker;

  if (!picker.active || picker.variant !== "modal") {
    return null;
  }

  const lineDigits = Math.max(2, String(Math.max(1, input.state.doc.lineCount)).length);
  const gutterCols = lineDigits + 4;
  const contentCols =
    input.presentation.viewport.softWrap && Number.isFinite(input.presentation.viewport.wrapColumns)
      ? Math.max(24, input.presentation.viewport.wrapColumns)
      : 80;
  const totalCols = gutterCols + contentCols;
  const innerWidth = Math.max(36, totalCols - 10);
  const leftWidth = Math.max(18, Math.min(Math.floor(innerWidth * 0.46), innerWidth - 12));
  const rightWidth = Math.max(12, innerWidth - leftWidth - 3);
  const visibleBodyRows = Math.max(4, input.presentation.viewport.visibleRowCapacity - 2);
  const listRows = Math.max(4, visibleBodyRows - 2);
  const selectedIndex = Math.max(0, Math.min(picker.items.length - 1, picker.selectedIndex));
  const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(listRows / 2), Math.max(0, picker.items.length - listRows)));
  const visibleItems = picker.items.slice(startIndex, startIndex + listRows);
  const previewLines = (picker.previewLoading ? "Loading preview..." : (picker.previewContent || "No preview"))
    .split("\n")
    .slice(0, listRows - 1);
  const rows: EditorLayoutRun[][] = [];
  const queryText = picker.query || " ";
  const countText = `${picker.items.length > 0 ? selectedIndex + 1 : 0}/${picker.items.length}`;

  rows.push([
    {
      col: 0,
      text: truncatePanelText(queryText, innerWidth - countText.length - 1),
      token: "picker",
      part: "picker-query"
    },
    {
      col: Math.max(0, innerWidth - countText.length),
      text: countText,
      token: "picker",
      part: "picker-count"
    }
  ]);

  for (let rowIndex = 0; rowIndex < listRows; rowIndex += 1) {
    const item = visibleItems[rowIndex];
    const previewLine = rowIndex === 0 ? (picker.previewTitle || "preview") : (previewLines[rowIndex - 1] ?? "");
    const listToken = item?.selected ? "picker-selected" : "picker";
    const prefix = item ? (item.selected ? "› " : "  ") : "  ";
    const detailSuffix = item?.detail ? `  ${item.detail}` : "";
    const listText = item ? truncatePanelText(`${prefix}${item.label}${detailSuffix}`, leftWidth) : "";

    rows.push([
      {
        col: 0,
        text: listText.padEnd(leftWidth, " "),
        token: listToken,
        part: "picker-item",
        selectedInPicker: item?.selected
      },
      {
        col: leftWidth + 1,
        text: "│",
        token: "picker",
        part: "picker-separator"
      },
      {
        col: leftWidth + 3,
        text: truncatePanelText(previewLine, rightWidth).padEnd(rightWidth, " "),
        token: rowIndex === 0 ? "tooltip-source" : "tooltip",
        part: rowIndex === 0 ? "picker-preview-title" : "picker-preview-body"
      }
    ]);
  }

  return {
    kind: "picker",
    token: "picker",
    anchor: {
      col: Math.max(0, Math.floor((totalCols - (innerWidth + 2)) / 2)),
      row: Math.max(0, Math.floor(Math.max(1, visibleBodyRows - (rows.length + 2)) / 2))
    },
    rows,
    width: innerWidth,
    height: rows.length
  };
}

export function buildEditorLayoutRow(
  input: EditorLayoutInput,
  visualRow: EditorVisualRow,
  context?: EditorLayoutRowBuildContext
): EditorLayoutRow {
  const visualRows = input.presentation.viewport.visualRows;
  const lineVisualRanges = input.presentation.viewport.lineVisualRanges;
  const highlightCache = input.presentation.language.visibleHighlightsByLine;
  const diagnosticsByLine = input.presentation.language.diagnosticsByLine;
  const lineChangesByLine = input.presentation.language.lineChangesByLine;
  const searchMatchesByLine = input.presentation.search.visibleMatchesByLine;
  const activeOffset = context?.activeOffset ?? getActiveOffset(input.state);
  const activeRow =
    context?.activeRow ??
    getVisualRowForOffset(
      input.state,
      visualRows,
      lineVisualRanges,
      activeOffset,
      input.presentation.viewport.softWrap,
      input.presentation.viewport.softWrap ? Math.max(1, input.presentation.viewport.wrapColumns) : Number.MAX_SAFE_INTEGER
    );
  const visualRowIndex = visualRow.visualRowIndex;
  const lineIndex = visualRow.docLine;
  const lineDiagnostics = diagnosticsByLine.get(lineIndex) ?? [];
  const lineSearchMatches = searchMatchesByLine.get(lineIndex) ?? [];
  const lineDiagnosticSeverity = visualRow.isContinuation ? null : getLineDiagnosticSeverity(lineDiagnostics);
  const lineChangeState = visualRow.isContinuation
    ? { kind: null, deleted: false }
    : (lineChangesByLine.get(lineIndex) ?? { kind: null, deleted: false });
  const inlineDiagnostic = selectDiagnostic(
    lineDiagnostics,
    lineIndex === input.state.doc.positionAt(activeOffset).line
      ? CURSOR_LINE_INLINE_DIAGNOSTIC_MIN
      : OTHER_LINES_INLINE_DIAGNOSTIC_MIN
  );
  const inlineDiagnosticInRow =
    inlineDiagnostic &&
    inlineDiagnostic.from >= visualRow.segmentStart &&
    inlineDiagnostic.from <= visualRow.segmentEnd
      ? inlineDiagnostic
      : null;
  const endOfLineDiagnostic = visualRow.isLastSegment
    ? selectDiagnostic(lineDiagnostics, END_OF_LINE_DIAGNOSTIC_MIN, inlineDiagnostic)
    : null;
  const flashHints = input.presentation.ui.flash.active
    ? input.presentation.ui.flash.hints.filter(
        (hint) => hint.offset >= visualRow.segmentStart && hint.offset < visualRow.segmentEnd
      )
    : [];
  const isJumpHighlighted =
    input.presentation.ui.pendingAction?.kind === "flash-target" ||
    (input.presentation.ui.flash.active && flashHints.length > 0);
  const flashOffsets = new Set(flashHints.map((hint) => hint.offset));
  const contentRuns = renderLineRuns({
    state: input.state,
    spans: highlightCache.get(lineIndex) ?? [],
    lineDiagnostics,
    lineSearchMatches,
    currentSearchMatch: input.presentation.search.lastMatch,
    flashOffsets,
    segmentStart: visualRow.segmentStart,
    segmentEnd: visualRow.segmentEnd,
    includeLineEndingCell: visualRow.isLastSegment,
    indentGuideOptions: input.indentGuides
  });
  const overlays: EditorLayoutOverlay[] = [];

  if (inlineDiagnosticInRow) {
    const diagnosticStartColumn = Math.max(
      0,
      inlineDiagnosticInRow.from > visualRow.segmentStart
        ? input.state.doc.positionAt(inlineDiagnosticInRow.from).column - visualRow.startColumn
        : 0
    );
    overlays.push({
      kind: "inline-diagnostic",
      row: 1,
      col: diagnosticStartColumn,
      text: inlineDiagnosticInRow.message,
      token: tokenForDiagnosticSeverity(inlineDiagnosticInRow.severity),
      severity: inlineDiagnosticInRow.severity,
      sourceRange: { from: inlineDiagnosticInRow.from, to: inlineDiagnosticInRow.to }
    });
  }

  if (endOfLineDiagnostic) {
    const eolCol = contentRuns.reduce((max, run) => Math.max(max, run.col + run.text.length), 0) + 2;
    overlays.push({
      kind: "inline-diagnostic",
      row: 0,
      col: eolCol,
      text: endOfLineDiagnostic.message,
      token: tokenForDiagnosticSeverity(endOfLineDiagnostic.severity),
      severity: endOfLineDiagnostic.severity,
      sourceRange: { from: endOfLineDiagnostic.from, to: endOfLineDiagnostic.to }
    });
  }

  if (input.state.mode === "insert" && visualRowIndex === activeRow.rowIndex) {
    overlays.push({
      kind: "cursor-line",
      row: 0,
      col: activeRow.column,
      height: 1,
      token: "cursor",
      sourceRange: { from: activeOffset, to: activeOffset }
    });
  }

  for (const hint of flashHints) {
    const column = input.state.doc.positionAt(hint.offset).column - visualRow.startColumn;
    overlays.push({
      kind: "flash-hint",
      row: 0,
      col: Math.max(0, column),
      text: hint.label,
      token: "flash-target",
      sourceRange: { from: hint.offset, to: hint.offset + 1 }
    });
  }

  const gutterRuns: EditorLayoutRun[] = [
    {
      col: 0,
      text: " ",
      token: lineDiagnosticSeverity ? tokenForDiagnosticSeverity(lineDiagnosticSeverity) : "gutter",
      part: "gutter-marker",
      severity: lineDiagnosticSeverity ?? undefined
    },
    {
      col: 1,
      text: visualRow.isContinuation ? "↪" : String(lineIndex + 1),
      token: "gutter",
      part: "gutter-number"
    },
    {
      col: 5,
      text: " ",
      token: "gutter",
      part: "gutter-change",
      lineChangeKind: lineChangeState.kind ?? undefined,
      deleted: lineChangeState.deleted
    }
  ];

  return {
    docLine: lineIndex,
    visualRowIndex,
    isContinuation: visualRow.isContinuation,
    isActive: visualRowIndex === activeRow.rowIndex,
    isJumpHighlighted,
    gutterRuns,
    contentRuns,
    overlays,
    segmentStart: visualRow.segmentStart,
    segmentEnd: visualRow.segmentEnd,
    startColumn: visualRow.startColumn,
    isLastSegment: visualRow.isLastSegment,
    diagnosticSeverity: lineDiagnosticSeverity,
    lineChangeKind: lineChangeState.kind,
    deletedLineChange: lineChangeState.deleted
  };
}

export function buildEditorLayout(input: EditorLayoutInput): EditorLayoutModel {
  const visualRows = input.presentation.viewport.visualRows;
  const visibleVisualRows = input.presentation.viewport.visibleVisualRows;
  const lineVisualRanges = input.presentation.viewport.lineVisualRanges;
  const highlightCache = input.presentation.language.visibleHighlightsByLine;
  const diagnosticsByLine = input.presentation.language.diagnosticsByLine;
  const lineChangesByLine = input.presentation.language.lineChangesByLine;
  const searchMatchesByLine = input.presentation.search.visibleMatchesByLine;
  const activeOffset = getActiveOffset(input.state);
  const activeRow = getVisualRowForOffset(
    input.state,
    visualRows,
    lineVisualRanges,
    activeOffset,
    input.presentation.viewport.softWrap,
    input.presentation.viewport.softWrap ? Math.max(1, input.presentation.viewport.wrapColumns) : Number.MAX_SAFE_INTEGER
  );
  const rows: EditorLayoutRow[] = [];

  for (const visualRow of visibleVisualRows) {
    rows.push(buildEditorLayoutRow(input, visualRow, { activeOffset, activeRow }));
  }

  const cursorPosition = input.state.doc.positionAt(activeOffset);
  const { errors, warnings } = getDiagnosticsSummary(input.presentation.language.diagnostics);
  const statusModeText = getStatusModeText(input);
  const statusBar: EditorLayoutRun[] = [
    {
      col: 0,
      text: statusModeText,
      token: "status-mode",
      part: "status-mode"
    },
    {
      col: statusModeText.length,
      text: ` ${input.presentation.filePath}`,
      token: "status",
      part: "status-file"
    },
    {
      col: statusModeText.length + input.presentation.filePath.length + 4,
      text: [
        input.state.selection.ranges.length === 1 ? "1 sel" : `${input.state.selection.ranges.length} sels`,
        errors > 0 ? `E${errors}` : "",
        warnings > 0 ? `W${warnings}` : "",
        `${cursorPosition.line + 1}:${cursorPosition.column + 1}`
      ]
        .filter(Boolean)
        .join("   "),
      token: "status",
      part: "status-meta"
    }
  ];

  const bottomRuns: EditorLayoutRun[] = [];

  if (input.presentation.ui.commandLine.active) {
    bottomRuns.push({
      col: 0,
      text: input.presentation.ui.commandLine.prompt,
      token: "bottom-prompt",
      part: "command-prompt"
    });
    bottomRuns.push({
      col: 1,
      text: input.presentation.ui.commandLine.value,
      token: "bottom",
      part: "command-text"
    });
  } else if (input.presentation.ui.picker.active) {
    if (input.presentation.ui.picker.variant === "modal") {
      bottomRuns.push({
        col: 0,
        text: " ",
        token: "bottom",
        part: "bottom-fill"
      });
    } else if (input.presentation.ui.picker.loading) {
      bottomRuns.push({
        col: 0,
        text: `Loading ${input.presentation.ui.picker.title}...`,
        token: "picker",
        part: "picker-loading"
      });
    } else if (input.presentation.ui.picker.error) {
      bottomRuns.push({
        col: 0,
        text: input.presentation.ui.picker.error,
        token: "picker",
        part: "picker-error"
      });
    } else {
      let col = 0;
      const pickerQuery = input.presentation.ui.picker.query.trim();

      if (pickerQuery) {
        const queryText = `${input.presentation.ui.picker.title}>${pickerQuery} `;
        bottomRuns.push({
          col,
          text: queryText,
          token: "picker",
          part: "picker-query"
        });
        col += queryText.length;
      }

      input.presentation.ui.picker.items.slice(0, 9).forEach((entry, index) => {
        const text = `${index + 1}:${entry.label}`;
        bottomRuns.push({
          col,
          text,
          token: index === input.presentation.ui.picker.selectedIndex ? "picker-selected" : "picker",
          part: "code-action",
          selectedInPicker: index === input.presentation.ui.picker.selectedIndex
        });
        col += text.length + 1;
      });
    }
  } else if (input.presentation.ui.bottomMessage) {
    bottomRuns.push({
      col: 0,
      text: input.presentation.ui.bottomMessage.text,
      token: "bottom",
      part: "bottom-message",
      tone: input.presentation.ui.bottomMessage.tone
    });
  } else if (input.presentation.ui.flash.active) {
    bottomRuns.push({
      col: 0,
      text: input.presentation.ui.flash.input
        ? ` ${input.presentation.ui.flash.target} ${input.presentation.ui.flash.input}`
        : ` ${input.presentation.ui.flash.target}`,
      token: "bottom-prompt",
      part: "prefix-hint"
    });
  } else if (input.presentation.ui.pendingAction?.kind === "flash-target") {
    bottomRuns.push({
      col: 0,
      text: "<space>",
      token: "bottom-prompt",
      part: "prefix-hint"
    });
  } else if (input.presentation.ui.pendingAction?.kind === "?") {
    bottomRuns.push({
      col: 0,
      text: "?",
      token: "bottom-prompt",
      part: "prefix-hint"
    });
  } else if (input.presentation.ui.pendingAction?.kind === "space") {
    bottomRuns.push({
      col: 0,
      text: "<space>",
      token: "bottom-prompt",
      part: "prefix-hint"
    });
  } else if (
    input.presentation.ui.pendingAction?.kind === "g" ||
    input.presentation.ui.pendingAction?.kind === "[" ||
    input.presentation.ui.pendingAction?.kind === "]" ||
    input.presentation.ui.pendingAction?.kind === "m"
  ) {
    bottomRuns.push({
      col: 0,
      text: input.presentation.ui.pendingAction.kind,
      token: "bottom-prompt",
      part: "prefix-hint"
    });
  } else if (input.presentation.ui.pendingAction?.kind === "z") {
    bottomRuns.push({
      col: 0,
      text: input.presentation.ui.pendingAction.sticky ? "Z" : "z",
      token: "bottom-prompt",
      part: "prefix-hint"
    });
  } else if (input.presentation.ui.pendingCount) {
    bottomRuns.push({
      col: 0,
      text: input.presentation.ui.pendingCount,
      token: "bottom-prompt",
      part: "prefix-hint"
    });
  } else {
    bottomRuns.push({
      col: 0,
      text: " ",
      token: "bottom",
      part: "bottom-fill"
    });
  }

  const panels: EditorLayoutPanel[] = [];

  if (input.presentation.ui.hover.active) {
    const panelRows = [
      ...splitPanelRows("tooltip-source", input.presentation.ui.hover.source ?? "", "tooltip-source"),
      ...splitPanelRows("tooltip", input.presentation.ui.hover.content, "tooltip-body")
    ];
    const width = panelRows.reduce(
      (max, row) => Math.max(max, row.reduce((rowMax, run) => Math.max(rowMax, run.col + run.text.length), 0)),
      0
    );

    panels.push({
      kind: "tooltip",
      token: "tooltip",
      anchor: { col: input.hoverAnchor.col, row: input.hoverAnchor.row },
      rows: panelRows,
      tone: input.presentation.ui.hover.tone,
      width,
      height: Math.max(1, panelRows.length)
    });
  }

  const pickerPanel = buildPickerPanel(input);
  if (pickerPanel) {
    panels.push(pickerPanel);
  }

  return {
    document: {
      totalVisualRows: Math.max(1, visualRows.length),
      visibleRange: {
        fromVisualRow: visibleVisualRows[0]?.visualRowIndex ?? input.presentation.viewport.topVisualRow,
        toVisualRow:
          visibleVisualRows[visibleVisualRows.length - 1]?.visualRowIndex ??
          Math.max(0, input.presentation.viewport.topVisualRow + visibleVisualRows.length - 1)
      },
      rows,
      visualRows,
      lineVisualRanges
    },
    statusBar,
    bottomBar: {
      active:
        input.presentation.ui.commandLine.active ||
        input.presentation.ui.picker.active ||
        !!input.presentation.ui.bottomMessage ||
        input.presentation.ui.flash.active ||
        !!input.presentation.ui.pendingCount ||
        !!input.presentation.ui.pendingAction,
      runs: bottomRuns
    },
    panels
  };
}
