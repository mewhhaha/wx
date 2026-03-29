import type { HighlightRole } from "@whx/editor-language";

export type ThemeRole = HighlightRole | "background" | "currentLine" | "cursorText";

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
  name: "whx-daybreak",
  colors: roleFallbacks
};

export function resolveThemeColor(theme: ThemeSpec, role: ThemeRole): string {
  return theme.colors[role] ?? roleFallbacks[role];
}

export function createThemeVariables(theme: ThemeSpec): Record<string, string> {
  return {
    "--whx-color-background": resolveThemeColor(theme, "background"),
    "--whx-color-comment": resolveThemeColor(theme, "comment"),
    "--whx-color-current-line": resolveThemeColor(theme, "currentLine"),
    "--whx-color-cursor": resolveThemeColor(theme, "cursor"),
    "--whx-color-cursor-text": resolveThemeColor(theme, "cursorText"),
    "--whx-color-function": resolveThemeColor(theme, "function"),
    "--whx-color-gutter": resolveThemeColor(theme, "gutter"),
    "--whx-color-keyword": resolveThemeColor(theme, "keyword"),
    "--whx-color-number": resolveThemeColor(theme, "number"),
    "--whx-color-operator": resolveThemeColor(theme, "operator"),
    "--whx-color-punctuation": resolveThemeColor(theme, "punctuation"),
    "--whx-color-selection": resolveThemeColor(theme, "selection"),
    "--whx-color-string": resolveThemeColor(theme, "string"),
    "--whx-color-text": resolveThemeColor(theme, "text"),
    "--whx-color-type": resolveThemeColor(theme, "type")
  };
}
