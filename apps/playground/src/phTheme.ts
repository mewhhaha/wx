import type { ThemeSpec } from "@wx/editor-theme";

// Mapped from ~/.config/helix/themes/pornhub_hc.toml for the playground demo.
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
    diagnosticWarning: "#ffb347",
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
