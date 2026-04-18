import { resolveThemeColor, type ThemeRole, type ThemeSpec } from "@wx/editor-theme";
import type { EditorLayoutRow, EditorLayoutRun } from "@wx/editor-layout";

export interface CellStyle {
  fg: string;
  bg: string;
  bold: boolean;
}

export interface Cell {
  char: string;
  style: CellStyle;
}

export const SEARCH_MATCH_BG = "#5b4b00";
export const CURRENT_SEARCH_BG = "#a16207";
export const FLASH_TARGET_BG = "#be123c";
export const STATUS_BG = "#0b0d12";
export const BOTTOM_BG = "#11141b";
export const PANEL_BG = "#0f172a";
export const PANEL_BORDER = "#94a3b8";

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

export function ansiStyle(style: CellStyle): string {
  const [fgR, fgG, fgB] = parseHexColor(style.fg);
  const [bgR, bgG, bgB] = parseHexColor(style.bg);
  return `\u001b[${style.bold ? "1;" : ""}38;2;${fgR};${fgG};${fgB};48;2;${bgR};${bgG};${bgB}m`;
}

export function styleEquals(left: CellStyle, right: CellStyle): boolean {
  return left.fg === right.fg && left.bg === right.bg && left.bold === right.bold;
}

export function makeStyle(fg: string, bg: string, bold = false): CellStyle {
  return { fg, bg, bold };
}

export function styleForThemeRole(theme: ThemeSpec, role: ThemeRole, background?: string, bold = false): CellStyle {
  return makeStyle(resolveThemeColor(theme, role), background ?? resolveThemeColor(theme, "background"), bold);
}

export function styleForStatusMode(theme: ThemeSpec, label: string): CellStyle {
  const mode = label.trim();

  if (mode === "INS") {
    return makeStyle(resolveThemeColor(theme, "background"), resolveThemeColor(theme, "string"), true);
  }

  if (mode === "VIS") {
    return makeStyle(resolveThemeColor(theme, "background"), resolveThemeColor(theme, "keyword"), true);
  }

  if (mode === "JMP") {
    return makeStyle(resolveThemeColor(theme, "background"), resolveThemeColor(theme, "type"), true);
  }

  return makeStyle(resolveThemeColor(theme, "cursorText"), resolveThemeColor(theme, "cursor"), true);
}

export function styleForToken(
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
    case "bottom":
      return makeStyle(resolveThemeColor(theme, "text"), BOTTOM_BG);
    case "bottom-prompt":
      return makeStyle(resolveThemeColor(theme, "keyword"), BOTTOM_BG, true);
    case "picker":
      return makeStyle(resolveThemeColor(theme, "text"), rowBg);
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

export function styleForGutterCell(
  theme: ThemeSpec,
  layoutRow: EditorLayoutRow,
  index: number,
  rowBg: string,
  gutterTextLength: number
): CellStyle {
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

  if (index === gutterTextLength - 2) {
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

  if (layoutRow.isActive || layoutRow.isJumpHighlighted) {
    return styleForThemeRole(theme, "text", rowBg, index > 0 && index < gutterTextLength - 1);
  }

  return styleForThemeRole(theme, "gutter", rowBg);
}
