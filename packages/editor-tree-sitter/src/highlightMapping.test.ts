import { describe, expect, it } from "vitest";

import { mapCaptureNameToRole } from "./highlightMapping";

describe("mapCaptureNameToRole", () => {
  it("maps dotted tree-sitter captures to semantic highlight roles", () => {
    expect(mapCaptureNameToRole("function.method")).toBe("function");
    expect(mapCaptureNameToRole("keyword")).toBe("keyword");
    expect(mapCaptureNameToRole("punctuation.bracket")).toBe("punctuation");
    expect(mapCaptureNameToRole("string.special")).toBe("string");
    expect(mapCaptureNameToRole("type.builtin")).toBe("type");
    expect(mapCaptureNameToRole("constructor")).toBe("type");
    expect(mapCaptureNameToRole("constant.numeric")).toBe("number");
  });

  it("falls back to text for unmapped captures", () => {
    expect(mapCaptureNameToRole("variable.parameter")).toBe("text");
    expect(mapCaptureNameToRole("property")).toBe("text");
  });
});
