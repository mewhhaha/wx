const COMBINING_RANGES: readonly [number, number][] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06ed],
  [0x0711, 0x0711],
  [0x0730, 0x074a],
  [0x07a6, 0x07b0],
  [0x07eb, 0x07f3],
  [0x0816, 0x082d],
  [0x0859, 0x085b],
  [0x08d3, 0x0902],
  [0x093a, 0x093c],
  [0x0941, 0x0948],
  [0x094d, 0x094d],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xe0100, 0xe01ef]
];

const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f251],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd]
];

function inRanges(value: number, ranges: readonly [number, number][]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle]!;
    if (value < range[0]) high = middle - 1;
    else if (value > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

function isEmojiModifier(value: number): boolean {
  return value >= 0x1f3fb && value <= 0x1f3ff;
}

function isRegionalIndicator(value: number): boolean {
  return value >= 0x1f1e6 && value <= 0x1f1ff;
}

export function codePointCellWidth(value: number): 0 | 1 | 2 {
  if (value === 0 || value === 0x200b || value === 0x200c || value === 0x200d) return 0;
  if (value < 0x20 || (value >= 0x7f && value < 0xa0)) return 0;
  if (isEmojiModifier(value)) return 0;
  if (inRanges(value, COMBINING_RANGES)) return 0;
  return inRanges(value, WIDE_RANGES) ? 2 : 1;
}

/** Iterates terminal graphemes without requiring Intl.Segmenter in the Deno cold path. */
export function terminalGraphemes(text: string): string[] {
  const graphemes: string[] = [];
  let joinNext = false;
  let unmatchedRegionalIndicator = false;
  for (const point of Array.from(text)) {
    const value = point.codePointAt(0) ?? 0;
    if (value === 0x09) {
      graphemes.push(point);
      joinNext = false;
      unmatchedRegionalIndicator = false;
      continue;
    }
    if (isRegionalIndicator(value)) {
      if (unmatchedRegionalIndicator && graphemes.length > 0) {
        graphemes[graphemes.length - 1] += point;
        unmatchedRegionalIndicator = false;
      } else {
        graphemes.push(point);
        unmatchedRegionalIndicator = true;
      }
      joinNext = false;
      continue;
    }
    unmatchedRegionalIndicator = false;
    const zeroWidth = codePointCellWidth(value) === 0;
    if ((zeroWidth || joinNext) && graphemes.length > 0) {
      graphemes[graphemes.length - 1] += point;
    } else {
      graphemes.push(point);
    }
    joinNext = value === 0x200d;
  }
  return graphemes;
}

export function graphemeCellWidth(value: string): 0 | 1 | 2 {
  let width: 0 | 1 | 2 = 0;
  let emojiPresentation = false;
  let keycap = false;
  let regionalIndicator = false;
  for (const point of Array.from(value)) {
    const codePoint = point.codePointAt(0) ?? 0;
    emojiPresentation ||= codePoint === 0xfe0f;
    keycap ||= codePoint === 0x20e3;
    regionalIndicator ||= isRegionalIndicator(codePoint);
    width = Math.max(width, codePointCellWidth(codePoint)) as 0 | 1 | 2;
  }
  if (emojiPresentation || keycap || regionalIndicator) return Math.max(2, width) as 1 | 2;
  return width;
}

export function terminalTextWidth(text: string, startCol = 0, tabSize = 8): number {
  let col = Math.max(0, startCol);
  for (const grapheme of terminalGraphemes(text)) {
    if (grapheme === "\t") {
      col += tabSize - (col % tabSize);
    } else {
      col += graphemeCellWidth(grapheme);
    }
  }
  return col - Math.max(0, startCol);
}

export function truncateTerminalText(text: string, width: number, startCol = 0): string {
  let output = "";
  let col = Math.max(0, startCol);
  const limit = col + Math.max(0, width);
  for (const grapheme of terminalGraphemes(text)) {
    const next = grapheme === "\t" ? col + 8 - (col % 8) : col + graphemeCellWidth(grapheme);
    if (next > limit) break;
    output += grapheme;
    col = next;
  }
  return output;
}
