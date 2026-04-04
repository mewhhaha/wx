import { mapOffsetThroughChanges, type TextChange } from "@wx/editor-core";

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

function clampOffset(text: string, offset: number): number {
  return Math.max(0, Math.min(offset, text.length));
}

export function positionAtOffset(text: string, offset: number): TreeEditPosition {
  const safeOffset = clampOffset(text, offset);
  let row = 0;
  let column = 0;

  for (let index = 0; index < safeOffset; index += 1) {
    if (text[index] === "\n") {
      row += 1;
      column = 0;
      continue;
    }

    column += 1;
  }

  return { row, column };
}

export function advancePosition(position: TreeEditPosition, inserted: string): TreeEditPosition {
  let row = position.row;
  let column = position.column;

  for (const character of inserted) {
    if (character === "\n") {
      row += 1;
      column = 0;
      continue;
    }

    column += 1;
  }

  return { row, column };
}

export function buildTreeEdit(text: string, change: TextChange): TreeEdit {
  const from = clampOffset(text, change.from);
  const to = clampOffset(text, change.to);
  const startPosition = positionAtOffset(text, from);
  const oldEndPosition = positionAtOffset(text, to);
  const newEndPosition = advancePosition(startPosition, change.insert);

  return {
    startIndex: from,
    oldEndIndex: to,
    newEndIndex: from + change.insert.length,
    startPosition,
    oldEndPosition,
    newEndPosition
  };
}

export function applyTextChange(text: string, change: TextChange): string {
  const from = clampOffset(text, change.from);
  const to = clampOffset(text, change.to);
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
