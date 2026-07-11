import { describe, expect, it } from "vitest";

import { graphemeCellWidth, terminalGraphemes, terminalTextWidth } from "./cell-width";

describe("ANSI terminal cell width", () => {
  it.each([
    ["👍🏽", 2],
    ["👩‍💻", 2],
    ["🇵🇱", 2],
    ["1️⃣", 2],
    ["♥️", 2],
    ["e\u0301", 1],
    ["界", 2]
  ])("assigns an independently known width to %s", (value, expectedWidth) => {
    expect(terminalGraphemes(value)).toEqual([value]);
    expect(graphemeCellWidth(value)).toBe(expectedWidth);
    expect(terminalTextWidth(value)).toBe(expectedWidth);
  });

  it("pairs regional indicators without merging adjacent flags", () => {
    expect(terminalGraphemes("🇵🇱🇺🇦")).toEqual(["🇵🇱", "🇺🇦"]);
    expect(terminalTextWidth("🇵🇱🇺🇦")).toBe(4);
  });
});
