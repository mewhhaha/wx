import { describe, expect, it } from "vitest";

import { __internal } from "./index";

describe("scene language wasm offset conversions", () => {
  it("maps public UTF-16 offsets to wasm UTF-8 byte offsets", () => {
    const source = "let café = 😀;";

    expect(__internal.utf16OffsetToUtf8ByteOffset(source, source.indexOf("c"))).toBe(4);
    expect(__internal.utf16OffsetToUtf8ByteOffset(source, source.indexOf("😀"))).toBe(12);
    expect(__internal.utf16OffsetToUtf8ByteOffset(source, source.indexOf(";"))).toBe(16);
  });

  it("maps wasm byte ranges back to public UTF-16 ranges", () => {
    const source = "let café = 😀;";

    expect(__internal.convertRangeToUtf16(source, { from: 4, to: 9, role: "text" })).toEqual({
      from: 4,
      to: 8,
      role: "text"
    });
    expect(__internal.convertRangeToUtf16(source, { from: 12, to: 16, role: "text" })).toEqual({
      from: 11,
      to: 13,
      role: "text"
    });
  });

  it("converts action changes before applying them to JS strings", () => {
    const source = "let café = 😀;";
    const actions = __internal.convertActionsToUtf16(source, [
      {
        title: "replace emoji",
        changes: [{ from: 12, to: 16, insert: "ok" }]
      }
    ]);

    expect(actions).toEqual([
      {
        title: "replace emoji",
        changes: [{ from: 11, to: 13, insert: "ok" }]
      }
    ]);
    expect(__internal.applyTextChanges(source, actions[0]!.changes)).toBe("let café = ok;");
  });
});
