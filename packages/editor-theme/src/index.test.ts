import { describe, expect, it } from "vitest";

import { defaultTheme, graphiteTheme, mintTheme, normalizeCommandThemes, phTheme, playgroundThemes } from "./index";

describe("@mewhhaha/wx-theme", () => {
  it("dedupes command themes and keeps active theme first", () => {
    expect(normalizeCommandThemes([defaultTheme, phTheme, mintTheme, phTheme], phTheme)).toEqual([
      phTheme,
      defaultTheme,
      mintTheme
    ]);
  });

  it("falls back to active and default themes when no extra themes passed", () => {
    expect(normalizeCommandThemes(undefined, mintTheme)).toEqual([mintTheme, defaultTheme]);
  });

  it("re-exports demo theme presets from the root barrel", () => {
    expect(phTheme.name).toBe("ph");
    expect(graphiteTheme.name).toBe("graphite");
    expect(playgroundThemes).toEqual([phTheme, graphiteTheme, mintTheme]);
  });
});
