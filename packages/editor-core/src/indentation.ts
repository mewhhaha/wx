import { mapOffsetThroughChanges, normalizeTextChanges, type TextChange, type TextDocument } from "./document";

export type IndentationAction = "enter" | "open-below" | "open-above";
export type LineEnding = "\n" | "\r\n";

export interface IndentationConfig {
  /** One literal tab, or from one through sixteen literal spaces. */
  indentUnit: string;
  /** Visual width of tabs; intentionally independent from `indentUnit`. */
  tabWidth: number;
  /** Visual spacing used by indent guides; intentionally independent from `tabWidth`. */
  guideWidth: number;
  /** Overrides detection when supplied. */
  lineEnding?: LineEnding;
}

export interface IndentationHint {
  status?: "ok" | "stale" | "incomplete" | "error";
  /** Absolute syntax depth, not a delta from the target line's existing whitespace. */
  indent?: number;
  /** Number of indentation levels removed from the absolute depth or alignment column. */
  outdent?: number;
  /** Absolute visual column; aligned outdent is applied in visual-column space. */
  alignColumn?: number;
}

export interface IndentationPoint { from: number; to?: number; selectionIndex?: number; }

export interface IndentationPlan {
  changes: readonly TextChange[];
  /** One entry for each supplied selection, preserving its primary/index mapping after de-duplication. */
  insertionOffsets: readonly number[];
  primaryIndex: number;
  lineEnding: LineEnding;
}

export const DEFAULT_INDENTATION_CONFIG: Readonly<IndentationConfig> = {
  indentUnit: "  ", tabWidth: 4, guideWidth: 2
};

export function validateIndentationConfig(config: IndentationConfig = DEFAULT_INDENTATION_CONFIG): IndentationConfig {
  const indentUnit = config.indentUnit;
  if (indentUnit !== "\t" && !/^ {1,16}$/.test(indentUnit)) {
    throw new RangeError("indentUnit must be one tab or 1 through 16 spaces.");
  }
  for (const [name, value] of [["tabWidth", config.tabWidth], ["guideWidth", config.guideWidth]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 32) throw new RangeError(`${name} must be an integer from 1 through 32.`);
  }
  if (config.lineEnding && config.lineEnding !== "\n" && config.lineEnding !== "\r\n") throw new RangeError("lineEnding must be LF or CRLF.");
  return { ...config };
}

export function detectLineEnding(document: TextDocument | string): LineEnding {
  if (typeof document === "string") return document.includes("\r\n") ? "\r\n" : "\n";
  if (document.lineCount < 2) return "\n";
  const first = document.lineAt(0);
  return first.end > first.start && document.charAt(first.end - 1) === "\r" ? "\r\n" : "\n";
}

function leadingWhitespace(text: string): string { return text.match(/^[\t ]*/)![0]; }
function lineContentEnd(document: TextDocument, line: { start: number; end: number }): number {
  if (line.end >= document.length || document.charAt(line.end) !== "\n") return line.end;
  return line.end > line.start && document.charAt(line.end - 1) === "\r" ? line.end - 1 : line.end;
}
function lineContent(document: TextDocument, line: { start: number; end: number }): string {
  return document.slice(line.start, lineContentEnd(document, line));
}
function previousNonblankIndent(document: TextDocument, line: number): string {
  for (let index = line; index >= 0; index -= 1) {
    const candidate = document.lineAt(index).text;
    if (/\S/.test(candidate)) return leadingWhitespace(candidate);
  }
  return "";
}
function codeBefore(text: string): string {
  // Conservative single-line lexer: delimiters inside obvious strings/comments do not count.
  let quote = "";
  let escaped = false;
  let output = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quote) { if (!escaped && char === quote) quote = ""; escaped = !escaped && char === "\\"; if (char !== "\\") escaped = false; continue; }
    if (char === "/" && (next === "/" || next === "*")) break;
    if (char === "#") break;
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    output += char;
  }
  return output;
}
function nextNonspaceIsCloser(text: string): boolean {
  const code = codeBefore(text);
  return /^[\t ]*[}\]\)]/.test(code);
}
function lastCodeCharacter(text: string): string { return codeBefore(text).trimEnd().at(-1) ?? ""; }
function removeIndentLevel(indent: string, unit: string, count: number): string {
  let result = indent;
  for (let i = 0; i < count; i += 1) {
    if (result.endsWith(unit)) result = result.slice(0, -unit.length);
    else if (result.endsWith("\t")) result = result.slice(0, -1);
    else result = result.slice(0, Math.max(0, result.length - unit.length));
  }
  return result;
}
function visualIndent(column: number, config: IndentationConfig): string {
  if (config.indentUnit === "\t") {
    const tabs = Math.floor(column / config.tabWidth);
    return `${"\t".repeat(tabs)}${" ".repeat(column - tabs * config.tabWidth)}`;
  }
  return " ".repeat(column);
}

interface PlannedCandidate {
  change: TextChange;
  cursorWithinInsert: number;
  indexes: number[];
  order: number;
}

function candidateIntervalsOverlap(left: TextChange, right: TextChange): boolean {
  const leftEmpty = left.from === left.to;
  const rightEmpty = right.from === right.to;
  if (leftEmpty && rightEmpty) return left.from === right.from;
  if (leftEmpty) return left.from >= right.from && left.from <= right.to;
  if (rightEmpty) return right.from >= left.from && right.from <= left.to;
  return left.from < right.to && right.from < left.to;
}

/**
 * Selection sets can contain duplicate or intersecting ranges. Collapse ambiguous edits
 * before they reach the document transaction boundary and keep every source selection
 * mapped to the deterministic first edit in its cluster.
 */
function coalesceCandidates(candidates: readonly PlannedCandidate[]): PlannedCandidate[] {
  const sorted = [...candidates].sort(
    (left, right) => left.change.from - right.change.from || left.change.to - right.change.to || left.order - right.order
  );
  const result: PlannedCandidate[] = [];
  for (const candidate of sorted) {
    const previous = result.at(-1);
    if (!previous || !candidateIntervalsOverlap(previous.change, candidate.change)) {
      result.push({ ...candidate, change: { ...candidate.change }, indexes: [...candidate.indexes] });
      continue;
    }
    previous.change = {
      from: Math.min(previous.change.from, candidate.change.from),
      to: Math.max(previous.change.to, candidate.change.to),
      insert: previous.change.insert
    };
    previous.indexes.push(...candidate.indexes);
  }
  return result;
}

/**
 * Creates normalized, non-overlapping edits for newline insertion. It is deliberately
 * syntax-agnostic: an `ok` hint augments the conservative plain-text answer; all other
 * statuses fall back without throwing.
 */
export function planIndentation(
  document: TextDocument,
  points: readonly IndentationPoint[],
  action: IndentationAction,
  options: IndentationConfig = DEFAULT_INDENTATION_CONFIG,
  hints: readonly (IndentationHint | undefined)[] = [],
  primaryIndex = 0
): IndentationPlan {
  const config = validateIndentationConfig(options);
  const lineEnding = config.lineEnding ?? detectLineEnding(document);
  const candidates: PlannedCandidate[] = [];
  points.forEach((point, index) => {
    const from = Math.max(0, Math.min(document.length, Math.trunc(point.from)));
    const to = Math.max(from, Math.min(document.length, Math.trunc(point.to ?? from)));
    const position = document.positionAt(from);
    const line = document.lineAt(position.line);
    const endPosition = document.positionAt(to);
    const endLine = document.lineAt(endPosition.line);
    const targetLineContent = lineContent(document, line);
    const before = action === "enter" ? document.slice(line.start, from) : targetLineContent;
    const after = action === "enter" ? document.slice(to, lineContentEnd(document, endLine)) : targetLineContent;
    const reference = /^\s*$/.test(targetLineContent) ? previousNonblankIndent(document, position.line - 1) : leadingWhitespace(targetLineContent);
    const hint = hints[index];
    let indent = reference;
    if (hint?.status === "ok") {
      const outdent = Math.max(0, hint.outdent ?? 0);
      if (hint.alignColumn !== undefined) {
        const unitWidth = config.indentUnit === "\t" ? config.tabWidth : config.indentUnit.length;
        indent = visualIndent(Math.max(0, hint.alignColumn - outdent * unitWidth), config);
      } else {
        indent = config.indentUnit.repeat(Math.max(0, (hint.indent ?? 0) - outdent));
      }
    } else {
      const opener = lastCodeCharacter(before);
      if (action !== "open-above" && opener !== "" && "{[(".includes(opener)) indent += config.indentUnit;
      if ((action === "enter" || action === "open-above") && nextNonspaceIsCloser(after)) {
        indent = removeIndentLevel(indent, config.indentUnit, 1);
      }
    }
    const change: TextChange = action === "open-below"
      ? { from: lineContentEnd(document, line), to: lineContentEnd(document, line), insert: `${lineEnding}${indent}` }
      : action === "open-above"
        ? { from: line.start, to: line.start, insert: `${indent}${lineEnding}` }
        : { from, to, insert: `${lineEnding}${indent}` };
    candidates.push({
      change,
      cursorWithinInsert: action === "open-above" ? indent.length : change.insert.length,
      indexes: [index],
      order: index
    });
  });
  const coalesced = coalesceCandidates(candidates);
  const normalized = normalizeTextChanges(coalesced.map((candidate) => candidate.change), document.length);
  const offsets: number[] = new Array(points.length);
  coalesced.forEach((candidate, candidateIndex) => {
    const change = normalized[candidateIndex]!;
    const cursor = mapOffsetThroughChanges(change.from, normalized, "left") + candidate.cursorWithinInsert;
    for (const index of candidate.indexes) offsets[index] = cursor;
  });
  return { changes: normalized, insertionOffsets: offsets, primaryIndex: Math.max(0, Math.min(primaryIndex, Math.max(0, points.length - 1))), lineEnding };
}
