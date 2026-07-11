import type { TextChange, TextDocument } from "@mewhhaha/wx-core";

import type { EditorVisualRow } from "./index";

export interface VisualRowId {
  docLine: number;
  wrapSegment: number;
}

export interface VisualRowAnchor {
  offset: number;
  affinity: "left" | "right";
}

export interface VisualRowTotal {
  value: number;
  exact: boolean;
}

export interface VisualLayoutWorkCounters {
  rowsVisited: number;
  rowsBuilt: number;
  mappingCacheHits: number;
  mappingEntriesBuilt: number;
}

export interface VisualLayoutRow extends EditorVisualRow {
  id: VisualRowId;
}

export interface VisualLayoutWindow {
  anchor: VisualRowAnchor;
  top: VisualRowId;
  rows: readonly VisualLayoutRow[];
  visibleOffset: number;
  visibleCount: number;
  total: VisualRowTotal;
  reachedStart: boolean;
  reachedEnd: boolean;
  geometryGeneration: number;
}

export interface VisualLayoutIndex {
  readonly documentRevision: number;
  readonly geometryGeneration: number;
  readonly softWrap: boolean;
  readonly wrapColumns: number;
  readonly counters: Readonly<VisualLayoutWorkCounters>;
  resetCounters(): void;
  resolveOffset(offset: number): VisualLayoutRow;
  resolveRow(id: VisualRowId): VisualLayoutRow;
  resolveWindow(anchor: VisualRowAnchor, before: number, count: number, after: number): VisualLayoutWindow;
  move(id: VisualRowId, delta: number): { row: VisualLayoutRow; hitBoundary: boolean };
  first(): VisualLayoutRow;
  last(): VisualLayoutRow;
  applyChanges(next: TextDocument, changes: readonly TextChange[], nextDocumentRevision: number): void;
}

export interface CreateVisualLayoutIndexOptions {
  doc: TextDocument;
  documentRevision?: number;
  geometryGeneration?: number;
  softWrap?: boolean;
  wrapColumns?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Stable key for renderer caches. Global visual ordinals are deliberately not row identity. */
export function visualRowKey(id: VisualRowId): string {
  return `${id.docLine}:${id.wrapSegment}`;
}

/**
 * Sparse visual index. Unwrapped rows have a closed-form mapping. Wrapped line
 * geometry is learned only for lines navigation or rendering touches.
 */
class SparseVisualLayoutIndex implements VisualLayoutIndex {
  private doc: TextDocument;
  private readonly wrapCounts = new Map<number, number>();
  private mutableDocumentRevision: number;
  private mutableGeometryGeneration: number;
  private readonly mutableSoftWrap: boolean;
  private readonly mutableWrapColumns: number;
  private readonly work: VisualLayoutWorkCounters = {
    rowsVisited: 0,
    rowsBuilt: 0,
    mappingCacheHits: 0,
    mappingEntriesBuilt: 0
  };

  constructor(options: CreateVisualLayoutIndexOptions) {
    this.doc = options.doc;
    this.mutableDocumentRevision = options.documentRevision ?? 0;
    this.mutableGeometryGeneration = options.geometryGeneration ?? 0;
    this.mutableSoftWrap = options.softWrap ?? false;
    this.mutableWrapColumns = Math.max(1, options.wrapColumns ?? Number.MAX_SAFE_INTEGER);
  }

  get documentRevision(): number { return this.mutableDocumentRevision; }
  get geometryGeneration(): number { return this.mutableGeometryGeneration; }
  get softWrap(): boolean { return this.mutableSoftWrap; }
  get wrapColumns(): number { return this.mutableWrapColumns; }
  get counters(): Readonly<VisualLayoutWorkCounters> { return this.work; }

  resetCounters(): void {
    this.work.rowsVisited = 0;
    this.work.rowsBuilt = 0;
    this.work.mappingCacheHits = 0;
    this.work.mappingEntriesBuilt = 0;
  }

  private countForLine(lineIndex: number): number {
    if (!this.mutableSoftWrap || this.mutableWrapColumns === Number.MAX_SAFE_INTEGER) return 1;
    const safeLine = clamp(lineIndex, 0, Math.max(0, this.doc.lineCount - 1));
    const cached = this.wrapCounts.get(safeLine);
    if (cached !== undefined) {
      this.work.mappingCacheHits += 1;
      return cached;
    }
    this.work.rowsVisited += 1;
    const length = this.doc.lineAt(safeLine).text.length;
    const count = Math.max(1, Math.ceil(length / this.mutableWrapColumns));
    this.wrapCounts.set(safeLine, count);
    this.work.mappingEntriesBuilt += 1;
    return count;
  }

  private normalizeId(id: VisualRowId): VisualRowId {
    const docLine = clamp(id.docLine, 0, Math.max(0, this.doc.lineCount - 1));
    return { docLine, wrapSegment: clamp(id.wrapSegment, 0, this.countForLine(docLine) - 1) };
  }

  resolveRow(id: VisualRowId): VisualLayoutRow {
    const normalized = this.normalizeId(id);
    this.work.rowsVisited += 1;
    const line = this.doc.lineAt(normalized.docLine);
    const startColumn = this.mutableSoftWrap ? normalized.wrapSegment * this.mutableWrapColumns : 0;
    const segmentStart = Math.min(line.end, line.start + startColumn);
    const segmentEnd = this.mutableSoftWrap ? Math.min(line.end, segmentStart + this.mutableWrapColumns) : line.end;
    const count = this.countForLine(normalized.docLine);
    this.work.rowsBuilt += 1;
    return {
      id: normalized,
      docLine: normalized.docLine,
      // Exact when unwrapped; wrapped consumers use `id` rather than this projection.
      visualRowIndex: this.mutableSoftWrap ? normalized.docLine + normalized.wrapSegment : normalized.docLine,
      segmentStart,
      segmentEnd,
      startColumn,
      isContinuation: normalized.wrapSegment > 0,
      isLastSegment: normalized.wrapSegment === count - 1
    };
  }

  resolveOffset(offset: number): VisualLayoutRow {
    const position = this.doc.positionAt(clamp(offset, 0, this.doc.length));
    const segment = this.mutableSoftWrap
      ? Math.min(this.countForLine(position.line) - 1, Math.floor(position.column / this.mutableWrapColumns))
      : 0;
    return this.resolveRow({ docLine: position.line, wrapSegment: segment });
  }

  first(): VisualLayoutRow { return this.resolveRow({ docLine: 0, wrapSegment: 0 }); }

  last(): VisualLayoutRow {
    const docLine = Math.max(0, this.doc.lineCount - 1);
    return this.resolveRow({ docLine, wrapSegment: this.countForLine(docLine) - 1 });
  }

  move(id: VisualRowId, delta: number): { row: VisualLayoutRow; hitBoundary: boolean } {
    let current = this.normalizeId(id);
    let remaining = Math.trunc(delta);
    let hitBoundary = false;
    while (remaining !== 0) {
      if (remaining > 0) {
        const count = this.countForLine(current.docLine);
        if (current.wrapSegment + 1 < count) current = { ...current, wrapSegment: current.wrapSegment + 1 };
        else if (current.docLine + 1 < this.doc.lineCount) current = { docLine: current.docLine + 1, wrapSegment: 0 };
        else { hitBoundary = true; break; }
        remaining -= 1;
      } else {
        if (current.wrapSegment > 0) current = { ...current, wrapSegment: current.wrapSegment - 1 };
        else if (current.docLine > 0) {
          const previousLine = current.docLine - 1;
          current = { docLine: previousLine, wrapSegment: this.countForLine(previousLine) - 1 };
        } else { hitBoundary = true; break; }
        remaining += 1;
      }
    }
    return { row: this.resolveRow(current), hitBoundary };
  }

  resolveWindow(anchor: VisualRowAnchor, before: number, count: number, after: number): VisualLayoutWindow {
    const safeBefore = Math.max(0, Math.trunc(before));
    const safeCount = Math.max(1, Math.trunc(count));
    const safeAfter = Math.max(0, Math.trunc(after));
    const anchorRow = this.resolveOffset(anchor.offset);
    const beforeRows: VisualLayoutRow[] = [];
    let cursor = anchorRow;
    let reachedStart = false;
    for (let index = 0; index < safeBefore; index += 1) {
      const previous = this.move(cursor.id, -1);
      if (previous.hitBoundary && visualRowKey(previous.row.id) === visualRowKey(cursor.id)) { reachedStart = true; break; }
      beforeRows.unshift(previous.row);
      cursor = previous.row;
    }
    if (beforeRows.length < safeBefore) reachedStart = true;
    const rows = [...beforeRows, anchorRow];
    cursor = anchorRow;
    let reachedEnd = false;
    const targetLength = beforeRows.length + safeCount + safeAfter;
    while (rows.length < targetLength) {
      const next = this.move(cursor.id, 1);
      if (next.hitBoundary && visualRowKey(next.row.id) === visualRowKey(cursor.id)) { reachedEnd = true; break; }
      rows.push(next.row);
      cursor = next.row;
    }
    const visibleOffset = beforeRows.length;
    const visibleCount = Math.min(safeCount, rows.length - visibleOffset);
    return {
      anchor: { ...anchor, offset: clamp(anchor.offset, 0, this.doc.length) },
      top: rows[visibleOffset]?.id ?? anchorRow.id,
      rows,
      visibleOffset,
      visibleCount,
      total: this.mutableSoftWrap
        ? { value: Math.max(this.doc.lineCount, rows.length), exact: false }
        : { value: this.doc.lineCount, exact: true },
      reachedStart,
      reachedEnd,
      geometryGeneration: this.mutableGeometryGeneration
    };
  }

  applyChanges(next: TextDocument, _changes: readonly TextChange[], nextDocumentRevision: number): void {
    this.doc = next;
    this.mutableDocumentRevision = nextDocumentRevision;
    this.wrapCounts.clear();
  }
}

export function createVisualLayoutIndex(options: CreateVisualLayoutIndexOptions): VisualLayoutIndex {
  return new SparseVisualLayoutIndex(options);
}
