import { type EditorState } from "../../editor-core/src/index";
import {
  createEditorController,
  type EditorController,
  type EditorPresentationState
} from "../../editor-controller/src/index";
import {
  buildEditorLayout,
  type EditorLayoutModel,
  type EditorLayoutPanel,
  type EditorLayoutRow,
  type EditorLayoutRun
} from "../../editor-layout/src/index";
import {
  defaultTheme,
  resolveThemeColor,
  type ThemeRole,
  type ThemeSpec
} from "../../editor-theme/src/index";

export interface RenderEditorAnsiFrameInput {
  state: EditorState;
  presentation: EditorPresentationState;
  theme?: ThemeSpec;
  cols: number;
  rows: number;
  indentGuides?: {
    render?: boolean;
    character?: string;
    skipLevels?: number;
    indentWidth?: number;
  };
}

export interface CreateAnsiEditorMirrorOptions {
  controller?: EditorController;
  value?: string;
  write(text: string): void;
  theme?: ThemeSpec;
  cols: number;
  rows: number;
  enterAltScreen?: boolean;
  indentGuides?: {
    render?: boolean;
    character?: string;
    skipLevels?: number;
    indentWidth?: number;
  };
}

export interface AnsiEditorMirror {
  mount(): void;
  destroy(): void;
  resize(viewport: { cols: number; rows: number }): void;
  setTheme(theme: ThemeSpec): void;
  renderNow(): void;
}

export interface AnsiTerminalInput {
  isTTY?: boolean;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off?(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener?(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  resume(): void;
  pause?(): void;
  setEncoding?(encoding: BufferEncoding): void;
  setRawMode?(mode: boolean): void;
}

export interface AnsiTerminalOutput {
  columns?: number;
  rows?: number;
  on?(event: "resize", listener: () => void): unknown;
  off?(event: "resize", listener: () => void): unknown;
  removeListener?(event: "resize", listener: () => void): unknown;
}

export interface CreateAnsiEditorTerminalOptions extends CreateAnsiEditorMirrorOptions {
  input: AnsiTerminalInput;
  output?: AnsiTerminalOutput;
  availableThemes?: readonly ThemeSpec[];
  exit?(code?: number): void;
}

export interface AnsiEditorTerminal extends AnsiEditorMirror {}

interface CellStyle {
  fg: string;
  bg: string;
  bold: boolean;
}

interface Cell {
  char: string;
  style: CellStyle;
}

const ANSI_RESET = "\u001b[0m";
const ANSI_HOME = "\u001b[H";
const ANSI_ENTER_ALT = "\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l";
const ANSI_EXIT_ALT = "\u001b[0m\u001b[?25h\u001b[?1049l";
const SEARCH_MATCH_BG = "#5b4b00";
const CURRENT_SEARCH_BG = "#a16207";
const FLASH_TARGET_BG = "#be123c";
const STATUS_BG = "#0b0d12";
const BOTTOM_BG = "#11141b";
const PANEL_BG = "#0f172a";
const PANEL_BORDER = "#94a3b8";

function normalizeIndentGuides(input: RenderEditorAnsiFrameInput["indentGuides"]) {
  return {
    render: input?.render ?? false,
    character: input?.character ?? "│",
    skipLevels: input?.skipLevels ?? 0,
    indentWidth: input?.indentWidth ?? 2
  };
}

function removeListener<T extends (...args: never[]) => void>(
  target: { off?(event: string, listener: T): unknown; removeListener?(event: string, listener: T): unknown },
  event: string,
  listener: T
): void {
  if (target.off) {
    target.off(event, listener);
    return;
  }

  if (target.removeListener) {
    target.removeListener(event, listener);
  }
}

function parseAnsiInput(chunk: Buffer | string): string[] {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const keys: string[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const slice = text.slice(index);

    if (slice.startsWith("\u001b[A")) {
      keys.push("ArrowUp");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[B")) {
      keys.push("ArrowDown");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[C")) {
      keys.push("ArrowRight");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[D")) {
      keys.push("ArrowLeft");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[H") || slice.startsWith("\u001bOH")) {
      keys.push("Home");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[F") || slice.startsWith("\u001bOF")) {
      keys.push("End");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[5~")) {
      keys.push("PageUp");
      index += 3;
      continue;
    }

    if (slice.startsWith("\u001b[6~")) {
      keys.push("PageDown");
      index += 3;
      continue;
    }

    if (slice.startsWith("\u001b[3~")) {
      keys.push("Delete");
      index += 3;
      continue;
    }

    const char = text[index] ?? "";
    const code = char.charCodeAt(0);

    if (char === "\u001b") {
      keys.push("Escape");
      continue;
    }

    if (char === "\r" || char === "\n") {
      keys.push("Enter");
      continue;
    }

    if (char === "\t") {
      keys.push("Tab");
      continue;
    }

    if (char === "\u007f") {
      keys.push("Backspace");
      continue;
    }

    if (code >= 1 && code <= 26) {
      keys.push(`Ctrl+${String.fromCharCode(96 + code)}`);
      continue;
    }

    if (char) {
      keys.push(char);
    }
  }

  return keys;
}

function parseHexColor(color: string): [number, number, number] {
  const normalized = color.trim();

  if (/^#[0-9a-f]{3}$/i.test(normalized)) {
    return [
      Number.parseInt(normalized[1] + normalized[1], 16),
      Number.parseInt(normalized[2] + normalized[2], 16),
      Number.parseInt(normalized[3] + normalized[3], 16)
    ];
  }

  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return [
      Number.parseInt(normalized.slice(1, 3), 16),
      Number.parseInt(normalized.slice(3, 5), 16),
      Number.parseInt(normalized.slice(5, 7), 16)
    ];
  }

  return [255, 255, 255];
}

function ansiStyle(style: CellStyle): string {
  const [fgR, fgG, fgB] = parseHexColor(style.fg);
  const [bgR, bgG, bgB] = parseHexColor(style.bg);
  return `\u001b[${style.bold ? "1;" : ""}38;2;${fgR};${fgG};${fgB};48;2;${bgR};${bgG};${bgB}m`;
}

function styleEquals(left: CellStyle, right: CellStyle): boolean {
  return left.fg === right.fg && left.bg === right.bg && left.bold === right.bold;
}

function makeStyle(fg: string, bg: string, bold = false): CellStyle {
  return { fg, bg, bold };
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

function styleForThemeRole(theme: ThemeSpec, role: ThemeRole, background?: string, bold = false): CellStyle {
  return makeStyle(resolveThemeColor(theme, role), background ?? resolveThemeColor(theme, "background"), bold);
}

function styleForToken(
  theme: ThemeSpec,
  token: EditorLayoutRun["token"],
  rowBg: string,
  flags: { selected?: boolean; searchMatch?: boolean; currentSearchMatch?: boolean; flashTarget?: boolean; cursorBlock?: boolean }
): CellStyle {
  if (flags.cursorBlock) {
    return makeStyle(resolveThemeColor(theme, "cursorText"), resolveThemeColor(theme, "cursor"), true);
  }

  if (flags.flashTarget) {
    return makeStyle("#fff7ed", FLASH_TARGET_BG, true);
  }

  if (flags.currentSearchMatch) {
    return makeStyle(resolveThemeColor(theme, "text"), CURRENT_SEARCH_BG, true);
  }

  if (flags.searchMatch) {
    return makeStyle(resolveThemeColor(theme, "text"), SEARCH_MATCH_BG);
  }

  if (flags.selected) {
    return makeStyle(resolveThemeColor(theme, "text"), resolveThemeColor(theme, "selection"));
  }

  switch (token) {
    case "comment":
    case "function":
    case "gutter":
    case "keyword":
    case "number":
    case "operator":
    case "punctuation":
    case "string":
    case "text":
    case "type":
    case "cursor":
      return styleForThemeRole(theme, token === "cursor" ? "text" : token, rowBg);
    case "diagnostic-error":
      return styleForThemeRole(theme, "diagnosticError", rowBg, true);
    case "diagnostic-warning":
      return styleForThemeRole(theme, "diagnosticWarning", rowBg, true);
    case "diagnostic-info":
      return styleForThemeRole(theme, "diagnosticInfo", rowBg, true);
    case "diagnostic-hint":
      return styleForThemeRole(theme, "diagnosticHint", rowBg);
    case "status":
      return makeStyle(resolveThemeColor(theme, "text"), STATUS_BG);
    case "status-mode":
      return makeStyle(resolveThemeColor(theme, "cursorText"), resolveThemeColor(theme, "cursor"), true);
    case "bottom":
      return makeStyle(resolveThemeColor(theme, "text"), BOTTOM_BG);
    case "bottom-prompt":
      return makeStyle(resolveThemeColor(theme, "keyword"), BOTTOM_BG, true);
    case "picker":
      return makeStyle(resolveThemeColor(theme, "text"), BOTTOM_BG);
    case "picker-selected":
      return makeStyle(resolveThemeColor(theme, "cursorText"), resolveThemeColor(theme, "cursor"), true);
    case "tooltip":
      return makeStyle(resolveThemeColor(theme, "text"), PANEL_BG);
    case "tooltip-source":
      return makeStyle(resolveThemeColor(theme, "comment"), PANEL_BG);
    case "selection":
      return makeStyle(resolveThemeColor(theme, "text"), resolveThemeColor(theme, "selection"));
    case "search-match":
      return makeStyle(resolveThemeColor(theme, "text"), SEARCH_MATCH_BG);
    case "search-current":
      return makeStyle(resolveThemeColor(theme, "text"), CURRENT_SEARCH_BG, true);
    case "flash-target":
      return makeStyle("#fff7ed", FLASH_TARGET_BG, true);
    default:
      return makeStyle(resolveThemeColor(theme, "text"), rowBg);
  }
}

function writeRuns(row: Cell[], runs: readonly EditorLayoutRun[], theme: ThemeSpec, rowBg: string, offset = 0): void {
  for (const run of runs) {
    writeText(
      row,
      offset + run.col,
      run.text,
      styleForToken(theme, run.token, rowBg, {
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

function styleForGutterCell(theme: ThemeSpec, layoutRow: EditorLayoutRow, index: number, rowBg: string): CellStyle {
  if (index === 0 && layoutRow.diagnosticSeverity) {
    const role =
      layoutRow.diagnosticSeverity === "error"
        ? "diagnosticError"
        : layoutRow.diagnosticSeverity === "warning"
          ? "diagnosticWarning"
          : layoutRow.diagnosticSeverity === "info"
            ? "diagnosticInfo"
            : "diagnosticHint";
    return styleForThemeRole(theme, role, rowBg, true);
  }

  if (index === buildGutterText(layoutRow, Math.max(2, String(layoutRow.docLine + 1).length)).length - 2) {
    if (layoutRow.deletedLineChange) {
      return styleForThemeRole(theme, "diagnosticError", rowBg, true);
    }
    if (layoutRow.lineChangeKind === "added") {
      return styleForThemeRole(theme, "string", rowBg, true);
    }
    if (layoutRow.lineChangeKind === "modified") {
      return styleForThemeRole(theme, "keyword", rowBg, true);
    }
  }

  return styleForThemeRole(theme, "gutter", rowBg);
}

function renderDocumentRow(
  row: Cell[],
  layoutRow: EditorLayoutRow,
  theme: ThemeSpec,
  lineDigits: number,
  contentCols: number
): void {
  const rowBg = layoutRow.isActive ? resolveThemeColor(theme, "currentLine") : resolveThemeColor(theme, "background");
  const gutterText = buildGutterText(layoutRow, lineDigits);

  for (let index = 0; index < Array.from(gutterText).length && index < row.length; index += 1) {
    writeText(row, index, gutterText[index] ?? " ", styleForGutterCell(theme, layoutRow, index, rowBg));
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

  const cursorLine = layoutRow.overlays.find((overlay) => overlay.kind === "cursor-line");
  if (cursorLine) {
    writeText(
      row,
      gutterText.length + Math.max(0, Math.min(contentCols - 1, cursorLine.col)),
      "│",
      makeStyle(resolveThemeColor(theme, "cursor"), rowBg, true)
    );
  }
}

function writeStatusRow(row: Cell[], runs: readonly EditorLayoutRun[], theme: ThemeSpec): void {
  writeRuns(row, runs, theme, STATUS_BG);
}

function writeBottomRow(row: Cell[], runs: readonly EditorLayoutRun[], theme: ThemeSpec): void {
  writeRuns(row, runs, theme, BOTTOM_BG);
}

function overlayPanel(buffer: Cell[][], panel: EditorLayoutPanel, theme: ThemeSpec, bodyRows: number): void {
  const totalWidth = panel.width + 2;
  const totalHeight = panel.height + 2;

  if (totalWidth > buffer[0]!.length || totalHeight > bodyRows) {
    return;
  }

  const startCol = Math.max(0, Math.min(buffer[0]!.length - totalWidth, panel.anchor.col));
  const startRow = Math.max(0, Math.min(bodyRows - totalHeight, panel.anchor.row));
  const borderStyle = makeStyle(PANEL_BORDER, PANEL_BG, true);
  const bodyStyle = panel.kind === "tooltip"
    ? styleForToken(theme, "tooltip", PANEL_BG, {})
    : styleForToken(theme, "picker", PANEL_BG, {});

  writeText(buffer[startRow]!, startCol, `┌${"─".repeat(Math.max(0, totalWidth - 2))}┐`, borderStyle);
  writeText(buffer[startRow + totalHeight - 1]!, startCol, `└${"─".repeat(Math.max(0, totalWidth - 2))}┘`, borderStyle);

  for (let rowIndex = startRow + 1; rowIndex < startRow + totalHeight - 1; rowIndex += 1) {
    writeText(buffer[rowIndex]!, startCol, "│", borderStyle);
    fillRange(buffer[rowIndex]!, startCol + 1, totalWidth - 2, bodyStyle);
    writeText(buffer[rowIndex]!, startCol + totalWidth - 1, "│", borderStyle);
  }

  panel.rows.forEach((rowRuns, index) => {
    const targetRow = buffer[startRow + 1 + index];
    if (!targetRow) {
      return;
    }
    writeRuns(targetRow, rowRuns, theme, PANEL_BG, startCol + 1);
  });
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

  const panel = layout.panels[0];
  if (panel) {
    overlayPanel(buffer, panel, theme, bodyRows);
  }

  fillRange(buffer[rows - 2]!, 0, cols, makeStyle(resolveThemeColor(theme, "text"), STATUS_BG));
  writeStatusRow(buffer[rows - 2]!, layout.statusBar, theme);
  fillRange(buffer[rows - 1]!, 0, cols, makeStyle(resolveThemeColor(theme, "text"), BOTTOM_BG));
  writeBottomRow(buffer[rows - 1]!, layout.bottomBar.runs, theme);

  return `${ANSI_HOME}${buffer.map(serializeRow).join("\n")}${ANSI_RESET}`;
}

export function createAnsiEditorMirror(options: CreateAnsiEditorMirrorOptions): AnsiEditorMirror {
  const controller = options.controller ?? createEditorController({ value: options.value ?? "" });
  const write = options.write;
  const indentGuides = normalizeIndentGuides(options.indentGuides);
  let theme = options.theme ?? defaultTheme;
  let cols = Math.max(1, options.cols);
  let rows = Math.max(2, options.rows);
  let mounted = false;
  let pendingRender = false;
  let unsubscribe = () => {};

  const syncViewportMetrics = () => {
    const { contentCols } = getContentCols(cols, controller.getState().doc.lineCount);
    controller.setViewportMetrics({
      visibleRowCapacity: Math.max(1, rows - 2),
      wrapColumns: contentCols,
      softWrap: controller.getPresentationState().viewport.softWrap
    });
  };

  const renderNow = () => {
    if (!mounted) {
      return;
    }

    write(
      renderEditorAnsiFrame({
        state: controller.getState(),
        presentation: controller.getPresentationState(),
        theme,
        cols,
        rows,
        indentGuides
      })
    );
  };

  const scheduleRender = () => {
    if (!mounted || pendingRender) {
      return;
    }

    pendingRender = true;
    queueMicrotask(() => {
      pendingRender = false;
      renderNow();
    });
  };

  return {
    mount() {
      if (mounted) {
        return;
      }

      mounted = true;
      if (options.enterAltScreen ?? true) {
        write(ANSI_ENTER_ALT);
      } else {
        write("\u001b[?25l");
      }
      syncViewportMetrics();
      unsubscribe = controller.subscribe(() => {
        scheduleRender();
      });
      renderNow();
    },
    destroy() {
      if (!mounted) {
        return;
      }

      mounted = false;
      pendingRender = false;
      unsubscribe();
      unsubscribe = () => {};
      if (options.enterAltScreen ?? true) {
        write(ANSI_EXIT_ALT);
      } else {
        write("\u001b[0m\u001b[?25h");
      }
    },
    resize(nextViewport) {
      cols = Math.max(1, nextViewport.cols);
      rows = Math.max(2, nextViewport.rows);
      syncViewportMetrics();
      scheduleRender();
    },
    setTheme(nextTheme) {
      theme = nextTheme;
      scheduleRender();
    },
    renderNow
  };
}

export function createAnsiEditorTerminal(options: CreateAnsiEditorTerminalOptions): AnsiEditorTerminal {
  const controller = options.controller ?? createEditorController({ value: options.value ?? "" });
  const mirror = createAnsiEditorMirror({
    ...options,
    controller
  });
  const input = options.input;
  const output = options.output;
  const availableThemes = options.availableThemes?.length ? [...options.availableThemes] : [options.theme ?? defaultTheme];
  const exit = options.exit ?? (() => {});
  let mounted = false;
  let destroyed = false;
  let keyQueue = Promise.resolve();

  const syncBottomMessage = (message: EditorPresentationState["ui"]["bottomMessage"]) => {
    controller.updatePresentationState((presentation) => {
      presentation.ui.bottomMessage = message;
    }, "ansi.bottom-message", { defer: true });
  };

  const handleKey = async (key: string) => {
    if (destroyed) {
      return;
    }

    if (key === "Ctrl+c") {
      destroy();
      exit(0);
      return;
    }

    if (key === "Ctrl+l") {
      mirror.renderNow();
      return;
    }
    const ctrl = key.startsWith("Ctrl+");
    const normalizedKey = ctrl ? key.slice(5) : key;
    const result = await controller.handleKeyInput(
      {
        key: normalizedKey,
        ctrl,
        shift: normalizedKey.length === 1 && normalizedKey !== normalizedKey.toLowerCase(),
        source: "ansi",
        text: normalizedKey.length === 1 ? normalizedKey : undefined
      },
      {
        themeNames: availableThemes.map((entry) => entry.name)
      }
    );

    const presentation = controller.getPresentationState();
    const effectiveThemeName = presentation.ui.previewTheme ?? result.themeName ?? presentation.themeName;
    if (effectiveThemeName) {
      const nextTheme = availableThemes.find((entry) => entry.name === effectiveThemeName);
      if (nextTheme) {
        mirror.setTheme(nextTheme);
      }
    }

    if (result.quit) {
      destroy();
      exit(0);
    }
  };

  const handleData = (chunk: Buffer | string) => {
    for (const key of parseAnsiInput(chunk)) {
      keyQueue = keyQueue.then(() => handleKey(key));
    }
  };

  const handleResize = () => {
    if (!output) {
      return;
    }

    mirror.resize({
      cols: Math.max(1, output.columns ?? 80),
      rows: Math.max(2, output.rows ?? 24)
    });
  };

  const mount = () => {
    if (mounted) {
      return;
    }

    mounted = true;
    destroyed = false;
    mirror.mount();
    input.setEncoding?.("utf8");
    input.setRawMode?.(true);
    input.resume();
    input.on("data", handleData);
    output?.on?.("resize", handleResize);
    syncBottomMessage({ tone: "info", text: "Ctrl+C or :q to quit" });
  };

  const destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    mounted = false;
    removeListener(input, "data", handleData);
    removeListener(output ?? {}, "resize", handleResize);
    input.setRawMode?.(false);
    input.pause?.();
    mirror.destroy();
  };

  return {
    mount,
    destroy,
    resize(viewport) {
      mirror.resize(viewport);
    },
    setTheme(theme) {
      mirror.setTheme(theme);
      controller.setThemeName(theme.name);
    },
    renderNow() {
      mirror.renderNow();
    }
  };
}

export async function runAnsiMirrorDemo(): Promise<void> {
  const sample = [
    "fn smooth_union(a: f32, b: f32, k: f32) -> f32 {",
    "  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);",
    "  return mix(b, a, h) - k * h * (1.0 - h);",
    "}",
    "",
    "@fragment",
    "fn fs_main() -> @location(0) vec4f {",
    "  return vec4f(1.0, 0.4, 0.1, 1.0);",
    "}"
  ].join("\n");

  const controller = createEditorController({ value: sample });
  controller.setFilePath("examples/demo.wgsl");
  const terminal = createAnsiEditorTerminal({
    controller,
    input: process.stdin,
    output: process.stdout,
    write: (text) => process.stdout.write(text),
    theme: defaultTheme,
    cols: process.stdout.columns ?? 100,
    rows: process.stdout.rows ?? 28,
    enterAltScreen: true,
    indentGuides: {
      render: true,
      character: "│",
      skipLevels: 1,
      indentWidth: 2
    },
    exit: (code = 0) => process.exit(code)
  });
  terminal.mount();
}
