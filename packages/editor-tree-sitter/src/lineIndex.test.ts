import { describe, expect, it } from "vitest";

import { IncrementalLineIndex } from "./lineIndex";
import { utf16OffsetToUtf8ByteOffset, utf8ByteOffsetToUtf16Offset } from "./offsets";

describe("incremental line index", () => {
  it("stays equivalent to a full rebuild across unicode and multiline edits", () => {
    const index = new IncrementalLineIndex("alpha\né😀ta\ngamma\ndelta");
    const changes = [
      { from: 7, to: 9, insert: "β\n新" },
      { from: 0, to: 5, insert: "a" },
      { from: 12, to: 12, insert: "\nlast" },
      { from: 2, to: 8, insert: "joined" }
    ] as const;

    for (const change of changes) {
      const text = index.applyChange(change);
      const rebuilt = new IncrementalLineIndex(text);
      expect(index.utf16Starts).toEqual(rebuilt.utf16Starts);
      expect(index.utf8Starts).toEqual(rebuilt.utf8Starts);
      for (let offset = 0; offset <= text.length; offset += 1) {
        expect(index.utf16ToUtf8(offset)).toBe(utf16OffsetToUtf8ByteOffset(text, offset));
      }
      const byteLength = index.utf16ToUtf8(text.length);
      for (let offset = 0; offset <= byteLength; offset += 1) {
        expect(index.utf8ToUtf16(offset)).toBe(utf8ByteOffsetToUtf16Offset(text, offset));
      }
    }
  });

  it("looks up a viewport without rescanning the document", () => {
    const text = Array.from({ length: 10_000 }, (_, line) => `line ${line}`).join("\n");
    const index = new IncrementalLineIndex(text);
    const scannedBefore = index.scannedCodeUnits;
    expect(index.viewportBounds({ fromLine: 9_990, toLine: 9_995 })).toEqual({
      from: index.utf16Starts[9_990],
      to: index.utf16Starts[9_996]! - 1
    });
    expect(index.scannedCodeUnits).toBe(scannedBefore);
  });

  it("rescans only touched lines for a middle-of-document edit", () => {
    const text = Array.from({ length: 10_000 }, (_, line) => `line ${line}`).join("\n");
    const index = new IncrementalLineIndex(text);
    const before = index.scannedCodeUnits;
    const from = index.utf16Starts[5_000]! + 2;
    index.applyChange({ from, to: from + 1, insert: "XYZ" });
    expect(index.scannedCodeUnits - before).toBeLessThan(40);
  });
});
