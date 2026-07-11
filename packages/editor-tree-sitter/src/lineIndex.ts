import type { TextChange } from "@mewhhaha/wx-core";

import type { TreeEditPosition } from "./incrementalEdits";

const encoder = new TextEncoder();

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! <= target) low = middle + 1;
    else high = middle;
  }

  return low;
}

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Incremental UTF-16/UTF-8 line starts shared by the browser and Node workers.
 * Edits rescan only the touched logical lines; viewport lookup is a pair of
 * indexed reads and offset conversion scans at most one line.
 */
export class IncrementalLineIndex {
  private utf16Starts_: number[] = [0];
  private utf8Starts_: number[] = [0];
  private text_ = "";
  private scannedCodeUnits_ = 0;

  constructor(text = "") {
    this.reset(text);
  }

  get text(): string { return this.text_; }
  get lineCount(): number { return this.utf16Starts_.length; }
  get scannedCodeUnits(): number { return this.scannedCodeUnits_; }
  get utf16Starts(): readonly number[] { return this.utf16Starts_; }
  get utf8Starts(): readonly number[] { return this.utf8Starts_; }

  reset(text: string): void {
    this.text_ = text;
    this.utf16Starts_ = [0];
    this.utf8Starts_ = [0];
    this.scanLineStarts(text, 0, 0, this.utf16Starts_, this.utf8Starts_);
  }

  lineAtUtf16Offset(offset: number): number {
    const safe = Math.max(0, Math.min(this.text_.length, offset));
    return Math.max(0, upperBound(this.utf16Starts_, safe) - 1);
  }

  lineAtUtf8Offset(offset: number): number {
    const safe = Math.max(0, offset);
    return Math.max(0, upperBound(this.utf8Starts_, safe) - 1);
  }

  utf16ToUtf8(offset: number): number {
    const safe = Math.max(0, Math.min(this.text_.length, offset));
    const line = this.lineAtUtf16Offset(safe);
    const lineStart = this.utf16Starts_[line]!;
    return this.utf8Starts_[line]! + byteLength(this.text_.slice(lineStart, safe));
  }

  utf8ToUtf16(offset: number): number {
    const safe = Math.max(0, offset);
    const line = this.lineAtUtf8Offset(safe);
    const lineByteStart = this.utf8Starts_[line]!;
    const lineUtf16Start = this.utf16Starts_[line]!;
    const targetBytes = safe - lineByteStart;
    let consumedBytes = 0;
    let consumedUtf16 = 0;
    const lineEnd = this.utf16Starts_[line + 1] ?? this.text_.length;

    for (const character of this.text_.slice(lineUtf16Start, lineEnd)) {
      const nextBytes = consumedBytes + byteLength(character);
      if (nextBytes > targetBytes) break;
      consumedBytes = nextBytes;
      consumedUtf16 += character.length;
    }

    return lineUtf16Start + consumedUtf16;
  }

  positionAt(offset: number): TreeEditPosition {
    const safe = Math.max(0, Math.min(this.text_.length, offset));
    const row = this.lineAtUtf16Offset(safe);
    return {
      row,
      column: safe - this.utf16Starts_[row]!
    };
  }

  viewportBounds(lines: { fromLine: number; toLine: number }): { from: number; to: number } {
    const fromLine = Math.max(0, Math.min(this.lineCount - 1, lines.fromLine));
    const toLine = Math.max(fromLine, Math.min(this.lineCount - 1, lines.toLine));
    return {
      from: this.utf16Starts_[fromLine]!,
      to: toLine + 1 < this.lineCount ? this.utf16Starts_[toLine + 1]! - 1 : this.text_.length
    };
  }

  viewportByteBounds(lines: { fromLine: number; toLine: number }): { from: number; to: number } {
    const bounds = this.viewportBounds(lines);
    return { from: this.utf16ToUtf8(bounds.from), to: this.utf16ToUtf8(bounds.to) };
  }

  byteRangeToUtf16(range: { from: number; to: number }): { from: number; to: number } {
    return { from: this.utf8ToUtf16(range.from), to: this.utf8ToUtf16(range.to) };
  }

  applyChange(change: TextChange): string {
    if (
      !Number.isSafeInteger(change.from) ||
      !Number.isSafeInteger(change.to) ||
      change.from < 0 ||
      change.to < change.from ||
      change.to > this.text_.length
    ) {
      throw new RangeError("Tree-sitter incremental edit is outside the current document.");
    }

    const oldText = this.text_;
    const startLine = this.lineAtUtf16Offset(change.from);
    const scanStartUtf16 = this.utf16Starts_[startLine]!;
    const scanStartUtf8 = this.utf8Starts_[startLine]!;
    const resumeLine = upperBound(this.utf16Starts_, change.to);
    const hasResume = resumeLine < this.utf16Starts_.length;
    const oldResumeUtf16 = hasResume ? this.utf16Starts_[resumeLine]! : oldText.length;
    const oldResumeUtf8 = hasResume ? this.utf8Starts_[resumeLine]! : this.utf16ToUtf8(oldText.length);
    const removed = oldText.slice(change.from, change.to);
    const utf16Delta = change.insert.length - removed.length;
    const utf8Delta = byteLength(change.insert) - byteLength(removed);
    const nextText = `${oldText.slice(0, change.from)}${change.insert}${oldText.slice(change.to)}`;
    const nextResumeUtf16 = oldResumeUtf16 + utf16Delta;

    const rescannedUtf16 = [scanStartUtf16];
    const rescannedUtf8 = [scanStartUtf8];
    this.scanLineStarts(
      nextText.slice(scanStartUtf16, nextResumeUtf16),
      scanStartUtf16,
      scanStartUtf8,
      rescannedUtf16,
      rescannedUtf8
    );

    const suffixUtf16 = this.utf16Starts_.slice(hasResume ? resumeLine + 1 : this.utf16Starts_.length)
      .map((offset) => offset + utf16Delta);
    const suffixUtf8 = this.utf8Starts_.slice(hasResume ? resumeLine + 1 : this.utf8Starts_.length)
      .map((offset) => offset + utf8Delta);

    // If the rescan ends at the retained resume boundary it already contains
    // that boundary; otherwise retain it explicitly before the later suffix.
    if (hasResume && rescannedUtf16.at(-1) !== nextResumeUtf16) {
      rescannedUtf16.push(nextResumeUtf16);
      rescannedUtf8.push(oldResumeUtf8 + utf8Delta);
    }

    this.text_ = nextText;
    this.utf16Starts_ = [...this.utf16Starts_.slice(0, startLine), ...rescannedUtf16, ...suffixUtf16];
    this.utf8Starts_ = [...this.utf8Starts_.slice(0, startLine), ...rescannedUtf8, ...suffixUtf8];
    return nextText;
  }

  private scanLineStarts(
    text: string,
    baseUtf16: number,
    baseUtf8: number,
    utf16Starts: number[],
    utf8Starts: number[]
  ): void {
    let utf16 = baseUtf16;
    let utf8 = baseUtf8;
    this.scannedCodeUnits_ += text.length;

    for (const character of text) {
      utf16 += character.length;
      utf8 += byteLength(character);
      if (character === "\n") {
        utf16Starts.push(utf16);
        utf8Starts.push(utf8);
      }
    }
  }
}
