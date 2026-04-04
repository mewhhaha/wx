import { describe, expect, it } from "vitest";

import { createThemeVariables, defaultTheme, resolveThemeColor } from "./index";

describe("theme utilities", () => {
  it("falls back to default role colors", () => {
    expect(resolveThemeColor({ name: "x", colors: {} }, "keyword")).toBe(defaultTheme.colors.keyword);
  });

  it("creates css variables", () => {
    const variables = createThemeVariables(defaultTheme);
    expect(variables["--wx-color-text"]).toBe(defaultTheme.colors.text);
    expect(variables["--wx-color-comment"]).toBe(defaultTheme.colors.comment);
    expect(variables["--wx-color-cursor-text"]).toBe(defaultTheme.colors.cursorText);
    expect(variables["--wx-color-diagnostic-error"]).toBe(defaultTheme.colors.diagnosticError);
  });
});
