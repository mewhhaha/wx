import type { ThemeSpec } from "./index";

// Mapped from ~/.config/helix/themes/pornhub_hc.toml for wx demos.
export const phTheme: ThemeSpec = {
  name: "ph",
  colors: {
    background: "#080808",
    comment: "#6f6f6f",
    currentLine: "#111111",
    cursor: "#ff9000",
    cursorText: "#080808",
    diagnosticError: "#ff6b6b",
    diagnosticHint: "#7a7a7a",
    diagnosticInfo: "#6ecbff",
    diagnosticWarning: "#ffd166",
    function: "#ff9000",
    gutter: "#6f6f6f",
    keyword: "#ff6b6b",
    number: "#ff9000",
    operator: "#959595",
    punctuation: "#959595",
    selection: "#6a3a08",
    string: "#7ee787",
    text: "#ffffff",
    type: "#6ecbff"
  }
};

export const graphiteTheme: ThemeSpec = {
  name: "graphite",
  colors: {
    background: "#131416",
    comment: "#7f8794",
    currentLine: "#1c1f24",
    cursor: "#f2efe6",
    cursorText: "#131416",
    diagnosticError: "#ff7a90",
    diagnosticHint: "#7f8794",
    diagnosticInfo: "#7dd3fc",
    diagnosticWarning: "#ffd166",
    function: "#f6c177",
    gutter: "#6b7280",
    keyword: "#8ccf7e",
    number: "#f6c177",
    operator: "#f2efe6",
    punctuation: "#cbd5e1",
    selection: "#38414f",
    string: "#93c5fd",
    text: "#f2efe6",
    type: "#c4b5fd"
  }
};

export const mintTheme: ThemeSpec = {
  name: "mint",
  colors: {
    background: "#061311",
    comment: "#5f8b82",
    currentLine: "#0c1b18",
    cursor: "#c8fff4",
    cursorText: "#061311",
    diagnosticError: "#ff7a90",
    diagnosticHint: "#7aa39a",
    diagnosticInfo: "#7dd3fc",
    diagnosticWarning: "#f9c74f",
    function: "#6ee7b7",
    gutter: "#5f8b82",
    keyword: "#7dd3fc",
    number: "#f9c74f",
    operator: "#c8fff4",
    punctuation: "#b8f2e6",
    selection: "#144b44",
    string: "#86efac",
    text: "#e6fff8",
    type: "#c4b5fd"
  }
};

export const playgroundThemes = [phTheme, graphiteTheme, mintTheme];
