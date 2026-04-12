import type { HighlightRole } from "@wx/editor-language";

export type ThemeRole =
  | HighlightRole
  | "background"
  | "currentLine"
  | "cursorText"
  | "diagnosticError"
  | "diagnosticWarning"
  | "diagnosticInfo"
  | "diagnosticHint";

export interface ThemeSpec {
  name: string;
  colors: Partial<Record<ThemeRole, string>>;
}

const roleFallbacks: Record<ThemeRole, string> = {
  background: "#101218",
  comment: "#5e687d",
  currentLine: "#181d27",
  cursor: "#f5f5f5",
  cursorText: "#101218",
  diagnosticError: "#ef4444",
  diagnosticHint: "#94a3b8",
  diagnosticInfo: "#38bdf8",
  diagnosticWarning: "#f59e0b",
  function: "#8bd5ff",
  gutter: "#6f7a90",
  keyword: "#f7b267",
  number: "#f89fb1",
  operator: "#f5f5f5",
  punctuation: "#b7c0d1",
  selection: "#30415f",
  string: "#9ece6a",
  text: "#e8ecf3",
  type: "#7dd3fc"
};

export const defaultTheme: ThemeSpec = {
  name: "wx-daybreak",
  colors: roleFallbacks
};

export function resolveThemeColor(theme: ThemeSpec, role: ThemeRole): string {
  return theme.colors[role] ?? roleFallbacks[role];
}

export function createThemeVariables(theme: ThemeSpec): Record<string, string> {
  return {
    "--wx-color-background": resolveThemeColor(theme, "background"),
    "--wx-color-comment": resolveThemeColor(theme, "comment"),
    "--wx-color-current-line": resolveThemeColor(theme, "currentLine"),
    "--wx-color-cursor": resolveThemeColor(theme, "cursor"),
    "--wx-color-cursor-text": resolveThemeColor(theme, "cursorText"),
    "--wx-color-diagnostic-error": resolveThemeColor(theme, "diagnosticError"),
    "--wx-color-diagnostic-hint": resolveThemeColor(theme, "diagnosticHint"),
    "--wx-color-diagnostic-info": resolveThemeColor(theme, "diagnosticInfo"),
    "--wx-color-diagnostic-warning": resolveThemeColor(theme, "diagnosticWarning"),
    "--wx-color-function": resolveThemeColor(theme, "function"),
    "--wx-color-gutter": resolveThemeColor(theme, "gutter"),
    "--wx-color-keyword": resolveThemeColor(theme, "keyword"),
    "--wx-color-number": resolveThemeColor(theme, "number"),
    "--wx-color-operator": resolveThemeColor(theme, "operator"),
    "--wx-color-punctuation": resolveThemeColor(theme, "punctuation"),
    "--wx-color-selection": resolveThemeColor(theme, "selection"),
    "--wx-color-string": resolveThemeColor(theme, "string"),
    "--wx-color-text": resolveThemeColor(theme, "text"),
    "--wx-color-type": resolveThemeColor(theme, "type")
  };
}

export function normalizeCommandThemes(themes: readonly ThemeSpec[] | undefined, activeTheme: ThemeSpec): ThemeSpec[] {
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

export { graphiteTheme, mintTheme, phTheme, playgroundThemes } from "./presets";
