export interface RowView {
  visualRowIndex: number;
  host: HTMLDivElement;
  row: HTMLDivElement;
  gutter: HTMLDivElement;
  content: HTMLDivElement;
}

export interface LineViewport {
  fromLine: number;
  toLine: number;
}

export interface VisualRow {
  docLine: number;
  visualRowIndex: number;
  segmentStart: number;
  segmentEnd: number;
  startColumn: number;
  isContinuation: boolean;
  isLastSegment: boolean;
}

export interface LineChangeState {
  kind: "added" | "modified" | null;
  deleted: boolean;
}
