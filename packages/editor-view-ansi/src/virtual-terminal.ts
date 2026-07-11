import { codePointCellWidth, graphemeCellWidth } from "./cell-width";

export interface VirtualTerminalCell {
  char: string;
  style: string;
  continuation: boolean;
}

export interface VirtualTerminalSnapshot {
  cells: readonly (readonly VirtualTerminalCell[])[];
  cursor: { row: number; col: number; visible: boolean; shape: "beam" | "block" };
}

function blankCell(style = "0"): VirtualTerminalCell {
  return { char: " ", style, continuation: false };
}

function readGrapheme(text: string, start: number): { value: string; next: number } {
  const firstPoint = text.codePointAt(start);
  if (firstPoint === undefined) return { value: "", next: start };
  let value = String.fromCodePoint(firstPoint);
  let next = start + value.length;
  let joinNext = firstPoint === 0x200d;
  while (next < text.length) {
    const point = text.codePointAt(next);
    if (point === undefined) break;
    if (point === 0x1b || point === 0x0a || point === 0x0d || point === 0x09) break;
    const part = String.fromCodePoint(point);
    const combines = codePointCellWidth(point) === 0;
    if (!combines && !joinNext) break;
    value += part;
    next += part.length;
    joinNext = point === 0x200d;
  }
  return { value, next };
}

/** Deterministic ANSI screen model for replaying full frames and damage patches. */
export class VirtualAnsiTerminal {
  private readonly cells: VirtualTerminalCell[][];
  private row = 0;
  private col = 0;
  private style = "0";
  private cursorVisible = true;
  private cursorShape: "beam" | "block" = "block";
  private pendingWrap = false;

  constructor(readonly cols: number, readonly rows: number) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.cells = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => blankCell())
    );
  }

  private clearCell(row: number, col: number): void {
    const cell = this.cells[row]?.[col];
    if (!cell) return;
    if (cell.continuation && col > 0) this.cells[row]![col - 1] = blankCell(this.style);
    else if (this.cells[row]?.[col + 1]?.continuation) this.cells[row]![col + 1] = blankCell(this.style);
  }

  private put(value: string): void {
    if (!value) return;
    if (this.pendingWrap) {
      this.row = Math.min(this.rows - 1, this.row + 1);
      this.col = 0;
      this.pendingWrap = false;
    }
    if (value === "\t") {
      const nextTab = Math.min(this.cols, this.col + 8 - (this.col % 8));
      this.col = nextTab;
      this.pendingWrap = this.col >= this.cols;
      return;
    }
    const width = graphemeCellWidth(value);
    if (width === 0) {
      const previous = this.cells[this.row]?.[Math.max(0, this.col - 1)];
      if (previous && !previous.continuation) previous.char += value;
      return;
    }
    if (width === 2 && this.col + 1 >= this.cols) {
      this.pendingWrap = true;
      this.put(value);
      return;
    }
    this.clearCell(this.row, this.col);
    if (width === 2) this.clearCell(this.row, this.col + 1);
    this.cells[this.row]![this.col] = { char: value, style: this.style, continuation: false };
    if (width === 2) {
      this.cells[this.row]![this.col + 1] = { char: "", style: this.style, continuation: true };
    }
    this.col += width;
    if (this.col >= this.cols) {
      this.col = this.cols - 1;
      this.pendingWrap = true;
    }
  }

  private applyCsi(body: string, command: string): void {
    const normalized = body.trim();
    if (command === "H" || command === "f") {
      const [row = "1", col = "1"] = normalized.split(";");
      this.row = Math.max(0, Math.min(this.rows - 1, Number(row || 1) - 1));
      this.col = Math.max(0, Math.min(this.cols - 1, Number(col || 1) - 1));
      this.pendingWrap = false;
      return;
    }
    if (command === "J" && (normalized === "2" || normalized === "3")) {
      for (let row = 0; row < this.rows; row += 1) {
        for (let col = 0; col < this.cols; col += 1) this.cells[row]![col] = blankCell(this.style);
      }
      return;
    }
    if (command === "m") {
      this.style = normalized && normalized !== "0" ? normalized : "0";
      return;
    }
    if (command === "h" && normalized === "?25") {
      this.cursorVisible = true;
      return;
    }
    if (command === "l" && normalized === "?25") {
      this.cursorVisible = false;
      return;
    }
    if (command === "q") {
      this.cursorShape = normalized === "6" ? "beam" : "block";
    }
  }

  write(text: string): void {
    for (let index = 0; index < text.length; ) {
      if (text[index] === "\u001b" && text[index + 1] === "[") {
        let end = index + 2;
        while (end < text.length) {
          const code = text.charCodeAt(end);
          if (code >= 0x40 && code <= 0x7e) break;
          end += 1;
        }
        if (end >= text.length) return;
        this.applyCsi(text.slice(index + 2, end), text[end]!);
        index = end + 1;
        continue;
      }
      if (text[index] === "\n") {
        this.row = Math.min(this.rows - 1, this.row + 1);
        this.pendingWrap = false;
        index += 1;
        continue;
      }
      if (text[index] === "\r") {
        this.col = 0;
        this.pendingWrap = false;
        index += 1;
        continue;
      }
      const grapheme = readGrapheme(text, index);
      this.put(grapheme.value);
      index = grapheme.next;
    }
  }

  snapshot(): VirtualTerminalSnapshot {
    return {
      cells: this.cells.map((row) => row.map((cell) => ({ ...cell }))),
      cursor: {
        row: this.cursorVisible ? this.row + 1 : 0,
        col: this.cursorVisible ? this.col + 1 : 0,
        visible: this.cursorVisible,
        shape: this.cursorVisible ? this.cursorShape : "block"
      }
    };
  }

  textRows(): readonly string[] {
    return this.cells.map((row) => row.map((cell) => cell.char).join(""));
  }
}
