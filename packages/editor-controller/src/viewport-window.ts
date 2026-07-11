import {
  mapOffsetThroughChanges,
  type TextChange,
  type TextDocument
} from "@mewhhaha/wx-core";
import {
  createVisualLayoutIndex,
  visualRowKey,
  type VisualLayoutIndex,
  type VisualLayoutRow,
  type VisualLayoutWindow,
  type VisualRowAnchor
} from "@mewhhaha/wx-layout";

export interface ViewportWindowOptions {
  doc: TextDocument;
  documentRevision?: number;
  visibleRowCapacity: number;
  softWrap: boolean;
  wrapColumns: number;
  topAnchorOffset?: number;
}

/** Controller-owned geometry state. Presentation receives only its bounded snapshot. */
export class ViewportWindowModel {
  private doc: TextDocument;
  private index: VisualLayoutIndex;
  private capacity: number;
  private anchor: VisualRowAnchor;
  private current: VisualLayoutWindow;
  private generation = 0;

  constructor(options: ViewportWindowOptions) {
    this.doc = options.doc;
    this.capacity = Math.max(1, Math.trunc(options.visibleRowCapacity));
    this.anchor = {
      offset: Math.max(0, Math.min(options.doc.length, options.topAnchorOffset ?? 0)),
      affinity: "right"
    };
    this.index = createVisualLayoutIndex({
      doc: options.doc,
      documentRevision: options.documentRevision,
      geometryGeneration: this.generation,
      softWrap: options.softWrap,
      wrapColumns: options.wrapColumns
    });
    this.current = this.resolve();
  }

  get window(): VisualLayoutWindow { return this.current; }
  get visualIndex(): VisualLayoutIndex { return this.index; }
  get topAnchor(): VisualRowAnchor { return { ...this.anchor }; }

  private resolve(): VisualLayoutWindow {
    this.current = this.index.resolveWindow(this.anchor, 0, this.capacity, 0);
    const top = this.current.rows[this.current.visibleOffset];
    if (top) this.anchor = { offset: top.segmentStart, affinity: "right" };
    return this.current;
  }

  configure(options: {
    doc?: TextDocument;
    documentRevision?: number;
    visibleRowCapacity?: number;
    softWrap?: boolean;
    wrapColumns?: number;
    changes?: readonly TextChange[];
  }): VisualLayoutWindow {
    const nextDoc = options.doc ?? this.doc;
    const nextCapacity = Math.max(1, Math.trunc(options.visibleRowCapacity ?? this.capacity));
    const nextSoftWrap = options.softWrap ?? this.index.softWrap;
    const nextWrapColumns = Math.max(1, options.wrapColumns ?? this.index.wrapColumns);
    const docChanged = nextDoc !== this.doc;
    const geometryChanged = nextSoftWrap !== this.index.softWrap || nextWrapColumns !== this.index.wrapColumns;

    if (docChanged) {
      const changes = options.changes ?? [];
      this.anchor = {
        offset: changes.length > 0
          ? Math.min(nextDoc.length, mapOffsetThroughChanges(this.anchor.offset, changes, this.anchor.affinity))
          : Math.min(nextDoc.length, this.anchor.offset),
        affinity: this.anchor.affinity
      };
      this.doc = nextDoc;
    }

    this.capacity = nextCapacity;
    if (geometryChanged) this.generation += 1;

    if (geometryChanged) {
      this.index = createVisualLayoutIndex({
        doc: nextDoc,
        documentRevision: options.documentRevision ?? this.index.documentRevision,
        geometryGeneration: this.generation,
        softWrap: nextSoftWrap,
        wrapColumns: nextWrapColumns
      });
    } else if (docChanged) {
      this.index.applyChanges(nextDoc, options.changes ?? [], options.documentRevision ?? this.index.documentRevision + 1);
    }

    return this.resolve();
  }

  scroll(delta: number): boolean {
    if (delta === 0) return false;
    const top = this.current.rows[this.current.visibleOffset] ?? this.index.resolveOffset(this.anchor.offset);
    const moved = this.index.move(top.id, Math.trunc(delta));
    if (visualRowKey(moved.row.id) === visualRowKey(top.id)) return false;
    this.anchor = { offset: moved.row.segmentStart, affinity: "right" };
    this.resolve();
    return true;
  }

  reveal(offset: number, scrolloffRows: number): boolean {
    const target = this.index.resolveOffset(offset);
    const visible = this.current.rows.slice(
      this.current.visibleOffset,
      this.current.visibleOffset + this.current.visibleCount
    );
    const targetIndex = visible.findIndex((row) => visualRowKey(row.id) === visualRowKey(target.id));
    const scrolloff = Math.max(0, Math.min(Math.trunc(scrolloffRows), Math.floor((this.capacity - 1) / 2)));
    const lowerBound = scrolloff;
    const upperBound = Math.max(lowerBound, this.capacity - 1 - scrolloff);

    if (targetIndex >= lowerBound && targetIndex <= upperBound) return false;

    const rowsBefore = targetIndex >= 0 && targetIndex < lowerBound ? scrolloff : upperBound;
    const nextTop = this.index.move(target.id, -rowsBefore).row;
    const previousKey = visualRowKey(this.current.top);
    if (visualRowKey(nextTop.id) === previousKey) return false;
    this.anchor = { offset: nextTop.segmentStart, affinity: "right" };
    this.resolve();
    return visualRowKey(this.current.top) !== previousKey;
  }

  align(offset: number, position: "top" | "center" | "bottom"): boolean {
    const target = this.index.resolveOffset(offset);
    const rowsBefore = position === "top" ? 0 : position === "bottom" ? this.capacity - 1 : Math.floor(this.capacity / 2);
    const nextTop = this.index.move(target.id, -rowsBefore).row;
    const previousKey = visualRowKey(this.current.top);
    this.anchor = { offset: nextTop.segmentStart, affinity: "right" };
    this.resolve();
    return visualRowKey(this.current.top) !== previousKey;
  }

  moveFromOffset(offset: number, delta: number): VisualLayoutRow {
    return this.index.move(this.index.resolveOffset(offset).id, Math.trunc(delta)).row;
  }
}
