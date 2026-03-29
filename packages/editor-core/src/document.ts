export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface TextLine {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface TextPosition {
  line: number;
  column: number;
}

export interface TextDocument {
  readonly text: string;
  readonly length: number;
  readonly lineCount: number;
  slice(from: number, to?: number): string;
  lineAt(index: number): TextLine;
  positionAt(offset: number): TextPosition;
  offsetAt(position: TextPosition): number;
  applyChanges(changes: readonly TextChange[]): TextDocument;
}

export type OffsetAffinity = "left" | "right";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildLineStarts(text: string): number[] {
  const lineStarts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  return lineStarts;
}

export class StringTextDocument implements TextDocument {
  readonly text: string;
  readonly length: number;
  readonly lineCount: number;
  private readonly lineStarts: number[];

  constructor(text: string) {
    this.text = text;
    this.length = text.length;
    this.lineStarts = buildLineStarts(text);
    this.lineCount = this.lineStarts.length;
  }

  slice(from: number, to = this.length): string {
    return this.text.slice(clamp(from, 0, this.length), clamp(to, 0, this.length));
  }

  lineAt(index: number): TextLine {
    const safeIndex = clamp(index, 0, this.lineCount - 1);
    const start = this.lineStarts[safeIndex];
    const nextStart = safeIndex + 1 < this.lineCount ? this.lineStarts[safeIndex + 1] : this.length + 1;
    const end = Math.max(start, nextStart - 1);
    return {
      index: safeIndex,
      start,
      end,
      text: this.text.slice(start, end)
    };
  }

  positionAt(offset: number): TextPosition {
    const safeOffset = clamp(offset, 0, this.length);
    let low = 0;
    let high = this.lineStarts.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midStart = this.lineStarts[mid];
      const nextStart = mid + 1 < this.lineStarts.length ? this.lineStarts[mid + 1] : this.length + 1;

      if (safeOffset < midStart) {
        high = mid - 1;
      } else if (safeOffset >= nextStart) {
        low = mid + 1;
      } else {
        return { line: mid, column: safeOffset - midStart };
      }
    }

    return { line: 0, column: safeOffset };
  }

  offsetAt(position: TextPosition): number {
    const line = this.lineAt(position.line);
    return clamp(line.start + position.column, line.start, line.end);
  }

  applyChanges(changes: readonly TextChange[]): TextDocument {
    if (changes.length === 0) {
      return this;
    }

    const sorted = [...changes].sort((left, right) => left.from - right.from);
    let cursor = 0;
    let nextText = "";

    for (const change of sorted) {
      const from = clamp(change.from, 0, this.length);
      const to = clamp(change.to, from, this.length);
      nextText += this.text.slice(cursor, from);
      nextText += change.insert;
      cursor = to;
    }

    nextText += this.text.slice(cursor);
    return new StringTextDocument(nextText);
  }
}

export function createTextDocument(text = ""): TextDocument {
  return new StringTextDocument(text);
}

export function mapOffsetThroughChanges(
  offset: number,
  changes: readonly TextChange[],
  affinity: OffsetAffinity = "left"
): number {
  let mapped = offset;

  for (const change of changes) {
    const removed = change.to - change.from;
    const inserted = change.insert.length;

    if (mapped < change.from || (mapped === change.from && affinity === "left")) {
      continue;
    }

    if (mapped <= change.to) {
      mapped = change.from + inserted;
      continue;
    }

    mapped += inserted - removed;
  }

  return Math.max(0, mapped);
}
