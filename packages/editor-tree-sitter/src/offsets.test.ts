import { describe, expect, it } from "vitest";

import { utf16OffsetToUtf8ByteOffset, utf8ByteOffsetToUtf16Offset, utf8ByteRangeToUtf16Range } from "./offsets";

describe("tree-sitter offset conversions", () => {
  it("maps UTF-16 offsets to UTF-8 byte offsets", () => {
    const source = "aéα\n😀x";

    expect(utf16OffsetToUtf8ByteOffset(source, 0)).toBe(0);
    expect(utf16OffsetToUtf8ByteOffset(source, 1)).toBe(1);
    expect(utf16OffsetToUtf8ByteOffset(source, 2)).toBe(3);
    expect(utf16OffsetToUtf8ByteOffset(source, 3)).toBe(5);
    expect(utf16OffsetToUtf8ByteOffset(source, 4)).toBe(6);
    expect(utf16OffsetToUtf8ByteOffset(source, 6)).toBe(10);
  });

  it("maps UTF-8 byte ranges back to UTF-16 ranges for highlights", () => {
    const source = "aéα\n😀x";

    expect(utf8ByteOffsetToUtf16Offset(source, 10)).toBe(6);
    expect(utf8ByteRangeToUtf16Range(source, { from: 1, to: 5 })).toEqual({ from: 1, to: 3 });
    expect(utf8ByteRangeToUtf16Range(source, { from: 6, to: 10 })).toEqual({ from: 4, to: 6 });
  });
});
