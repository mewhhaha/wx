import type { EditorState } from "@mewhhaha/wx-core";
import type { EditorWorkspacePresentationState } from "@mewhhaha/wx-controller";
import {
  buildEditorLayout,
  buildEditorWorkspaceLayout,
  getEditorFilePickerPresentation,
  type EditorLayoutModel,
  type EditorLayoutPickerItemState,
  type EditorLayoutPanel,
  type EditorLayoutRow,
  type EditorLayoutRun,
  type EditorWorkspaceLayoutPane
} from "@mewhhaha/wx-layout";
import { defaultTheme, resolveThemeColor, type ThemeSpec } from "@mewhhaha/wx-theme";

import { graphemeCellWidth, terminalGraphemes, terminalTextWidth, truncateTerminalText } from "./cell-width";
import { serializeAnsiFrameSnapshot } from "./damage";
import type { AnsiFrameSnapshot, RenderEditorAnsiFrameInput } from "./terminal-types";
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

function clearOccupiedCell(row: Cell[], col: number): void {
  const cell = row[col];
  if (!cell) return;
  if (cell.continuation && col > 0) {
    const previous = row[col - 1];
    if (previous) row[col - 1] = { char: " ", style: previous.style };
  } else if (row[col + 1]?.continuation) {
    const continuation = row[col + 1]!;
    row[col + 1] = { char: " ", style: continuation.style };
  }
}

function writeText(row: Cell[], col: number, text: string, style: CellStyle): void {
  let target = col;
  for (const grapheme of terminalGraphemes(text)) {
    if (grapheme === "\t") {
      const tabWidth = 8 - (Math.max(0, target) % 8);
      for (let index = 0; index < tabWidth; index += 1) {
        if (target >= 0 && target < row.length) {
          clearOccupiedCell(row, target);
          row[target] = { char: " ", style };
        }
        target += 1;
      }
      continue;
    }

    const width = graphemeCellWidth(grapheme);
    if (width === 0) {
      const previous = row[target - 1];
      if (previous && !previous.continuation) previous.char += grapheme;
      continue;
    }
    if (target < 0) {
      target += width;
      continue;
    }
    if (target >= row.length || (width === 2 && target + 1 >= row.length)) break;

    clearOccupiedCell(row, target);
    if (width === 2) clearOccupiedCell(row, target + 1);
    row[target] = { char: grapheme, style };
    if (width === 2) row[target + 1] = { char: "", style, continuation: true };
    target += width;
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

function findLastPathSeparator(value: string): number {
  return Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
}

function truncatePanelText(value: string, width: number): string {
  if (terminalTextWidth(value) <= width) {
    return value;
  }

  if (width <= 1) {
    return truncateTerminalText(value, Math.max(0, width));
  }

  return `${truncateTerminalText(value, width - 1)}…`;
}

function padPanelText(value: string, width: number): string {
  const truncated = truncatePanelText(value, width);
  return `${truncated}${" ".repeat(Math.max(0, width - terminalTextWidth(truncated)))}`;
}

function paintPickerItemText(
  row: Cell[],
  startCol: number,
  width: number,
  text: string,
  theme: ThemeSpec,
  styles: {
    base: CellStyle;
    prefix: CellStyle;
    directory: CellStyle;
    detail: CellStyle;
  }
): void {
  const normalized = padPanelText(text, width);
  const prefix = normalized.slice(0, 2);
  const body = normalized.slice(2).replace(/\s+$/, "");
  const detailMarkerIndex = body.indexOf("  ");
  const label = detailMarkerIndex >= 0 ? body.slice(0, detailMarkerIndex) : body;
  const detail = detailMarkerIndex >= 0 ? body.slice(detailMarkerIndex + 2) : "";
  const pathSeparatorIndex = findLastPathSeparator(label);
  const directoryPart = pathSeparatorIndex >= 0 ? label.slice(0, pathSeparatorIndex + 1) : "";
  const filePart = pathSeparatorIndex >= 0 ? label.slice(pathSeparatorIndex + 1) : label;
  const icon = "• ";

  clearRange(row, startCol, width, styles.base);
  writeText(row, startCol, prefix, styles.prefix);

  let cursorCol = startCol + 2;
  writeText(row, cursorCol, icon, styles.prefix);
  cursorCol += terminalTextWidth(icon, cursorCol);

  const remainingWidth = Math.max(0, width - (cursorCol - startCol));
  const hasDirectory = directoryPart.length > 0;
  const reservedTailWidth = hasDirectory ? Math.min(Math.max(10, Math.floor(remainingWidth * 0.4)), Math.max(0, remainingWidth - 8)) : 0;
  const fileDisplay = truncatePanelText(filePart, Math.max(1, remainingWidth - reservedTailWidth - (hasDirectory ? 2 : 0)));

  writeText(row, cursorCol, fileDisplay, styles.base);
  cursorCol += terminalTextWidth(fileDisplay, cursorCol);

  let tailRemainingWidth = Math.max(0, startCol + width - cursorCol);
  if (directoryPart && tailRemainingWidth > 2) {
    cursorCol += 2;
    tailRemainingWidth = Math.max(0, startCol + width - cursorCol);
    const detailReserve = detail ? Math.min(14, Math.max(0, tailRemainingWidth - 6)) : 0;
    const directoryDisplay = truncatePanelText(directoryPart, Math.max(1, tailRemainingWidth - detailReserve - (detail ? 2 : 0)));
    writeText(row, cursorCol, directoryDisplay, styles.directory);
    cursorCol += terminalTextWidth(directoryDisplay, cursorCol);
    tailRemainingWidth = Math.max(0, startCol + width - cursorCol);
  }

  if (detail && tailRemainingWidth > 2) {
    cursorCol += 2;
    const detailDisplay = truncatePanelText(detail, Math.max(1, startCol + width - cursorCol));
    writeText(row, cursorCol, detailDisplay, styles.detail);
  }
}

function paintFilePickerItem(
  row: Cell[],
  startCol: number,
  width: number,
  item: EditorLayoutPickerItemState,
  styles: {
    icon: CellStyle;
    fileName: CellStyle;
    directory: CellStyle;
  }
): void {
  const presentation = getEditorFilePickerPresentation(item.filePath ?? item.label);
  const prefix = item.selected ? "› " : "  ";
  const iconText = `${presentation.icon} `;

  clearRange(row, startCol, width, styles.fileName);
  writeText(row, startCol, prefix, styles.icon);

  let cursorCol = startCol + terminalTextWidth(prefix, startCol);
  writeText(row, cursorCol, iconText, styles.icon);
  cursorCol += terminalTextWidth(iconText, cursorCol);

  const availableWidth = Math.max(0, startCol + width - cursorCol);
  const directoryBudget = presentation.directory
    ? Math.min(Math.max(14, Math.floor(availableWidth * 0.35)), Math.max(0, availableWidth - 18))
    : 0;
  const fileName = truncatePanelText(
    presentation.fileName,
    Math.max(8, availableWidth - directoryBudget - (presentation.directory ? 2 : 0))
  );

  writeText(row, cursorCol, fileName, styles.fileName);
  cursorCol += terminalTextWidth(fileName, cursorCol);

  if (presentation.directory) {
    cursorCol += 2;
    const directoryWidth = Math.max(0, startCol + width - cursorCol);
    if (directoryWidth > 0) {
      writeText(row, cursorCol, truncatePanelText(presentation.directory, directoryWidth), styles.directory);
    }
  }
}

function filePickerItemFromText(text: string, selected: boolean): EditorLayoutPickerItemState {
  const normalized = text.replace(/\s+$/, "");
  const prefixless = normalized.startsWith("› ") || normalized.startsWith("  ") ? normalized.slice(2) : normalized;
  const detailMarkerIndex = prefixless.indexOf("  ");
  const filePath = detailMarkerIndex >= 0 ? prefixless.slice(0, detailMarkerIndex) : prefixless;

  return {
    kind: "file",
    label: filePath,
    filePath,
    selected
  };
}

function formatPickerPreviewTitle(value: string): string {
  const lastSeparator = findLastPathSeparator(value);
  const basename = lastSeparator >= 0 ? value.slice(lastSeparator + 1) : value;
  return basename ? `# ${basename}` : "# preview";
}

function serializeRow(row: Cell[]): string {
  let output = "";
  let previousStyle: CellStyle | null = null;

  for (const cell of row) {
    if (cell.continuation) continue;
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
  let logicalCol = 0;
  let terminalCol = offset;
  for (const run of runs) {
    if (run.col >= logicalCol) terminalCol += run.col - logicalCol;
    else terminalCol = offset + run.col;
    writeText(
      row,
      terminalCol,
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
    logicalCol = run.col + run.text.length;
    terminalCol += terminalTextWidth(run.text, terminalCol);
  }
}

function terminalColumnForRunPosition(runs: readonly EditorLayoutRun[], position: number, offset = 0): number {
  let logicalCol = 0;
  let terminalCol = offset;
  for (const run of runs) {
    if (run.col > logicalCol) {
      if (position <= run.col) return terminalCol + Math.max(0, position - logicalCol);
      terminalCol += run.col - logicalCol;
    }
    const relative = Math.max(0, Math.min(run.text.length, position - run.col));
    if (position <= run.col + run.text.length) {
      return terminalCol + terminalTextWidth(run.text.slice(0, relative), terminalCol);
    }
    terminalCol += terminalTextWidth(run.text, terminalCol);
    logicalCol = run.col + run.text.length;
  }
  return terminalCol + Math.max(0, position - logicalCol);
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
      gutterText.length + Math.max(0, contentCols - terminalTextWidth(`${detailPrefix}${appendedDiagnostic.text}`)),
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
      Math.min(
        gutterText.length + contentCols - 1,
        terminalColumnForRunPosition(layoutRow.contentRuns, Math.max(0, overlay.col), gutterText.length)
      ),
      overlay.text,
      styleForToken(theme, overlay.token, rowBg, { flashTarget: true })
    );
  }
}

function writeStatusRow(row: Cell[], runs: readonly EditorLayoutRun[], theme: ThemeSpec): void {
  for (const run of runs) {
    const col = run.part === "status-meta" ? Math.max(0, row.length - terminalTextWidth(run.text)) : run.col;

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
  const isPickerPanel = panel.kind === "picker";
  const isPickerModal = isPickerPanel && panel.variant === "modal";
  const isPickerCombo = isPickerPanel && panel.variant === "combo";
  const pickerModalBackground = "#000000";
  const modalMargin = 2;
  const modalInnerWidth = Math.max(2, buffer[0]!.length - modalMargin * 2 - 2);
  const modalLeftWidth = Math.max(24, Math.min(48, Math.floor(modalInnerWidth * 0.32)));
  const modalRightWidth = Math.max(12, modalInnerWidth - modalLeftWidth - 2);
  const totalWidth = isPickerModal ? Math.max(4, buffer[0]!.length - modalMargin * 2) : panel.width + 2;
  const totalHeight = isPickerModal ? Math.max(4, bodyRows - modalMargin * 2) : panel.height + 2;

  if (totalWidth > buffer[0]!.length || totalHeight > bodyRows) {
    return;
  }

  const startCol = isPickerModal || isPickerCombo
    ? Math.max(0, Math.floor((buffer[0]!.length - totalWidth) / 2))
    : Math.max(0, Math.min(buffer[0]!.length - totalWidth, panel.anchor.col));
  const startRow = isPickerModal || isPickerCombo
    ? Math.max(0, Math.floor((bodyRows - totalHeight) / 2))
    : Math.max(0, Math.min(bodyRows - totalHeight, panel.anchor.row));
  const panelBackground = isPickerModal || isPickerCombo ? pickerModalBackground : PANEL_BG;
  const borderStyle = makeStyle(PANEL_BORDER, panelBackground, true);
  const bodyStyle = panel.kind === "tooltip"
    ? styleForToken(theme, "tooltip", panelBackground, {})
    : styleForToken(theme, "picker", panelBackground, {});
  const pickerListBackground = isPickerModal || isPickerCombo ? pickerModalBackground : BOTTOM_BG;
  const pickerPreviewBackground = isPickerModal ? pickerModalBackground : PANEL_BG;
  const pickerListStyle = makeStyle(resolveThemeColor(theme, "text"), pickerListBackground);
  const pickerPreviewStyle = makeStyle(resolveThemeColor(theme, "text"), pickerPreviewBackground);
  const pickerPreviewTitleStyle = makeStyle(resolveThemeColor(theme, "keyword"), pickerPreviewBackground, true);
  const pickerSelectedStyle = makeStyle(resolveThemeColor(theme, "text"), "#232323", true);
  const pickerSelectedPrefixStyle = makeStyle(resolveThemeColor(theme, "keyword"), "#232323", true);
  const pickerSelectedDirectoryStyle = makeStyle("#9ca3af", "#232323");
  const pickerSelectedDetailStyle = makeStyle(resolveThemeColor(theme, "comment"), "#232323");
  const pickerPrefixStyle = makeStyle(resolveThemeColor(theme, "gutter"), pickerListBackground);
  const pickerDirectoryStyle = makeStyle("#5f6673", pickerListBackground);
  const pickerDetailStyle = makeStyle(resolveThemeColor(theme, "comment"), pickerListBackground);
  const pickerCountStyle = makeStyle(resolveThemeColor(theme, "keyword"), panelBackground, true);
  const pickerQueryStyle = makeStyle(resolveThemeColor(theme, "text"), panelBackground);
  const pickerQueryCursorStyle = makeStyle(resolveThemeColor(theme, "keyword"), panelBackground, true);
  const pickerHeaderRuleStyle = makeStyle(resolveThemeColor(theme, "gutter"), panelBackground);

  writeText(buffer[startRow]!, startCol, `┌${"─".repeat(Math.max(0, totalWidth - 2))}┐`, borderStyle);
  writeText(buffer[startRow + totalHeight - 1]!, startCol, `└${"─".repeat(Math.max(0, totalWidth - 2))}┘`, borderStyle);

  for (let rowIndex = startRow + 1; rowIndex < startRow + totalHeight - 1; rowIndex += 1) {
    writeText(buffer[rowIndex]!, startCol, "│", borderStyle);
    clearRange(buffer[rowIndex]!, startCol + 1, totalWidth - 2, bodyStyle);
    writeText(buffer[rowIndex]!, startCol + totalWidth - 1, "│", borderStyle);
  }

  if (isPickerModal) {
    const innerStartCol = startCol + 1;
    const dividerCol = innerStartCol + modalLeftWidth;
    const previewStartCol = dividerCol + 1;
    const headerRow = buffer[startRow + 1]!;
    const underlineRow = buffer[startRow + 2]!;
    const listStartRow = startRow + 3;
    const previewBodyStartRow = startRow + 2;
    const queryRuns = panel.rows[0] ?? [];
    const queryRun = queryRuns.find((run) => run.part === "picker-query");
    const countRun = queryRuns.find((run) => run.part === "picker-count");
    const previewTitleRun = panel.rows[1]?.find((run) => run.part === "picker-preview-title");

    for (let rowIndex = startRow + 1; rowIndex < startRow + totalHeight - 1; rowIndex += 1) {
      clearRange(buffer[rowIndex]!, innerStartCol, modalLeftWidth, pickerListStyle);
      writeText(buffer[rowIndex]!, dividerCol, "│", borderStyle);
      clearRange(buffer[rowIndex]!, previewStartCol, modalRightWidth, pickerPreviewStyle);
    }

    if (queryRun) {
      writeText(headerRow, innerStartCol, queryRun.text, pickerQueryStyle);
      writeText(
        headerRow,
        Math.min(innerStartCol + modalLeftWidth - 1, innerStartCol + terminalTextWidth(queryRun.text, innerStartCol)),
        "│",
        pickerQueryCursorStyle
      );
    }

    if (countRun) {
      writeText(
        headerRow,
        startCol + totalWidth - 1 - terminalTextWidth(countRun.text),
        countRun.text,
        pickerCountStyle
      );
    }

    if (previewTitleRun) {
      writeText(
        headerRow,
        previewStartCol,
        truncatePanelText(formatPickerPreviewTitle(previewTitleRun.text.trim()), modalRightWidth).padEnd(modalRightWidth, " "),
        pickerPreviewTitleStyle
      );
    }

    writeText(underlineRow, innerStartCol, "─".repeat(Math.max(0, modalLeftWidth)), pickerHeaderRuleStyle);

    panel.rows.slice(1).forEach((rowRuns, index) => {
      const targetRow = buffer[listStartRow + index];
      if (!targetRow || listStartRow + index >= startRow + totalHeight - 1) {
        return;
      }

      const itemRun = rowRuns.find((run) => run.part === "picker-item");
      const bodyRun = rowRuns.find((run) => run.part === "picker-preview-body");

      if (itemRun) {
        paintPickerItemText(
          targetRow,
          innerStartCol,
          modalLeftWidth,
          itemRun.text,
          theme,
          itemRun.selectedInPicker
            ? {
                base: pickerSelectedStyle,
                prefix: pickerSelectedPrefixStyle,
                directory: pickerSelectedDirectoryStyle,
                detail: pickerSelectedDetailStyle
              }
            : {
                base: pickerListStyle,
                prefix: pickerPrefixStyle,
                directory: pickerDirectoryStyle,
                detail: pickerDetailStyle
              }
        );
      }

      const previewTargetRow = buffer[previewBodyStartRow + Math.max(0, index - 1)];
      if (bodyRun && previewTargetRow) {
        writeText(
          previewTargetRow,
          previewStartCol,
          truncatePanelText(bodyRun.text, modalRightWidth).padEnd(modalRightWidth, " ").slice(0, modalRightWidth),
          pickerPreviewStyle
        );
      }
    });

    return;
  }

  if (isPickerCombo) {
    const innerStartCol = startCol + 1;
    const headerRow = buffer[startRow + 1]!;
    const underlineRow = buffer[startRow + 2]!;
    const listStartRow = startRow + 3;
    const queryRuns = panel.rows[0] ?? [];
    const queryRun = queryRuns.find((run) => run.part === "picker-query");
    const countRun = queryRuns.find((run) => run.part === "picker-count");

    for (let rowIndex = startRow + 1; rowIndex < startRow + totalHeight - 1; rowIndex += 1) {
      clearRange(buffer[rowIndex]!, innerStartCol, panel.width, pickerListStyle);
    }

    if (queryRun) {
      const queryText = truncatePanelText(queryRun.text, Math.max(0, panel.width - terminalTextWidth(countRun?.text ?? "") - 2));
      writeText(headerRow, innerStartCol, queryText, pickerQueryStyle);
      writeText(
        headerRow,
        Math.min(innerStartCol + panel.width - 1, innerStartCol + terminalTextWidth(queryText, innerStartCol)),
        "│",
        pickerQueryCursorStyle
      );
    }

    if (countRun) {
      writeText(
        headerRow,
        startCol + totalWidth - 1 - terminalTextWidth(countRun.text),
        countRun.text,
        pickerCountStyle
      );
    }

    writeText(underlineRow, innerStartCol, "─".repeat(Math.max(0, panel.width)), pickerHeaderRuleStyle);

    panel.rows.slice(1).forEach((rowRuns, index) => {
      const targetRow = buffer[listStartRow + index];
      if (!targetRow || listStartRow + index >= startRow + totalHeight - 1) {
        return;
      }

      const itemRun = rowRuns.find((run) => run.part === "picker-item");
      if (!itemRun) {
        writeRuns(targetRow, rowRuns, theme, panelBackground, innerStartCol);
        return;
      }

      const pickerItem = panel.pickerItems?.[index];
      const fileItem =
        pickerItem?.kind === "file" && pickerItem.filePath
          ? pickerItem
          : filePickerItemFromText(itemRun.text, !!itemRun.selectedInPicker);
      if (fileItem.filePath) {
        paintFilePickerItem(targetRow, innerStartCol, panel.width, fileItem, {
          icon: itemRun.selectedInPicker ? pickerSelectedPrefixStyle : pickerPrefixStyle,
          fileName: itemRun.selectedInPicker ? pickerSelectedStyle : pickerListStyle,
          directory: itemRun.selectedInPicker ? pickerSelectedDirectoryStyle : pickerDirectoryStyle
        });
        return;
      }

      paintPickerItemText(targetRow, innerStartCol, panel.width, itemRun.text, theme, itemRun.selectedInPicker
        ? {
            base: pickerSelectedStyle,
            prefix: pickerSelectedPrefixStyle,
            directory: pickerSelectedDirectoryStyle,
            detail: pickerSelectedDetailStyle
          }
        : {
            base: pickerListStyle,
            prefix: pickerPrefixStyle,
            directory: pickerDirectoryStyle,
            detail: pickerDetailStyle
          });
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
          col: terminalColumnForRunPosition(row.contentRuns, Math.max(0, overlay.col), gutterCols) + 1,
          shape: "beam"
        };
      }
      continue;
    }

    for (const run of row.contentRuns) {
      if (run.cursorBlock) {
        return {
          row: rowIndex + 1,
          col: terminalColumnForRunPosition(row.contentRuns, run.col, gutterCols) + 1,
          shape: "block"
        };
      }
    }
  }

  return null;
}

function renderLayoutIntoBuffer(
  buffer: Cell[][],
  layout: EditorLayoutModel,
  state: EditorState,
  theme: ThemeSpec,
  rect: { col: number; row: number; cols: number; rows: number }
): void {
  const background = resolveThemeColor(theme, "background");
  const bodyRows = Math.max(1, rect.rows - 2);
  const lineDigits = Math.max(2, String(Math.max(1, state.doc.lineCount)).length);
  const { contentCols } = getContentCols(rect.cols, state.doc.lineCount);

  for (let index = 0; index < bodyRows; index += 1) {
    const targetRow = buffer[rect.row + index];
    if (!targetRow) {
      continue;
    }

    const layoutRow = layout.document.rows[index];
    clearRange(targetRow, rect.col, rect.cols, makeStyle(resolveThemeColor(theme, "text"), background));

    if (layoutRow) {
      const slice = createBlankRow(rect.cols, makeStyle(resolveThemeColor(theme, "text"), background));
      renderDocumentRow(slice, layoutRow, theme, lineDigits, contentCols);
      for (let column = 0; column < rect.cols; column += 1) {
        const cell = slice[column];
        if (cell) {
          targetRow[rect.col + column] = cell;
        }
      }
      continue;
    }

    const fillerStyle = styleForThemeRole(theme, "gutter", background);
    writeText(targetRow, rect.col, index === 0 ? "~" : " ", fillerStyle);
  }

  const statusRow = buffer[rect.row + rect.rows - 2];
  const bottomRow = buffer[rect.row + rect.rows - 1];
  if (statusRow) {
    fillRange(statusRow, rect.col, rect.cols, makeStyle(resolveThemeColor(theme, "text"), STATUS_BG));
    const slice = createBlankRow(rect.cols, makeStyle(resolveThemeColor(theme, "text"), STATUS_BG));
    writeStatusRow(slice, layout.statusBar, theme);
    for (let column = 0; column < rect.cols; column += 1) {
      const cell = slice[column];
      if (cell) {
        statusRow[rect.col + column] = cell;
      }
    }
  }

  if (bottomRow) {
    fillRange(bottomRow, rect.col, rect.cols, makeStyle(resolveThemeColor(theme, "text"), BOTTOM_BG));
    const slice = createBlankRow(rect.cols, makeStyle(resolveThemeColor(theme, "text"), BOTTOM_BG));
    writeBottomRow(slice, layout.bottomBar.runs, theme);
    for (let column = 0; column < rect.cols; column += 1) {
      const cell = slice[column];
      if (cell) {
        bottomRow[rect.col + column] = cell;
      }
    }
  }
}

function findWorkspaceCursor(
  pane: EditorWorkspaceLayoutPane,
  state: EditorState
): { row: number; col: number; shape: "beam" | "block" } | null {
  const cursor = findTerminalCursor(pane.layout, state);
  if (!cursor) {
    return null;
  }

  return {
    row: pane.rect.row + cursor.row,
    col: pane.rect.col + cursor.col,
    shape: cursor.shape
  };
}

export function createEditorAnsiWorkspaceFrameSnapshot(input: {
  workspace: EditorWorkspacePresentationState;
  theme?: ThemeSpec;
  cols: number;
  rows: number;
  indentGuides?: RenderEditorAnsiFrameInput["indentGuides"];
}): AnsiFrameSnapshot {
  const theme = input.theme ?? defaultTheme;
  const cols = Math.max(1, input.cols);
  const rows = Math.max(2, input.rows);
  const background = resolveThemeColor(theme, "background");
  const buffer = Array.from({ length: rows }, () =>
    createBlankRow(cols, makeStyle(resolveThemeColor(theme, "text"), background))
  );
  const workspaceLayout = buildEditorWorkspaceLayout({
    cols,
    rows,
    activePaneId: input.workspace.activePaneId,
    layoutTree: input.workspace.layoutTree,
    panes: input.workspace.panes.map((pane) => ({
      paneId: pane.paneId,
      active: pane.active,
      state: pane.state,
      presentation: pane.presentation,
      hoverAnchor: { col: 0, row: 0 }
    })),
    indentGuides: normalizeIndentGuides(input.indentGuides)
  });

  for (const pane of workspaceLayout.panes) {
    renderLayoutIntoBuffer(buffer, pane.layout, input.workspace.panes.find((entry) => entry.paneId === pane.paneId)!.state, theme, pane.rect);
  }

  for (const divider of workspaceLayout.dividers) {
    if (divider.axis === "vertical") {
      for (let row = divider.row; row < Math.min(rows, divider.row + divider.length); row += 1) {
        writeText(buffer[row]!, divider.col, "│", makeStyle(resolveThemeColor(theme, "gutter"), background));
      }
      continue;
    }

    writeText(buffer[divider.row]!, divider.col, "─".repeat(Math.max(1, divider.length)), makeStyle(resolveThemeColor(theme, "gutter"), background));
  }

  const activePane = workspaceLayout.panes.find((pane) => pane.active);
  const activeSnapshot = input.workspace.panes.find((pane) => pane.paneId === activePane?.paneId) ?? null;
  if (activePane && activeSnapshot) {
    for (const panel of activePane.layout.panels) {
      overlayPanel(
        buffer,
        {
          ...panel,
          anchor: {
            col: panel.anchor.col + activePane.rect.col,
            row: panel.anchor.row + activePane.rect.row
          }
        },
        theme,
        rows - 2
      );
    }
  }

  const terminalCursor =
    activePane && activeSnapshot && !activeSnapshot.presentation.ui.picker.active
      ? findWorkspaceCursor(activePane, activeSnapshot.state)
      : null;

  return { cols, rows, serializedRows: buffer.map(serializeRow), cursor: terminalCursor };
}

export function renderEditorAnsiWorkspaceFrame(input: {
  workspace: EditorWorkspacePresentationState;
  theme?: ThemeSpec;
  cols: number;
  rows: number;
  indentGuides?: RenderEditorAnsiFrameInput["indentGuides"];
}): string {
  return serializeAnsiFrameSnapshot(createEditorAnsiWorkspaceFrameSnapshot(input));
}

export function createEditorAnsiFrameSnapshot(input: RenderEditorAnsiFrameInput): AnsiFrameSnapshot {
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
    input.presentation.ui.picker.active && input.presentation.ui.picker.variant !== "bar"
      ? null
      : findTerminalCursor(layout, input.state);

  return { cols, rows, serializedRows: buffer.map(serializeRow), cursor: terminalCursor };
}

export function renderEditorAnsiFrame(input: RenderEditorAnsiFrameInput): string {
  return serializeAnsiFrameSnapshot(createEditorAnsiFrameSnapshot(input));
}
