import {
  mapOffsetThroughChanges,
  normalizeTextChanges,
  type OffsetAffinity,
  type TextChange
} from "./document";
import {
  createSelectionSet,
  getSelectionOffsetsForRange,
  normalizeSelection,
  type EditorState,
  type SelectionRange,
  type SelectionSet,
  type Transaction
} from "./state";

/** Pure selection and transformation transactions. All offsets are UTF-16 code units. */
export type SelectionTransaction = (state: EditorState) => Transaction;
export type CollapseDirection = "anchor" | "head";
export type CaseTransform = "toggle" | "lower" | "upper";

/**
 * Portable visible-column policy for alignment. Hosts may inject the same grapheme segmentation
 * and cell-width function used by their renderer. Tabs are expanded by `tabWidth` before the
 * optional `cellWidth` callback is consulted. The defaults use Unicode grapheme segmentation,
 * zero-width marks, two cells for East Asian wide/full-width and emoji clusters, and one cell
 * for other printable graphemes.
 */
export interface AlignmentColumnOptions {
  /** Minimum target column. Insertion-only alignment raises this to the widest source column. */
  column?: number;
  tabWidth?: number;
  segmentGraphemes?: (text: string) => readonly string[];
  cellWidth?: (grapheme: string) => number;
}

interface SourceSpan {
  readonly from: number;
  readonly to: number;
  readonly range: SelectionRange;
  readonly index: number;
}

interface OutputSpan extends SourceSpan {
  readonly fromAffinity?: OffsetAffinity;
  readonly toAffinity?: OffsetAffinity;
}

function spans(state: EditorState): SourceSpan[] {
  return state.selection.ranges.map((range, index) => ({
    ...getSelectionOffsetsForRange(state, range),
    range,
    index
  }));
}

function selectionTransaction(
  state: EditorState,
  ranges: readonly SelectionRange[],
  primaryIndex = 0
): Transaction {
  return {
    selection: normalizeSelection(
      state.doc,
      createSelectionSet(ranges, primaryIndex),
      state.mode
    )
  };
}

function rangeForSpan(
  state: Pick<EditorState, "doc" | "mode">,
  from: number,
  to: number,
  source: SelectionRange,
  preserveDirection = true
): SelectionRange {
  if (state.mode === "insert" || state.doc.length === 0 || to <= from) {
    const point = Math.max(0, Math.min(state.doc.length, from));
    return {
      anchor: point,
      head: point,
      preferredColumn: source.preferredColumn ?? null
    };
  }

  const forward = !preserveDirection || source.anchor <= source.head;
  return forward
    ? { anchor: from, head: to - 1, preferredColumn: source.preferredColumn ?? null }
    : { anchor: to - 1, head: from, preferredColumn: source.preferredColumn ?? null };
}

function preferredOutputPrimary(output: readonly SourceSpan[], sourcePrimaryIndex: number): number {
  const survivingPrimary = output.findIndex((span) => span.index === sourcePrimaryIndex);
  if (survivingPrimary >= 0) {
    return survivingPrimary;
  }

  // When the primary was removed, prefer the next source range, then the nearest previous one.
  const next = output.findIndex((span) => span.index > sourcePrimaryIndex);
  return next >= 0 ? next : Math.max(0, output.length - 1);
}

function changedSelection(
  state: EditorState,
  changes: readonly TextChange[],
  output: readonly OutputSpan[]
): SelectionSet {
  const nextDoc = state.doc.applyChanges(changes);
  const ranges = output.map((span) => {
    const from = mapOffsetThroughChanges(
      span.from,
      changes,
      span.fromAffinity ?? "left"
    );
    // Left affinity keeps an insertion at the selection's exclusive end outside the range.
    // Replacement/deletion endpoints still map to the end of their replacement text.
    const to = mapOffsetThroughChanges(span.to, changes, span.toAffinity ?? "left");
    return rangeForSpan({ doc: nextDoc, mode: state.mode }, from, to, span.range);
  });

  return normalizeSelection(
    nextDoc,
    createSelectionSet(ranges, preferredOutputPrimary(output, state.selection.primaryIndex)),
    state.mode
  );
}

function editTransaction(
  state: EditorState,
  edits: readonly TextChange[],
  output: readonly OutputSpan[]
): Transaction {
  let changes: TextChange[];
  try {
    changes = normalizeTextChanges(edits, state.doc.length);
  } catch {
    return {};
  }

  if (changes.length === 0) {
    return {};
  }

  return {
    changes,
    selection: changedSelection(state, changes, output)
  };
}

/** Collapses every range to its anchor or active head. */
export function collapseSelections(
  state: EditorState,
  direction: CollapseDirection = "head"
): Transaction {
  return selectionTransaction(
    state,
    state.selection.ranges.map((range) => ({
      ...range,
      anchor: range[direction],
      head: range[direction]
    })),
    state.selection.primaryIndex
  );
}

export function keepPrimarySelection(state: EditorState): Transaction {
  return selectionTransaction(state, [state.selection.ranges[state.selection.primaryIndex]!]);
}

export function removePrimarySelection(state: EditorState): Transaction {
  if (state.selection.ranges.length <= 1) {
    return selectionTransaction(state, state.selection.ranges, 0);
  }

  const next = state.selection.ranges.filter((_, index) => index !== state.selection.primaryIndex);
  return selectionTransaction(
    state,
    next,
    Math.min(state.selection.primaryIndex, next.length - 1)
  );
}

export function flipSelectionDirection(state: EditorState): Transaction {
  return selectionTransaction(
    state,
    state.selection.ranges.map((range) => ({
      ...range,
      anchor: range.head,
      head: range.anchor
    })),
    state.selection.primaryIndex
  );
}

export function ensureForwardSelections(state: EditorState): Transaction {
  return selectionTransaction(
    state,
    state.selection.ranges.map((range) =>
      range.anchor <= range.head
        ? range
        : { ...range, anchor: range.head, head: range.anchor }
    ),
    state.selection.primaryIndex
  );
}

export function rotatePrimarySelection(
  state: EditorState,
  direction: 1 | -1 = 1
): Transaction {
  const count = state.selection.ranges.length;
  return selectionTransaction(
    state,
    state.selection.ranges,
    (state.selection.primaryIndex + direction + count) % count
  );
}

function mergeSourceSpans(
  input: readonly SourceSpan[],
  primaryIndex: number,
  adjacent: boolean
): SourceSpan[] {
  const sorted = [...input].sort(
    (left, right) => left.from - right.from || left.to - right.to || left.index - right.index
  );
  const output: SourceSpan[] = [];

  for (const item of sorted) {
    const previous = output[output.length - 1];
    const connected = previous && (adjacent ? item.from <= previous.to : item.from < previous.to);
    if (!connected) {
      output.push({ ...item });
      continue;
    }

    const representative =
      item.index === primaryIndex
        ? item
        : previous.index === primaryIndex
          ? previous
          : previous;
    output[output.length - 1] = {
      from: previous.from,
      // Use the aggregate endpoint so nested ranges cannot break a transitive merge.
      to: Math.max(previous.to, item.to),
      range: representative.range,
      index: representative.index
    };
  }

  return output;
}

function mergedSelectionTransaction(state: EditorState, adjacent: boolean): Transaction {
  const output = mergeSourceSpans(spans(state), state.selection.primaryIndex, adjacent);
  return selectionTransaction(
    state,
    output.map((span) => rangeForSpan(state, span.from, span.to, span.range)),
    preferredOutputPrimary(output, state.selection.primaryIndex)
  );
}

export function mergeOverlappingSelections(state: EditorState): Transaction {
  return mergedSelectionTransaction(state, false);
}

export function mergeConsecutiveSelections(state: EditorState): Transaction {
  return mergedSelectionTransaction(state, true);
}

function splitResultTransaction(state: EditorState, result: readonly SourceSpan[]): Transaction {
  const normalized = mergeSourceSpans(result, state.selection.primaryIndex, false);
  if (normalized.length === 0) {
    // SelectionSet is non-empty by contract. If every piece was empty, retain the source
    // primary as the sole deterministic fallback rather than inventing a different range.
    return keepPrimarySelection(state);
  }

  return selectionTransaction(
    state,
    normalized.map((span) => rangeForSpan(state, span.from, span.to, span.range)),
    preferredOutputPrimary(normalized, state.selection.primaryIndex)
  );
}

/**
 * Splits on LF, CRLF, or a lone CR. Empty pieces (including a trailing piece) are omitted;
 * if all pieces are empty the primary source selection is retained as a representable fallback.
 */
export function splitSelectionsOnNewline(state: EditorState): Transaction {
  const result: SourceSpan[] = [];

  for (const span of spans(state)) {
    let pieceStart = span.from;
    let index = span.from;
    while (index < span.to) {
      const character = state.doc.charAt(index);
      if (character !== "\n" && character !== "\r") {
        index += 1;
        continue;
      }

      // A selection containing only half of a document CRLF does not split that pair.
      if (
        (character === "\r" && state.doc.charAt(index + 1) === "\n" && index + 1 >= span.to) ||
        (character === "\n" && state.doc.charAt(index - 1) === "\r" && index === span.from)
      ) {
        index += 1;
        continue;
      }

      if (pieceStart < index) {
        result.push({ ...span, from: pieceStart, to: index });
      }
      const width =
        character === "\r" && index + 1 < span.to && state.doc.charAt(index + 1) === "\n"
          ? 2
          : 1;
      index += width;
      pieceStart = index;
    }

    if (pieceStart < span.to) {
      result.push({ ...span, from: pieceStart, to: span.to });
    }
  }

  return splitResultTransaction(state, result);
}

function advanceStringIndex(text: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= text.length) {
    return index + 1;
  }

  const first = text.charCodeAt(index);
  const second = text.charCodeAt(index + 1);
  const surrogatePair =
    first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff;
  return index + (surrogatePair ? 2 : 1);
}

/**
 * Splits each selection around regex separators and selects the non-matching pieces.
 * Zero-width matches use ECMAScript AdvanceStringIndex and therefore never split an astral
 * code point in Unicode mode or loop at the end of a selection.
 */
export function splitSelectionsByRegex(state: EditorState, expression: RegExp): Transaction {
  const result: SourceSpan[] = [];
  const globalFlags = expression.global ? expression.flags : `${expression.flags}g`;
  const unicode = globalFlags.includes("u") || globalFlags.includes("v");

  for (const span of spans(state)) {
    const text = state.doc.slice(span.from, span.to);
    const regex = new RegExp(expression.source, globalFlags);
    let pieceStart = 0;

    for (;;) {
      const match = regex.exec(text);
      if (!match) {
        break;
      }

      const matchStart = Math.max(pieceStart, Math.min(text.length, match.index));
      const matchEnd = Math.max(
        matchStart,
        Math.min(text.length, match.index + match[0].length)
      );
      if (pieceStart < matchStart) {
        result.push({
          ...span,
          from: span.from + pieceStart,
          to: span.from + matchStart
        });
      }
      pieceStart = matchEnd;

      if (match[0].length === 0) {
        if (match.index >= text.length) {
          break;
        }
        regex.lastIndex = advanceStringIndex(text, match.index, unicode);
      }
    }

    if (pieceStart < text.length) {
      result.push({ ...span, from: span.from + pieceStart, to: span.to });
    }
  }

  return splitResultTransaction(state, result);
}

function disjointSpans(state: EditorState): SourceSpan[] {
  return mergeSourceSpans(spans(state), state.selection.primaryIndex, false);
}

/** Trims selection bounds without modifying text. Whitespace-only ranges are removed. */
export function trimSelections(state: EditorState): Transaction {
  const output: SourceSpan[] = [];

  for (const span of spans(state)) {
    const text = state.doc.slice(span.from, span.to);
    const leading = text.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = text.match(/\s*$/u)?.[0].length ?? 0;
    const from = span.from + leading;
    const to = span.to - trailing;
    if (from < to) {
      output.push({ ...span, from, to });
    }
  }

  const normalized = mergeSourceSpans(output, state.selection.primaryIndex, false);
  if (normalized.length === 0) {
    const primary = state.selection.ranges[state.selection.primaryIndex]!;
    const head = primary.head;
    return selectionTransaction(
      state,
      [{ anchor: head, head, preferredColumn: primary.preferredColumn ?? null }],
      0
    );
  }

  return selectionTransaction(
    state,
    normalized.map((span) => rangeForSpan(state, span.from, span.to, span.range)),
    preferredOutputPrimary(normalized, state.selection.primaryIndex)
  );
}

interface LineBreak extends SourceSpan {}

function selectedLineBreaks(state: EditorState, input: readonly SourceSpan[]): LineBreak[] {
  const result: LineBreak[] = [];
  for (const span of input) {
    let index = span.from;
    while (index < span.to) {
      const character = state.doc.charAt(index);
      if (character === "\r" && index + 1 < span.to && state.doc.charAt(index + 1) === "\n") {
        result.push({ ...span, from: index, to: index + 2 });
        index += 2;
      } else if (
        (character === "\r" && state.doc.charAt(index + 1) === "\n") ||
        (character === "\n" && state.doc.charAt(index - 1) === "\r")
      ) {
        // Never edit only one UTF-16 code unit of a CRLF sequence.
        index += 1;
      } else if (character === "\n" || character === "\r") {
        result.push({ ...span, from: index, to: index + 1 });
        index += 1;
      } else {
        index += 1;
      }
    }
  }
  return result;
}

/**
 * Replaces only selected line-break sequences with spaces. Existing leading/trailing whitespace
 * is untouched. One-line selections are a no-op. When requested, every inserted space is selected.
 */
export function joinSelectionLines(
  state: EditorState,
  selectInsertedSpace = false
): Transaction {
  const source = disjointSpans(state);
  const breaks = selectedLineBreaks(state, source);
  if (breaks.length === 0) {
    return {};
  }

  const edits = breaks.map((lineBreak) => ({
    from: lineBreak.from,
    to: lineBreak.to,
    insert: " "
  }));
  const output: OutputSpan[] = selectInsertedSpace ? breaks : source;
  return editTransaction(state, edits, output);
}

const graphemeSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
}

function isEastAsianWide(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

/** Default renderer-independent cell width used by selection alignment. */
export function defaultGraphemeCellWidth(grapheme: string): number {
  if (
    grapheme.length === 0 ||
    /^\p{Mark}+$/u.test(grapheme) ||
    /^\p{Control}+$/u.test(grapheme) ||
    /^\p{Format}+$/u.test(grapheme)
  ) {
    return 0;
  }
  if (
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u20E3/u.test(grapheme)
  ) {
    return 2;
  }
  return isEastAsianWide(grapheme.codePointAt(0) ?? 0) ? 2 : 1;
}

function visibleColumnAt(
  state: EditorState,
  offset: number,
  options: Required<Pick<AlignmentColumnOptions, "tabWidth" | "segmentGraphemes" | "cellWidth">>
): number {
  const line = state.doc.lineAt(state.doc.positionAt(offset).line);
  const relativeOffset = Math.max(0, Math.min(line.text.length, offset - line.start));
  let consumed = 0;
  let column = 0;
  for (const grapheme of options.segmentGraphemes(line.text)) {
    if (consumed >= relativeOffset) {
      break;
    }
    if (grapheme === "\t") {
      column += options.tabWidth - (column % options.tabWidth);
    } else {
      const width = options.cellWidth(grapheme);
      column += Number.isFinite(width) ? Math.max(0, Math.trunc(width)) : 0;
    }
    consumed += grapheme.length;
  }
  return column;
}

/**
 * Aligns selection starts to a shared visible column using insertion-only padding. Exactly one
 * selection is retained per physical start line: the primary range wins its line, otherwise the
 * earliest normalized range survives. Every original normalized range still contributes to the
 * automatic target, which is the widest original column (or a larger requested minimum).
 */
export function alignSelectionColumns(
  state: EditorState,
  columnOrOptions: number | AlignmentColumnOptions = {}
): Transaction {
  // Do not merge overlaps here: doing so replaces a primary range's actual start with the
  // aggregate start and loses both its column and the other original target candidates.
  const source = spans(state);
  if (source.length === 0) {
    return {};
  }

  const supplied = typeof columnOrOptions === "number" ? { column: columnOrOptions } : columnOrOptions;
  const requestedTabWidth = supplied.tabWidth ?? 4;
  const metrics = {
    tabWidth:
      Number.isFinite(requestedTabWidth) && requestedTabWidth > 0
        ? Math.max(1, Math.trunc(requestedTabWidth))
        : 4,
    segmentGraphemes: supplied.segmentGraphemes ?? graphemes,
    cellWidth: supplied.cellWidth ?? defaultGraphemeCellWidth
  };
  const columns = source.map((span) => visibleColumnAt(state, span.from, metrics));
  const widestSourceColumn = Math.max(...columns);
  const requestedColumn =
    supplied.column === undefined || !Number.isFinite(supplied.column)
      ? 0
      : Math.max(0, Math.trunc(supplied.column));
  const target = Math.max(widestSourceColumn, requestedColumn);

  // Insertion-only edits cannot place two distinct selections from one physical line at the
  // same absolute column: padding before the first necessarily shifts the second. Retain one
  // deterministic survivor per line, preferring the primary and otherwise the earliest range.
  const byLine = new Map<number, { span: SourceSpan; column: number }>();
  source.forEach((span, index) => {
    const line = state.doc.positionAt(span.from).line;
    const previous = byLine.get(line);
    if (!previous || span.index === state.selection.primaryIndex) {
      byLine.set(line, { span, column: columns[index]! });
    }
  });
  const survivors = [...byLine.values()];
  const editsByOffset = new Map<number, TextChange>();
  const mappedOutput: OutputSpan[] = survivors.map(({ span, column: current }) => {
    const padding = Math.max(0, target - current);
    if (padding > 0) {
      const previous = editsByOffset.get(span.from);
      if (!previous || previous.insert.length < padding) {
        editsByOffset.set(span.from, {
          from: span.from,
          to: span.from,
          insert: " ".repeat(padding)
        });
      }
    }
    // The start follows its own padding. The exclusive end stays left-affine so padding for
    // an adjacent selection at that boundary is not accidentally included.
    return { ...span, fromAffinity: "right", toAffinity: "left" };
  });
  const edits = [...editsByOffset.values()].sort((left, right) => left.from - right.from);

  if (edits.length === 0) {
    if (survivors.length === source.length) {
      return {};
    }
    const output = survivors.map(({ span }) => span);
    return selectionTransaction(
      state,
      output.map((span) => rangeForSpan(state, span.from, span.to, span.range)),
      preferredOutputPrimary(output, state.selection.primaryIndex)
    );
  }
  return editTransaction(state, edits, mappedOutput);
}

interface GraphemeSpan {
  readonly from: number;
  readonly to: number;
}

function lineGraphemeSpans(state: EditorState, lineIndex: number): GraphemeSpan[] {
  const line = state.doc.lineAt(lineIndex);
  const to =
    lineIndex + 1 < state.doc.lineCount
      ? state.doc.lineAt(lineIndex + 1).start
      : state.doc.length;
  const text = state.doc.slice(line.start, to);
  return Array.from(graphemeSegmenter.segment(text), (segment) => ({
    from: line.start + segment.index,
    to: line.start + segment.index + segment.segment.length
  }));
}

function containingGrapheme(
  clusters: readonly GraphemeSpan[],
  offset: number
): GraphemeSpan | undefined {
  let low = 0;
  let high = clusters.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (clusters[middle]!.to <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const cluster = clusters[low];
  return cluster && cluster.from <= offset && offset < cluster.to ? cluster : undefined;
}

function graphemeExpandedSpans(state: EditorState): SourceSpan[] {
  if (state.mode === "insert" || state.doc.length === 0) {
    return spans(state);
  }

  const clustersByLine = new Map<number, GraphemeSpan[]>();
  const clusterAt = (offset: number): GraphemeSpan | undefined => {
    const line = state.doc.positionAt(offset).line;
    let clusters = clustersByLine.get(line);
    if (!clusters) {
      clusters = lineGraphemeSpans(state, line);
      clustersByLine.set(line, clusters);
    }
    return containingGrapheme(clusters, offset);
  };
  const expanded = spans(state).map((span) => {
    const first = clusterAt(span.from);
    const last = clusterAt(Math.max(span.from, span.to - 1));
    return {
      ...span,
      from: first?.from ?? span.from,
      to: last?.to ?? span.to
    };
  });
  return mergeSourceSpans(expanded, state.selection.primaryIndex, false);
}

/** Replaces every selected grapheme with one validated replacement grapheme. */
export function replaceSelectionCharacters(
  state: EditorState,
  replacement: string
): Transaction {
  if (hasUnpairedSurrogate(replacement) || graphemes(replacement).length !== 1) {
    return {};
  }

  const output = graphemeExpandedSpans(state);
  const edits: TextChange[] = [];
  for (const span of output) {
    const count = graphemes(state.doc.slice(span.from, span.to)).length;
    if (count > 0) {
      edits.push({
        from: span.from,
        to: span.to,
        insert: replacement.repeat(count)
      });
    }
  }
  return editTransaction(state, edits, output);
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function toggleCodePointCase(character: string): string {
  const lower = character.toLowerCase();
  const upper = character.toUpperCase();
  if (lower === upper) {
    return character;
  }
  return character === lower ? upper : lower;
}

/**
 * Uses ECMAScript locale-independent default Unicode casing. Force-case applies the selected
 * string mapping; toggle-case decides independently for every Unicode code point. Expansions
 * such as ß → SS remain selected because output bounds are mapped from immutable source spans.
 */
export function transformSelectionCase(
  state: EditorState,
  transform: CaseTransform
): Transaction {
  const output = disjointSpans(state);
  const edits = output.map((span) => {
    const text = state.doc.slice(span.from, span.to);
    const insert =
      transform === "lower"
        ? text.toLowerCase()
        : transform === "upper"
          ? text.toUpperCase()
          : Array.from(text, toggleCodePointCase).join("");
    return { from: span.from, to: span.to, insert };
  });
  return editTransaction(state, edits, output);
}

function selectedLineStarts(state: EditorState): number[] {
  const seen = new Set<number>();
  for (const span of disjointSpans(state)) {
    const firstLine = state.doc.positionAt(span.from).line;
    const lastLine = state.doc.positionAt(Math.max(span.from, span.to - 1)).line;
    for (let line = firstLine; line <= lastLine; line += 1) {
      seen.add(state.doc.lineAt(line).start);
    }
  }
  return [...seen].sort((left, right) => left - right);
}

function validIndentUnit(unit: string): boolean {
  return /^\t$|^ {1,16}$/.test(unit);
}

export function indentSelections(state: EditorState, unit: string): Transaction {
  if (!validIndentUnit(unit)) {
    return {};
  }
  const edits = selectedLineStarts(state).map((from) => ({ from, to: from, insert: unit }));
  return editTransaction(state, edits, spans(state));
}

export function outdentSelections(state: EditorState, unit: string): Transaction {
  if (!validIndentUnit(unit)) {
    return {};
  }

  const edits: TextChange[] = [];
  for (const from of selectedLineStarts(state)) {
    if (state.doc.slice(from, from + unit.length) === unit) {
      edits.push({ from, to: from + unit.length, insert: "" });
      continue;
    }
    if (unit[0] === " ") {
      const spaces = state.doc.slice(from, from + unit.length).match(/^ +/)?.[0].length ?? 0;
      if (spaces > 0) {
        edits.push({ from, to: from + spaces, insert: "" });
      }
    }
  }
  return editTransaction(state, edits, spans(state));
}

/** Valid formatter changes are applied atomically; absent, invalid, or overlapping changes are no-ops. */
export function applyFormatterChanges(
  state: EditorState,
  changes: readonly TextChange[] | null | undefined
): Transaction {
  if (!changes || changes.length === 0) {
    return {};
  }
  if (
    changes.some(
      (change) =>
        !Number.isSafeInteger(change.from) ||
        !Number.isSafeInteger(change.to) ||
        change.from < 0 ||
        change.to < change.from ||
        change.to > state.doc.length ||
        typeof change.insert !== "string"
    )
  ) {
    return {};
  }

  try {
    const normalized = normalizeTextChanges(changes, state.doc.length);
    const meaningfulCount = changes.filter(
      (change) => change.insert.length > 0 || change.from !== change.to
    ).length;
    if (normalized.length !== meaningfulCount) {
      return {};
    }
    return editTransaction(state, normalized, spans(state));
  } catch {
    return {};
  }
}

/*
 * Numeric subset: an optional sign and decimal, 0x, 0o, or 0b integer magnitude. Parsing
 * separates sign from magnitude because BigInt does not accept signed non-decimal strings.
 * Arithmetic is arbitrary precision. Prefix and hexadecimal digit case are preserved, and
 * the digit field keeps at least its original zero-padded width. An explicit '+' is retained
 * while the result is non-negative; '-' is emitted exactly when the mathematical result is
 * negative, so both directions across zero have canonical signs.
 */
const NUMBER = /^[+-]?(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|\d+)$/;

function adjustNumber(text: string, delta: bigint): string | null {
  if (!NUMBER.test(text)) {
    return null;
  }

  const sourceSign = text[0] === "+" || text[0] === "-" ? text[0] : "";
  const body = sourceSign ? text.slice(1) : text;
  const prefix = /^0[xX]|^0[oO]|^0[bB]/.test(body) ? body.slice(0, 2) : "";
  const digits = prefix ? body.slice(2) : body;
  const base =
    prefix.toLowerCase() === "0x"
      ? 16
      : prefix.toLowerCase() === "0o"
        ? 8
        : prefix.toLowerCase() === "0b"
          ? 2
          : 10;
  const magnitude = BigInt(`${prefix.toLowerCase()}${digits}`);
  const value = (sourceSign === "-" ? -magnitude : magnitude) + delta;
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  let renderedDigits = absolute.toString(base).padStart(digits.length, "0");
  if (/[A-F]/.test(digits)) {
    renderedDigits = renderedDigits.toUpperCase();
  }
  const renderedSign = negative ? "-" : sourceSign === "+" ? "+" : "";
  return `${renderedSign}${prefix}${renderedDigits}`;
}

export function incrementSelections(state: EditorState, delta: bigint = 1n): Transaction {
  return changeNumbers(state, delta);
}

export function decrementSelections(state: EditorState, delta: bigint = 1n): Transaction {
  return changeNumbers(state, -delta);
}

function changeNumbers(state: EditorState, delta: bigint): Transaction {
  const output = disjointSpans(state);
  const edits: TextChange[] = [];
  for (const span of output) {
    const insert = adjustNumber(state.doc.slice(span.from, span.to), delta);
    if (insert !== null) {
      edits.push({ from: span.from, to: span.to, insert });
    }
  }
  return editTransaction(state, edits, output);
}
