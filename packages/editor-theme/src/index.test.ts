import { describe, expect, it } from "vitest";

import { createThemeVariables, defaultTheme, resolveThemeColor } from "./index";

describe("theme utilities", () => {
  it("falls back to default role colors", () => {
    expect(resolveThemeColor({ name: "x", colors: {} }, "keyword")).toBe(defaultTheme.colors.keyword);
  });

  it("creates css variables", () => {
    const variables = createThemeVariables(defaultTheme);
    expect(variables["--whx-color-text"]).toBe(defaultTheme.colors.text);
    expect(variables["--whx-color-comment"]).toBe(defaultTheme.colors.comment);
    expect(variables["--whx-color-cursor-text"]).toBe(defaultTheme.colors.cursorText);
  });
});
