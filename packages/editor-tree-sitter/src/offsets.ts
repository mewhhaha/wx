import type { TreeEditPosition } from "./incrementalEdits";

const encoder = new TextEncoder();

export function clampUtf16Offset(text: string, offset: number): number {
  return Math.max(0, Math.min(offset, text.length));
}

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

export function utf16OffsetToUtf8ByteOffset(text: string, offset: number): number {
  const safeOffset = clampUtf16Offset(text, offset);
  let utf16Offset = 0;
  let byteOffset = 0;

  for (const character of text) {
    const nextUtf16Offset = utf16Offset + character.length;

    if (nextUtf16Offset > safeOffset) {
      break;
    }

    byteOffset += utf8ByteLength(character);
    utf16Offset = nextUtf16Offset;
  }

  return byteOffset;
}

export function utf8ByteOffsetToUtf16Offset(text: string, offset: number): number {
  const safeOffset = Math.max(0, offset);
  let utf16Offset = 0;
  let byteOffset = 0;

  for (const character of text) {
    const nextByteOffset = byteOffset + utf8ByteLength(character);

    if (nextByteOffset > safeOffset) {
      break;
    }

    byteOffset = nextByteOffset;
    utf16Offset += character.length;
  }

  return utf16Offset;
}

export function positionAtUtf16Offset(text: string, offset: number): TreeEditPosition {
  const safeOffset = clampUtf16Offset(text, offset);
  let utf16Offset = 0;
  let row = 0;
  let column = 0;

  for (const character of text) {
    const nextUtf16Offset = utf16Offset + character.length;

    if (nextUtf16Offset > safeOffset) {
      break;
    }

    if (character === "\n") {
      row += 1;
      column = 0;
    } else {
      column += utf8ByteLength(character);
    }

    utf16Offset = nextUtf16Offset;
  }

  return { row, column };
}

export function advanceUtf8Position(position: TreeEditPosition, inserted: string): TreeEditPosition {
  let row = position.row;
  let column = position.column;

  for (const character of inserted) {
    if (character === "\n") {
      row += 1;
      column = 0;
    } else {
      column += utf8ByteLength(character);
    }
  }

  return { row, column };
}

export function utf8ByteRangeToUtf16Range(text: string, range: { from: number; to: number }): { from: number; to: number } {
  return {
    from: utf8ByteOffsetToUtf16Offset(text, range.from),
    to: utf8ByteOffsetToUtf16Offset(text, range.to)
  };
}
