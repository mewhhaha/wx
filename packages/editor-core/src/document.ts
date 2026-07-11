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

/**
 * Immutable editor text. Offsets and columns are UTF-16 code-unit offsets, matching
 * JavaScript string indexing. `text` is retained for compatibility but may be lazy.
 */
export interface TextDocument {
  readonly text: string;
  readonly length: number;
  readonly lineCount: number;
  /** Reads one UTF-16 code unit without requiring the whole document string. */
  charAt(offset: number): string;
  slice(from: number, to?: number): string;
  lineAt(index: number): TextLine;
  positionAt(offset: number): TextPosition;
  offsetAt(position: TextPosition): number;
  applyChanges(changes: readonly TextChange[]): TextDocument;
}

/** Deterministic counters for storage tests and non-timing benchmark evidence. */
export interface DocumentStorageStats {
  readonly kind: "string" | "piece-table";
  readonly pieceCount: number;
  readonly sourceBufferCount: number;
  /** Source code units inspected to build newline indexes for the most recent edit. */
  readonly lastEditScannedCodeUnits: number;
  /** Existing pieces visited while applying the most recent edit. */
  readonly lastEditTouchedPieces: number;
  /** Piece descriptors in the resulting revision. */
  readonly lastEditCreatedPieces: number;
  /** Newline-index bytes allocated for inserted text by the most recent edit. */
  readonly lastEditIndexedBytes: number;
  /** Piece descriptor and prefix-index bytes allocated for the resulting revision. */
  readonly lastEditMetadataBytes: number;
  /** Whether compatibility access through `text` has materialized this revision. */
  readonly textMaterialized: boolean;
}

export interface DocumentRetentionStats {
  readonly documentCount: number;
  readonly uniqueSourceBufferCount: number;
  readonly sourceTextBytes: number;
  readonly sourceIndexBytes: number;
  readonly pieceBytes: number;
  readonly documentIndexBytes: number;
  readonly materializedTextBytes: number;
  readonly overheadBytes: number;
  readonly totalBytes: number;
}

export type OffsetAffinity = "left" | "right";

const UTF16_CODE_UNIT_BYTES = 2;
const NUMBER_BYTES = 8;
const SOURCE_OVERHEAD_BYTES = 32;
const PIECE_BYTES = 48;
const DOCUMENT_OVERHEAD_BYTES = 64;
const STRING_DOCUMENT_OVERHEAD_BYTES = 48;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function integer(value: number, fallback = 0): number {
  return Number.isNaN(value) ? fallback : Math.trunc(value);
}

function offset(value: number, length: number): number {
  return integer(clamp(value, 0, length));
}

function lineIndex(value: number, lineCount: number): number {
  return offset(value, Math.max(0, lineCount - 1));
}

function newlineOffsets(text: string): number[] {
  const offsets: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      offsets.push(index);
    }
  }

  return offsets;
}

function lineStarts(text: string): number[] {
  const starts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }

  return starts;
}

function lowerBound(values: readonly number[], target: number, from = 0, to = values.length): number {
  let low = from;
  let high = to;

  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export class StringTextDocument implements TextDocument {
  readonly length: number;
  readonly lineCount: number;
  private readonly starts: readonly number[];

  constructor(readonly text: string) {
    this.length = text.length;
    this.starts = lineStarts(text);
    this.lineCount = this.starts.length;
  }

  charAt(target: number): string {
    const safe = integer(target, -1);
    return safe < 0 || safe >= this.length ? "" : this.text.charAt(safe);
  }

  slice(from: number, to = this.length): string {
    return this.text.slice(offset(from, this.length), offset(to, this.length));
  }

  lineAt(target: number): TextLine {
    const index = lineIndex(target, this.lineCount);
    const start = this.starts[index];
    const nextStart = index + 1 < this.lineCount ? this.starts[index + 1] : this.length + 1;
    const end = Math.max(start, nextStart - 1);
    return { index, start, end, text: this.text.slice(start, end) };
  }

  positionAt(target: number): TextPosition {
    const safe = offset(target, this.length);
    const index = Math.max(0, lowerBound(this.starts, safe + 1) - 1);
    return { line: index, column: safe - this.starts[index] };
  }

  offsetAt(position: TextPosition): number {
    const index = lineIndex(position.line, this.lineCount);
    const start = this.starts[index];
    const nextStart = index + 1 < this.lineCount ? this.starts[index + 1] : this.length + 1;
    const end = Math.max(start, nextStart - 1);
    return integer(clamp(start + integer(position.column), start, end));
  }

  applyChanges(changes: readonly TextChange[]): TextDocument {
    const normalized = normalizeTextChanges(changes, this.length);
    if (normalized.length === 0) {
      return this;
    }

    let cursor = 0;
    let nextText = "";
    for (const change of normalized) {
      nextText += this.text.slice(cursor, change.from);
      nextText += change.insert;
      cursor = change.to;
    }
    nextText += this.text.slice(cursor);
    return new StringTextDocument(nextText);
  }

  /** @internal Used by retention accounting without accessing a lazy `text` getter. */
  retentionStats(): DocumentRetentionStats {
    const sourceTextBytes = this.length * UTF16_CODE_UNIT_BYTES;
    const sourceIndexBytes = this.starts.length * NUMBER_BYTES;
    const overheadBytes = STRING_DOCUMENT_OVERHEAD_BYTES;
    return {
      documentCount: 1,
      uniqueSourceBufferCount: 1,
      sourceTextBytes,
      sourceIndexBytes,
      pieceBytes: 0,
      documentIndexBytes: 0,
      materializedTextBytes: 0,
      overheadBytes,
      totalBytes: sourceTextBytes + sourceIndexBytes + overheadBytes
    };
  }
}

interface SourceBuffer {
  readonly text: string;
  readonly newlines: readonly number[];
}

interface Piece {
  readonly source: SourceBuffer;
  readonly start: number;
  readonly length: number;
  readonly newlineFrom: number;
  readonly newlineTo: number;
}

interface EditStorageCounters {
  readonly scannedCodeUnits: number;
  readonly touchedPieces: number;
  readonly indexedBytes: number;
}

function makeSource(text: string): SourceBuffer {
  return { text, newlines: newlineOffsets(text) };
}

function makePiece(source: SourceBuffer, start: number, length: number): Piece | null {
  if (length <= 0) {
    return null;
  }

  return {
    source,
    start,
    length,
    newlineFrom: lowerBound(source.newlines, start),
    newlineTo: lowerBound(source.newlines, start + length)
  };
}

function coalescePieces(pieces: readonly Piece[]): Piece[] {
  const result: Piece[] = [];

  for (const piece of pieces) {
    const previous = result[result.length - 1];
    if (previous?.source === piece.source && previous.start + previous.length === piece.start) {
      result[result.length - 1] = makePiece(previous.source, previous.start, previous.length + piece.length)!;
    } else {
      result.push(piece);
    }
  }

  return result;
}

/**
 * Immutable flat piece table. Revisions share source buffers and untouched text; only
 * descriptors, prefix indexes, and newline indexes for newly inserted strings are created.
 */
export class PieceTableTextDocument implements TextDocument {
  readonly length: number;
  readonly lineCount: number;
  private readonly pieces: readonly Piece[];
  private readonly pieceEnds: readonly number[];
  private readonly newlineEnds: readonly number[];
  private readonly editCounters: EditStorageCounters;
  private textCache: string | undefined;

  constructor(pieces: readonly Piece[], editCounters: EditStorageCounters) {
    this.pieces = coalescePieces(pieces);
    this.editCounters = editCounters;

    const pieceEnds: number[] = [];
    const newlineEnds: number[] = [];
    let length = 0;
    let newlines = 0;
    for (const piece of this.pieces) {
      length += piece.length;
      newlines += piece.newlineTo - piece.newlineFrom;
      pieceEnds.push(length);
      newlineEnds.push(newlines);
    }

    this.pieceEnds = pieceEnds;
    this.newlineEnds = newlineEnds;
    this.length = length;
    this.lineCount = newlines + 1;
  }

  get text(): string {
    if (this.textCache === undefined) {
      this.textCache = this.slice(0, this.length);
    }
    return this.textCache;
  }

  charAt(target: number): string {
    const safe = integer(target, -1);
    if (safe < 0 || safe >= this.length) {
      return "";
    }

    const pieceIndex = this.pieceIndexAt(safe);
    const piece = this.pieces[pieceIndex];
    const pieceStart = this.pieceDocumentStart(pieceIndex);
    return piece.source.text.charAt(piece.start + safe - pieceStart);
  }

  slice(from: number, to = this.length): string {
    const start = offset(from, this.length);
    const end = offset(to, this.length);
    if (end <= start) {
      return "";
    }

    let pieceIndex = this.pieceIndexAt(start);
    let result = "";
    while (pieceIndex < this.pieces.length) {
      const piece = this.pieces[pieceIndex];
      const pieceStart = this.pieceDocumentStart(pieceIndex);
      const pieceEnd = this.pieceEnds[pieceIndex];
      if (pieceStart >= end) {
        break;
      }

      const localFrom = piece.start + Math.max(0, start - pieceStart);
      const localTo = piece.start + Math.min(piece.length, end - pieceStart);
      result += piece.source.text.slice(localFrom, localTo);
      if (pieceEnd >= end) {
        break;
      }
      pieceIndex += 1;
    }

    return result;
  }

  lineAt(target: number): TextLine {
    const index = lineIndex(target, this.lineCount);
    const start = this.offsetAfterNewlines(index);
    const end = index + 1 === this.lineCount ? this.length : this.offsetAfterNewlines(index + 1) - 1;
    return { index, start, end, text: this.slice(start, end) };
  }

  positionAt(target: number): TextPosition {
    const safe = offset(target, this.length);
    if (safe === this.length) {
      const line = this.lineCount - 1;
      return { line, column: safe - this.offsetAfterNewlines(line) };
    }

    const pieceIndex = this.pieceIndexAt(safe);
    const piece = this.pieces[pieceIndex];
    const pieceStart = this.pieceDocumentStart(pieceIndex);
    const newlinesBeforePiece = pieceIndex === 0 ? 0 : this.newlineEnds[pieceIndex - 1];
    const sourceTarget = piece.start + safe - pieceStart;
    const newlinesInsidePiece =
      lowerBound(piece.source.newlines, sourceTarget, piece.newlineFrom, piece.newlineTo) - piece.newlineFrom;
    const line = newlinesBeforePiece + newlinesInsidePiece;
    return { line, column: safe - this.offsetAfterNewlines(line) };
  }

  offsetAt(position: TextPosition): number {
    const index = lineIndex(position.line, this.lineCount);
    const start = this.offsetAfterNewlines(index);
    const end = index + 1 === this.lineCount ? this.length : this.offsetAfterNewlines(index + 1) - 1;
    return integer(clamp(start + integer(position.column), start, end));
  }

  applyChanges(changes: readonly TextChange[]): TextDocument {
    const normalized = normalizeTextChanges(changes, this.length);
    if (normalized.length === 0) {
      return this;
    }

    const pieces: Piece[] = [];
    const counters = { touchedPieces: 0 };
    let cursor = 0;
    let scannedCodeUnits = 0;
    let indexedBytes = 0;

    for (const change of normalized) {
      this.appendRange(pieces, cursor, change.from, counters);
      if (change.insert.length > 0) {
        const source = makeSource(change.insert);
        const piece = makePiece(source, 0, change.insert.length);
        scannedCodeUnits += change.insert.length;
        indexedBytes += source.newlines.length * NUMBER_BYTES;
        if (piece) {
          pieces.push(piece);
        }
      }
      cursor = change.to;
    }
    this.appendRange(pieces, cursor, this.length, counters);

    return new PieceTableTextDocument(pieces, {
      scannedCodeUnits,
      touchedPieces: counters.touchedPieces,
      indexedBytes
    });
  }

  storageStats(): DocumentStorageStats {
    return {
      kind: "piece-table",
      pieceCount: this.pieces.length,
      sourceBufferCount: new Set(this.pieces.map((piece) => piece.source)).size,
      lastEditScannedCodeUnits: this.editCounters.scannedCodeUnits,
      lastEditTouchedPieces: this.editCounters.touchedPieces,
      lastEditCreatedPieces: this.pieces.length,
      lastEditIndexedBytes: this.editCounters.indexedBytes,
      lastEditMetadataBytes: this.pieces.length * (PIECE_BYTES + NUMBER_BYTES * 2),
      textMaterialized: this.textCache !== undefined
    };
  }

  /** @internal History drops derived whole-text caches when a revision becomes inactive. */
  releaseTextCache(): void {
    this.textCache = undefined;
  }

  /** @internal Used to deduplicate structurally shared sources in history accounting. */
  retentionParts(): {
    readonly sources: readonly SourceBuffer[];
    readonly pieceCount: number;
    readonly textCacheLength: number;
  } {
    return {
      sources: this.pieces.map((piece) => piece.source),
      pieceCount: this.pieces.length,
      textCacheLength: this.textCache?.length ?? 0
    };
  }

  private pieceIndexAt(target: number): number {
    return lowerBound(this.pieceEnds, target + 1);
  }

  private pieceDocumentStart(index: number): number {
    return index === 0 ? 0 : this.pieceEnds[index - 1];
  }

  private appendRange(
    target: Piece[],
    from: number,
    to: number,
    counters: { touchedPieces: number }
  ): void {
    if (to <= from) {
      return;
    }

    let pieceIndex = this.pieceIndexAt(from);
    while (pieceIndex < this.pieces.length) {
      const piece = this.pieces[pieceIndex];
      const pieceStart = this.pieceDocumentStart(pieceIndex);
      const pieceEnd = this.pieceEnds[pieceIndex];
      if (pieceStart >= to) {
        break;
      }

      counters.touchedPieces += 1;
      const rangeStart = Math.max(pieceStart, from);
      const rangeEnd = Math.min(pieceEnd, to);
      const next = makePiece(piece.source, piece.start + rangeStart - pieceStart, rangeEnd - rangeStart);
      if (next) {
        target.push(next);
      }
      if (pieceEnd >= to) {
        break;
      }
      pieceIndex += 1;
    }
  }

  private offsetAfterNewlines(count: number): number {
    if (count <= 0) {
      return 0;
    }

    const pieceIndex = lowerBound(this.newlineEnds, count);
    if (pieceIndex >= this.pieces.length) {
      return this.length;
    }

    const piece = this.pieces[pieceIndex];
    const newlinesBeforePiece = pieceIndex === 0 ? 0 : this.newlineEnds[pieceIndex - 1];
    const sourceNewlineIndex = piece.newlineFrom + count - newlinesBeforePiece - 1;
    return this.pieceDocumentStart(pieceIndex) + piece.source.newlines[sourceNewlineIndex] - piece.start + 1;
  }
}

/**
 * Clamps, orders, and validates simultaneous changes in original-document coordinates.
 * Touching ranges and multiple insertions at the same boundary are valid; intersecting
 * replaced ranges are rejected rather than applied ambiguously.
 */
export function normalizeTextChanges(changes: readonly TextChange[], length: number): TextChange[] {
  const safeLength = Math.max(0, integer(length));
  const sorted = changes
    .map((change, order) => {
      const from = offset(change.from, safeLength);
      const requestedTo = Number.isNaN(change.to) ? from : change.to;
      return {
        from,
        to: offset(Math.max(from, requestedTo), safeLength),
        insert: change.insert,
        order
      };
    })
    .sort((left, right) => left.from - right.from || left.to - right.to || left.order - right.order);

  const result: TextChange[] = [];
  let replacedThrough = 0;
  for (const change of sorted) {
    if (change.from === change.to && change.insert.length === 0) {
      continue;
    }
    if (change.from < replacedThrough) {
      throw new RangeError("Text changes must not overlap");
    }
    replacedThrough = Math.max(replacedThrough, change.to);
    result.push({ from: change.from, to: change.to, insert: change.insert });
  }

  return result;
}

export function getDocumentStorageStats(doc: TextDocument): DocumentStorageStats {
  if (doc instanceof PieceTableTextDocument) {
    return doc.storageStats();
  }

  return {
    kind: "string",
    pieceCount: doc.length === 0 ? 0 : 1,
    sourceBufferCount: doc.length === 0 ? 0 : 1,
    lastEditScannedCodeUnits: doc.length,
    lastEditTouchedPieces: doc.length === 0 ? 0 : 1,
    lastEditCreatedPieces: doc.length === 0 ? 0 : 1,
    lastEditIndexedBytes: doc.lineCount * NUMBER_BYTES,
    lastEditMetadataBytes: doc.lineCount * NUMBER_BYTES,
    textMaterialized: true
  };
}

/**
 * Releases a derived compatibility cache without changing document content. This is useful
 * when an inactive revision enters history; all source buffers and indexes remain shared.
 */
export function releaseDocumentTextCache(doc: TextDocument): void {
  if (doc instanceof PieceTableTextDocument) {
    doc.releaseTextCache();
  }
}

/** Estimates unique bytes retained by documents without reading their `text` property. */
export function getDocumentRetentionStats(documents: readonly TextDocument[]): DocumentRetentionStats {
  const uniqueDocuments = [...new Set(documents)];
  const sources = new Set<SourceBuffer>();
  let sourceTextBytes = 0;
  let sourceIndexBytes = 0;
  let pieceBytes = 0;
  let documentIndexBytes = 0;
  let materializedTextBytes = 0;
  let overheadBytes = 0;
  let nonPieceSourceBufferCount = 0;

  for (const doc of uniqueDocuments) {
    if (doc instanceof PieceTableTextDocument) {
      const parts = doc.retentionParts();
      for (const source of parts.sources) {
        if (!sources.has(source)) {
          sources.add(source);
          sourceTextBytes += source.text.length * UTF16_CODE_UNIT_BYTES;
          sourceIndexBytes += source.newlines.length * NUMBER_BYTES;
          overheadBytes += SOURCE_OVERHEAD_BYTES;
        }
      }
      pieceBytes += parts.pieceCount * PIECE_BYTES;
      documentIndexBytes += parts.pieceCount * NUMBER_BYTES * 2;
      materializedTextBytes += parts.textCacheLength * UTF16_CODE_UNIT_BYTES;
      overheadBytes += DOCUMENT_OVERHEAD_BYTES;
      continue;
    }

    if (doc instanceof StringTextDocument) {
      const stats = doc.retentionStats();
      sourceTextBytes += stats.sourceTextBytes;
      sourceIndexBytes += stats.sourceIndexBytes;
      overheadBytes += stats.overheadBytes;
      nonPieceSourceBufferCount += 1;
      continue;
    }

    // Unknown compatible implementations are conservatively counted from public sizes.
    sourceTextBytes += doc.length * UTF16_CODE_UNIT_BYTES;
    sourceIndexBytes += doc.lineCount * NUMBER_BYTES;
    overheadBytes += STRING_DOCUMENT_OVERHEAD_BYTES;
    nonPieceSourceBufferCount += 1;
  }

  const totalBytes =
    sourceTextBytes +
    sourceIndexBytes +
    pieceBytes +
    documentIndexBytes +
    materializedTextBytes +
    overheadBytes;
  return {
    documentCount: uniqueDocuments.length,
    uniqueSourceBufferCount: sources.size + nonPieceSourceBufferCount,
    sourceTextBytes,
    sourceIndexBytes,
    pieceBytes,
    documentIndexBytes,
    materializedTextBytes,
    overheadBytes,
    totalBytes
  };
}

export function createTextDocument(text = ""): TextDocument {
  const source = makeSource(text);
  const piece = makePiece(source, 0, text.length);
  return new PieceTableTextDocument(piece ? [piece] : [], {
    scannedCodeUnits: text.length,
    touchedPieces: 0,
    indexedBytes: source.newlines.length * NUMBER_BYTES
  });
}

export function mapOffsetThroughChanges(
  target: number,
  changes: readonly TextChange[],
  affinity: OffsetAffinity = "left"
): number {
  const safeTarget = Math.max(0, integer(target));
  // Mapping is normally called with validated in-document transactions. MAX_SAFE_INTEGER
  // keeps its historical clamping behavior without requiring a document argument.
  const normalized = normalizeTextChanges(changes, Number.MAX_SAFE_INTEGER);
  let delta = 0;

  for (const change of normalized) {
    if (safeTarget < change.from) {
      break;
    }

    const removed = change.to - change.from;
    if (removed === 0) {
      if (safeTarget > change.from || (safeTarget === change.from && affinity === "right")) {
        delta += change.insert.length;
      }
      continue;
    }

    if (safeTarget === change.from) {
      return Math.max(0, change.from + delta + (affinity === "right" ? change.insert.length : 0));
    }

    if (safeTarget < change.to) {
      return Math.max(0, change.from + delta + change.insert.length);
    }

    delta += change.insert.length - removed;
  }

  return Math.max(0, safeTarget + delta);
}
