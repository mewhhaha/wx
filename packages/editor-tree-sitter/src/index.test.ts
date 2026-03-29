import { describe, expect, it } from "vitest";

import { typescriptHighlightQuery } from "./highlightQuery";

describe("tree-sitter query", () => {
  it("includes key syntax captures for the demo language", () => {
    expect(typescriptHighlightQuery).toContain("@keyword");
    expect(typescriptHighlightQuery).toContain("@string");
    expect(typescriptHighlightQuery).toContain("@comment");
    expect(typescriptHighlightQuery).toContain("@function.method");
    expect(typescriptHighlightQuery).toContain("@punctuation.bracket");
    expect(typescriptHighlightQuery).toContain("@type.builtin");
  });
});
