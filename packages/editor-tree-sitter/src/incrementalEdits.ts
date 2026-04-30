import { mapOffsetThroughChanges, type TextChange } from "@mewhhaha/wx-core";

import {
  advanceUtf8Position,
  clampUtf16Offset,
  positionAtUtf16Offset,
  utf16OffsetToUtf8ByteOffset,
  utf8ByteLength
} from "./offsets";

export interface TreeEditPosition {
  row: number;
  column: number;
}

export interface TreeEdit {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: TreeEditPosition;
  oldEndPosition: TreeEditPosition;
  newEndPosition: TreeEditPosition;
}

export function positionAtOffset(text: string, offset: number): TreeEditPosition {
  return positionAtUtf16Offset(text, offset);
}

export function advancePosition(position: TreeEditPosition, inserted: string): TreeEditPosition {
  return advanceUtf8Position(position, inserted);
}

export function buildTreeEdit(text: string, change: TextChange): TreeEdit {
  const from = clampUtf16Offset(text, change.from);
  const to = clampUtf16Offset(text, change.to);
  const startIndex = utf16OffsetToUtf8ByteOffset(text, from);
  const oldEndIndex = utf16OffsetToUtf8ByteOffset(text, to);
  const startPosition = positionAtOffset(text, from);
  const oldEndPosition = positionAtOffset(text, to);
  const newEndPosition = advancePosition(startPosition, change.insert);

  return {
    startIndex,
    oldEndIndex,
    newEndIndex: startIndex + utf8ByteLength(change.insert),
    startPosition,
    oldEndPosition,
    newEndPosition
  };
}

export function applyTextChange(text: string, change: TextChange): string {
  const from = clampUtf16Offset(text, change.from);
  const to = clampUtf16Offset(text, change.to);
  return `${text.slice(0, from)}${change.insert}${text.slice(to)}`;
}

export function rebaseTextChanges(changes: readonly TextChange[]): TextChange[] {
  const sorted = [...changes].sort((left, right) => left.from - right.from || left.to - right.to);
  const rebased: TextChange[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const change = sorted[index]!;
    const previous = sorted.slice(0, index);

    rebased.push({
      from: mapOffsetThroughChanges(change.from, previous, "left"),
      to: mapOffsetThroughChanges(change.to, previous, "right"),
      insert: change.insert
    });
  }

  return rebased;
}
