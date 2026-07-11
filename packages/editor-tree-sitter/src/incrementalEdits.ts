import { mapOffsetThroughChanges, type TextChange } from "@mewhhaha/wx-core";

import { clampUtf16Offset } from "./offsets";

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

export interface TreeEditOffsetIndex {
  utf16ToUtf8(offset: number): number;
  positionAt(offset: number): TreeEditPosition;
}

export function positionAtOffset(text: string, offset: number): TreeEditPosition {
  const safeOffset = clampUtf16Offset(text, offset);
  const lineStart = text.lastIndexOf("\n", Math.max(0, safeOffset - 1)) + 1;
  return { row: text.slice(0, lineStart).split("\n").length - 1, column: safeOffset - lineStart };
}

export function advancePosition(position: TreeEditPosition, inserted: string): TreeEditPosition {
  const lastNewline = inserted.lastIndexOf("\n");
  return lastNewline < 0
    ? { row: position.row, column: position.column + inserted.length }
    : { row: position.row + inserted.split("\n").length - 1, column: inserted.length - lastNewline - 1 };
}

export function buildTreeEdit(text: string, change: TextChange, index?: TreeEditOffsetIndex): TreeEdit {
  const from = clampUtf16Offset(text, change.from);
  const to = clampUtf16Offset(text, change.to);
  // web-tree-sitter exposes JS string (UTF-16) indexes and point columns.
  // Keep the worker protocol in that coordinate space; the cached index is
  // still used to find rows without rescanning the document.
  const startIndex = from;
  const oldEndIndex = to;
  const startPosition = index?.positionAt(from) ?? positionAtOffset(text, from);
  const oldEndPosition = index?.positionAt(to) ?? positionAtOffset(text, to);
  const newEndPosition = advancePosition(startPosition, change.insert);

  return {
    startIndex,
    oldEndIndex,
    newEndIndex: startIndex + change.insert.length,
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
