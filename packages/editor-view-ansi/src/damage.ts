import type { AnsiFrameCursor, AnsiFramePatch, AnsiFrameSnapshot } from "./terminal-types";

const ANSI_RESET = "\u001b[0m";
const ANSI_HOME = "\u001b[H";
const ANSI_CLEAR = "\u001b[2J";
const ANSI_HIDE_CURSOR = "\u001b[?25l";
const encoder = new TextEncoder();

function cursorEquals(left: AnsiFrameCursor | null, right: AnsiFrameCursor | null): boolean {
  if (left === right) return true;
  return !!left && !!right && left.row === right.row && left.col === right.col && left.shape === right.shape;
}

export function serializeAnsiCursor(cursor: AnsiFrameCursor | null): string {
  if (!cursor) return ANSI_HIDE_CURSOR;
  const shape = cursor.shape === "beam" ? "\u001b[6 q" : "\u001b[2 q";
  return `\u001b[${cursor.row};${cursor.col}H${shape}\u001b[?25h`;
}

/** Full-frame oracle used both for repaint fallback and patch-replay tests. */
export function serializeAnsiFrameSnapshot(snapshot: AnsiFrameSnapshot): string {
  let output = `${ANSI_HIDE_CURSOR}${ANSI_CLEAR}${ANSI_HOME}`;
  for (let row = 0; row < snapshot.serializedRows.length; row += 1) {
    output += `\u001b[${row + 1};1H${snapshot.serializedRows[row] ?? ""}`;
  }
  return `${output}${ANSI_RESET}${serializeAnsiCursor(snapshot.cursor)}`;
}

export function createAnsiFramePatch(
  previous: AnsiFrameSnapshot | null,
  next: AnsiFrameSnapshot,
  options: { forceFull?: boolean } = {}
): AnsiFramePatch {
  const mustRepaint =
    options.forceFull === true ||
    previous === null ||
    previous.cols !== next.cols ||
    previous.rows !== next.rows ||
    previous.serializedRows.length !== next.serializedRows.length;

  if (mustRepaint) {
    const text = serializeAnsiFrameSnapshot(next);
    return {
      text,
      kind: "full",
      damagedRows: Array.from({ length: next.rows }, (_, index) => index),
      bytes: encoder.encode(text).byteLength
    };
  }

  const damagedRows: number[] = [];
  for (let row = 0; row < next.serializedRows.length; row += 1) {
    if (previous.serializedRows[row] !== next.serializedRows[row]) damagedRows.push(row);
  }

  if (damagedRows.length === 0) {
    if (cursorEquals(previous.cursor, next.cursor)) {
      return { text: "", kind: "none", damagedRows, bytes: 0 };
    }
    const text = serializeAnsiCursor(next.cursor);
    return { text, kind: "cursor", damagedRows, bytes: encoder.encode(text).byteLength };
  }

  let text = ANSI_HIDE_CURSOR;
  for (const row of damagedRows) {
    text += `\u001b[${row + 1};1H${next.serializedRows[row] ?? ""}`;
  }
  text += `${ANSI_RESET}${serializeAnsiCursor(next.cursor)}`;
  return { text, kind: "rows", damagedRows, bytes: encoder.encode(text).byteLength };
}
