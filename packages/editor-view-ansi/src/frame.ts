import type { EditorState } from "@wx/editor-core";
import {
  buildEditorLayout,
  type EditorLayoutModel,
  type EditorLayoutPanel,
  type EditorLayoutRow,
  type EditorLayoutRun
} from "@wx/editor-layout";
import { defaultTheme, resolveThemeColor, type ThemeSpec } from "@wx/editor-theme";

import type { RenderEditorAnsiFrameInput } from "./index";
import {
  ansiStyle,
  BOTTOM_BG,
  type Cell,
  type CellStyle,
  makeStyle,
  PANEL_BG,
  PANEL_BORDER,
  STATUS_BG,
  styleEquals,
  styleForGutterCell,
  styleForStatusMode,
  styleForThemeRole,
  styleForToken
} from "./frame-theme";

const ANSI_RESET = "\u001b[0m";
const ANSI_HOME = "\u001b[H";
const ANSI_HIDE_CURSOR = "\u001b[?25l";

function normalizeIndentGuides(input: RenderEditorAnsiFrameInput["indentGuides"]) {
  return {
    render: input?.render ?? false,
    character: input?.character ?? "│",
    skipLevels: input?.skipLevels ?? 0,
    indentWidth: input?.indentWidth ?? 2
  };
}

function createBlankRow(cols: number, style: CellStyle): Cell[] {
  return Array.from({ length: cols }, () => ({ char: " ", style }));
}

function writeText(row: Cell[], col: number, text: string, style: CellStyle): void {
  const chars = Array.from(text);

  for (let index = 0; index < chars.length; index += 1) {
    const target = col + index;
    if (target < 0 || target >= row.length) {
      continue;
    }

    row[target] = {
      char: chars[index] ?? " ",
      style
    };
  }
}

function fillRange(row: Cell[], col: number, width: number, style: CellStyle): void {
  for (let index = 0; index < width; index += 1) {
    const target = col + index;
    if (target < 0 || target >= row.length) {
      continue;
    }
    row[target] = { ...row[target]!, style };
  }
}

function clearRange(row: Cell[], col: number, width: number, style: CellStyle): void {
  for (let index = 0; index < width; index += 1) {
    const target = col + index;
    if (target < 0 || target >= row.length) {
      continue;
    }
    row[target] = { char: " ", style };
  }
}

function serializeRow(row: Cell[]): string {
  let output = "";
  let previousStyle: CellStyle | null = null;

  for (const cell of row) {
    if (!previousStyle || !styleEquals(previousStyle, cell.style)) {
      output += ansiStyle(cell.style);
      previousStyle = cell.style;
    }
    output += cell.char;
  }

  output += ANSI_RESET;
  return output;
}

function getContentCols(cols: number, lineCount: number): { gutterCols: number; contentCols: number } {
  const digits = Math.max(2, String(Math.max(1, lineCount)).length);
  const gutterCols = digits + 4;
  return {
    gutterCols,
    contentCols: Math.max(1, cols - gutterCols)
  };
}

function writeRuns(row: Cell[], runs: readonly EditorLayoutRun[], theme: ThemeSpec, rowBg: string, offset = 0): void {
  for (const run of runs) {
    writeText(
      row,
      offset + run.col,
      run.text,
      run.part === "status-mode"
        ? styleForStatusMode(theme, run.text)
        : styleForToken(theme, run.token, rowBg, {
            selected: run.selected,
            searchMatch: run.searchMatch,
            currentSearchMatch: run.currentSearchMatch,
            flashTarget: run.flashTarget,
            cursorBlock: run.cursorBlock
          })
    );
  }
}

function buildGutterText(layoutRow: EditorLayoutRow, lineDigits: number): string {
  const marker = layoutRow.diagnosticSeverity ? "•" : " ";
  const lineNumber = layoutRow.isContinuation ? "↪" : String(layoutRow.docLine + 1);
  const diff = layoutRow.deletedLineChange ? "_" : layoutRow.lineChangeKind === "added" ? "+" : layoutRow.lineChangeKind === "modified" ? "~" : " ";
  return `${marker}${lineNumber.padStart(lineDigits, " ")} ${diff} `;
}

function renderDocumentRow(
  row: Cell[],
  layoutRow: EditorLayoutRow,
  theme: ThemeSpec,
  lineDigits: number,
  contentCols: number
): void {
  const rowBg =
    layoutRow.isActive || layoutRow.isJumpHighlighted
      ? resolveThemeColor(theme, "currentLine")
      : resolveThemeColor(theme, "background");
  const gutterText = buildGutterText(layoutRow, lineDigits);

  for (let index = 0; index < Array.from(gutterText).length && index < row.length; index += 1) {
    writeText(row, index, gutterText[index] ?? " ", styleForGutterCell(theme, layoutRow, index, rowBg, gutterText.length));
  }

  writeRuns(row, layoutRow.contentRuns, theme, rowBg, gutterText.length);

  const appendedDiagnostic = [...layoutRow.overlays]
    .reverse()
    .find((overlay) => overlay.kind === "inline-diagnostic");

  if (appendedDiagnostic) {
    const detailPrefix = appendedDiagnostic.row === 1 ? "  └ " : "  ";
    writeText(
      row,
      gutterText.length + Math.max(0, contentCols - Array.from(`${detailPrefix}${appendedDiagnostic.text}`).length),
      `${detailPrefix}${appendedDiagnostic.text}`,
      styleForToken(theme, appendedDiagnostic.token, rowBg, {})
    );
  }

  for (const overlay of layoutRow.overlays) {
    if (overlay.kind !== "flash-hint") {
      continue;
    }

    writeText(
      row,
      gutterText.length + Math.max(0, Math.min(contentCols - 1, overlay.col)),
      overlay.text,
      styleForToken(theme, overlay.token, rowBg, { flashTarget: true })
    );
  }
}

function writeStatusRow(row: Cell[], runs: readonly EditorLayoutRun[], theme: ThemeSpec): void {
  for (const run of runs) {
    const col = run.part === "status-meta" ? Math.max(0, row.length - Array.from(run.text).length) : run.col;

    writeText(
      row,
      col,
      run.text,
      run.part === "status-mode"
        ? styleForStatusMode(theme, run.text)
        : styleForToken(theme, run.token, STATUS_BG, {
            selected: run.selected,
            searchMatch: run.searchMatch,
            currentSearchMatch: run.currentSearchMatch,
            flashTarget: run.flashTarget,
            cursorBlock: run.cursorBlock
          })
    );
  }
}

function writeBottomRow(row: Cell[], runs: readonly EditorLayoutRun[], theme: ThemeSpec): void {
  writeRuns(row, runs, theme, BOTTOM_BG);
}

function overlayPanel(buffer: Cell[][], panel: EditorLayoutPanel, theme: ThemeSpec, bodyRows: number): void {
  const isPickerModal = panel.kind === "picker";
  const modalMargin = 2;
  const modalInnerWidth = Math.max(2, buffer[0]!.length - modalMargin * 2 - 2);
  const modalLeftWidth = Math.max(24, Math.min(48, Math.floor(modalInnerWidth * 0.32)));
  const modalRightWidth = Math.max(12, modalInnerWidth - modalLeftWidth - 2);
  const totalWidth = isPickerModal ? Math.max(4, buffer[0]!.length - modalMargin * 2) : panel.width + 2;
  const totalHeight = isPickerModal ? Math.max(4, bodyRows - modalMargin * 2) : panel.height + 2;

  if (totalWidth > buffer[0]!.length || totalHeight > bodyRows) {
    return;
  }

  const startCol = isPickerModal ? Math.max(0, Math.floor((buffer[0]!.length - totalWidth) / 2)) : Math.max(0, Math.min(buffer[0]!.length - totalWidth, panel.anchor.col));
  const startRow = isPickerModal ? Math.max(0, Math.floor((bodyRows - totalHeight) / 2)) : Math.max(0, Math.min(bodyRows - totalHeight, panel.anchor.row));
  const borderStyle = makeStyle(PANEL_BORDER, PANEL_BG, true);
  const bodyStyle = panel.kind === "tooltip"
    ? styleForToken(theme, "tooltip", PANEL_BG, {})
    : styleForToken(theme, "picker", PANEL_BG, {});
  const pickerListBackground = BOTTOM_BG;
  const pickerPreviewBackground = PANEL_BG;
  const pickerListStyle = makeStyle(resolveThemeColor(theme, "text"), pickerListBackground);
  const pickerPreviewStyle = makeStyle(resolveThemeColor(theme, "text"), pickerPreviewBackground);
  const pickerPreviewTitleStyle = makeStyle(resolveThemeColor(theme, "comment"), pickerPreviewBackground);
  const pickerSelectedStyle = styleForToken(theme, "picker-selected", PANEL_BG, {});

  writeText(buffer[startRow]!, startCol, `┌${"─".repeat(Math.max(0, totalWidth - 2))}┐`, borderStyle);
  writeText(buffer[startRow + totalHeight - 1]!, startCol, `└${"─".repeat(Math.max(0, totalWidth - 2))}┘`, borderStyle);

  for (let rowIndex = startRow + 1; rowIndex < startRow + totalHeight - 1; rowIndex += 1) {
    writeText(buffer[rowIndex]!, startCol, "│", borderStyle);
    clearRange(buffer[rowIndex]!, startCol + 1, totalWidth - 2, bodyStyle);
    writeText(buffer[rowIndex]!, startCol + totalWidth - 1, "│", borderStyle);
  }

  if (isPickerModal) {
    const innerStartCol = startCol + 1;
    const dividerCol = innerStartCol + modalLeftWidth + 1;
    const previewStartCol = dividerCol + 1;
    const queryRuns = panel.rows[0] ?? [];
    const queryRun = queryRuns.find((run) => run.part === "picker-query");
    const countRun = queryRuns.find((run) => run.part === "picker-count");

    for (let rowIndex = startRow + 2; rowIndex < startRow + totalHeight - 1; rowIndex += 1) {
      clearRange(buffer[rowIndex]!, innerStartCol, modalLeftWidth, pickerListStyle);
      writeText(buffer[rowIndex]!, dividerCol, "│", borderStyle);
      clearRange(buffer[rowIndex]!, previewStartCol, modalRightWidth, pickerPreviewStyle);
    }

    if (queryRun) {
      writeText(buffer[startRow + 1]!, innerStartCol, queryRun.text, styleForToken(theme, "picker", PANEL_BG, {}));
    }

    if (countRun) {
      writeText(
        buffer[startRow + 1]!,
        startCol + totalWidth - 1 - countRun.text.length,
        countRun.text,
        styleForToken(theme, "picker", PANEL_BG, {})
      );
    }

    panel.rows.slice(1).forEach((rowRuns, index) => {
      const targetRow = buffer[startRow + 2 + index];
      if (!targetRow || startRow + 2 + index >= startRow + totalHeight - 1) {
        return;
      }

      const itemRun = rowRuns.find((run) => run.part === "picker-item");
      const titleRun = rowRuns.find((run) => run.part === "picker-preview-title");
      const bodyRun = rowRuns.find((run) => run.part === "picker-preview-body");

      if (itemRun) {
        writeText(
          targetRow,
          innerStartCol,
          itemRun.text.padEnd(modalLeftWidth, " ").slice(0, modalLeftWidth),
          itemRun.selectedInPicker ? pickerSelectedStyle : pickerListStyle
        );
      }

      const previewRun = titleRun ?? bodyRun;
      if (previewRun) {
        writeText(
          targetRow,
          previewStartCol,
          previewRun.text.padEnd(modalRightWidth, " ").slice(0, modalRightWidth),
          titleRun ? pickerPreviewTitleStyle : pickerPreviewStyle
        );
      }
    });

    return;
  }

  panel.rows.forEach((rowRuns, index) => {
    const targetRow = buffer[startRow + 1 + index];
    if (!targetRow) {
      return;
    }
    writeRuns(targetRow, rowRuns, theme, PANEL_BG, startCol + 1);
  });
}

function findTerminalCursor(layout: EditorLayoutModel, state: EditorState): { row: number; col: number; shape: "beam" | "block" } | null {
  for (let rowIndex = 0; rowIndex < layout.document.rows.length; rowIndex += 1) {
    const row = layout.document.rows[rowIndex]!;
    const gutterCols = buildGutterText(row, Math.max(2, String(row.docLine + 1).length)).length;

    if (state.mode === "insert") {
      const overlay = row.overlays.find((entry) => entry.kind === "cursor-line");
      if (overlay) {
        return {
          row: rowIndex + 1,
          col: gutterCols + Math.max(0, overlay.col) + 1,
          shape: "beam"
        };
      }
      continue;
    }

    for (const run of row.contentRuns) {
      if (run.cursorBlock) {
        return {
          row: rowIndex + 1,
          col: gutterCols + run.col + 1,
          shape: "block"
        };
      }
    }
  }

  return null;
}

export function renderEditorAnsiFrame(input: RenderEditorAnsiFrameInput): string {
  const theme = input.theme ?? defaultTheme;
  const cols = Math.max(1, input.cols);
  const rows = Math.max(2, input.rows);
  const bodyRows = Math.max(1, rows - 2);
  const lineDigits = Math.max(2, String(Math.max(1, input.state.doc.lineCount)).length);
  const { contentCols } = getContentCols(cols, input.state.doc.lineCount);
  const layout = buildEditorLayout({
    state: input.state,
    presentation: input.presentation,
    hoverAnchor: { col: 0, row: 0 },
    indentGuides: normalizeIndentGuides(input.indentGuides)
  });
  const background = resolveThemeColor(theme, "background");
  const buffer = Array.from({ length: rows }, () =>
    createBlankRow(cols, makeStyle(resolveThemeColor(theme, "text"), background))
  );

  for (let index = 0; index < bodyRows; index += 1) {
    const targetRow = buffer[index]!;
    const layoutRow = layout.document.rows[index];

    fillRange(targetRow, 0, cols, makeStyle(resolveThemeColor(theme, "text"), background));

    if (layoutRow) {
      renderDocumentRow(targetRow, layoutRow, theme, lineDigits, contentCols);
      continue;
    }

    const fillerStyle = styleForThemeRole(theme, "gutter", background);
    writeText(targetRow, 0, index === 0 ? "~" : " ", fillerStyle);
  }

  for (const panel of layout.panels) {
    overlayPanel(buffer, panel, theme, bodyRows);
  }

  fillRange(buffer[rows - 2]!, 0, cols, makeStyle(resolveThemeColor(theme, "text"), STATUS_BG));
  writeStatusRow(buffer[rows - 2]!, layout.statusBar, theme);
  fillRange(buffer[rows - 1]!, 0, cols, makeStyle(resolveThemeColor(theme, "text"), BOTTOM_BG));
  writeBottomRow(buffer[rows - 1]!, layout.bottomBar.runs, theme);

  const terminalCursor =
    input.presentation.ui.picker.active && input.presentation.ui.picker.variant === "modal"
      ? null
      : findTerminalCursor(layout, input.state);
  const cursorSequence = terminalCursor
    ? `\u001b[${terminalCursor.row};${terminalCursor.col}H${terminalCursor.shape === "beam" ? "\u001b[6 q" : "\u001b[2 q"}\u001b[?25h`
    : ANSI_HIDE_CURSOR;

  return `${ANSI_HIDE_CURSOR}${ANSI_HOME}${buffer.map(serializeRow).join("\n")}${ANSI_RESET}${cursorSequence}`;
}
