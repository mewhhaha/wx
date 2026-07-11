/**
 * wx indent-query subset (informed by Helix's documented indent guide, 2026-07-11):
 * @indent, @outdent, @align (with exactly one @anchor in its pattern), and @opaque.
 * @indent.always, @outdent.always, @extend, @extend.prevent-once and @header are
 * intentionally unsupported. Same-line @indent captures do not create a scope.
 */
export const TREE_SITTER_INDENT_QUERY_SUBSET = "wx-indent-v1" as const;

export interface IndentCapture {
  name: "indent" | "outdent" | "align" | "anchor" | "opaque";
  from: number;
  to: number;
  startRow: number;
  endRow: number;
  startColumn: number;
  patternIndex: number;
}

export interface IndentCaptureAnswer { indent: number; outdent: number; alignColumn?: number; opaque?: true; }

export interface IndentQueryRange { startIndex: number; endIndex: number; }

/** Normalize line-oriented o/O requests while Enter remains split at the caret. */
export function indentationQueryOffset(
  text: string,
  offset: number,
  action: "enter" | "open-below" | "open-above"
): number {
  const point = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  if (action === "enter") return point;
  const lineStart = text.lastIndexOf("\n", Math.max(0, point - 1)) + 1;
  const newline = text.indexOf("\n", point);
  let lineEnd = newline < 0 ? text.length : newline;
  if (lineEnd > lineStart && text.charAt(lineEnd - 1) === "\r") lineEnd -= 1;
  if (action === "open-below") return lineEnd;
  let first = lineStart;
  while (first < lineEnd && (text.charAt(first) === " " || text.charAt(first) === "\t")) first += 1;
  return first;
}

export interface IndentQueryMatchLike {
  patternIndex: number;
  captures: readonly {
    name: string;
    node: {
      startIndex: number;
      endIndex: number;
      startPosition: { row: number; column: number };
      endPosition: { row: number; column: number };
    };
  }[];
}

export interface IndentQueryNodeLike {
  readonly parent: IndentQueryNodeLike | null;
  descendantForIndex(start: number, end?: number): IndentQueryNodeLike | null;
}

export interface IndentQueryLike {
  matches(node: IndentQueryNodeLike, options: { maxStartDepth: number }): readonly IndentQueryMatchLike[];
}

/** A tiny window selects the local syntax descendant without scanning the document. */
export function indentQueryRange(documentLength: number, offset: number): IndentQueryRange | null {
  const length = Math.max(0, Math.trunc(documentLength));
  if (length === 0) return null;
  const point = Math.max(0, Math.min(length, Math.trunc(offset)));
  const startIndex = Math.max(0, Math.min(length - 1, point === 0 ? 0 : point - 1));
  return { startIndex, endIndex: Math.min(length, startIndex + 1) };
}

/**
 * Run only patterns rooted at the local node and each ancestor. This is proportional to
 * syntax depth, retains complete multi-capture matches (notably @align + @anchor), and
 * avoids a whole-tree query on every newline.
 */
export function queryIndentCaptures(
  query: IndentQueryLike,
  root: IndentQueryNodeLike,
  documentLength: number,
  offset: number
): IndentCapture[] {
  const range = indentQueryRange(documentLength, offset);
  let node: IndentQueryNodeLike | null = range
    ? root.descendantForIndex(range.startIndex, range.endIndex) ?? root
    : root;
  const matches: IndentQueryMatchLike[] = [];
  while (node) {
    matches.push(...query.matches(node, { maxStartDepth: 0 }));
    node = node.parent;
  }
  return collectIndentCaptures(matches);
}

/** Flatten complete query matches so an alignment anchor outside the local window is retained. */
export function collectIndentCaptures(matches: readonly IndentQueryMatchLike[]): IndentCapture[] {
  return matches.flatMap((match) => match.captures.flatMap((capture) => {
    const name = capture.name.replace(/^@/, "");
    if (name !== "indent" && name !== "outdent" && name !== "align" && name !== "anchor" && name !== "opaque") return [];
    return [{
      name,
      from: capture.node.startIndex,
      to: capture.node.endIndex,
      startRow: capture.node.startPosition.row,
      endRow: capture.node.endPosition.row,
      startColumn: capture.node.startPosition.column,
      patternIndex: match.patternIndex
    } satisfies IndentCapture];
  }));
}

/** Resolve the supported captures at an insertion offset without a runtime-specific Tree API. */
export function resolveIndentCaptures(captures: readonly IndentCapture[], offset: number): IndentCaptureAnswer {
  const active = captures.filter((capture) => capture.from <= offset && offset <= capture.to);
  if (active.some((capture) => capture.name === "opaque")) return { indent: 0, outdent: 0, opaque: true };
  const indent = active.filter((capture) => capture.name === "indent" && capture.startRow !== capture.endRow).length;
  const outdent = active.filter((capture) => capture.name === "outdent" && offset <= capture.to).length;
  const aligns = active.filter((capture) => capture.name === "align");
  let alignColumn: number | undefined;
  for (const align of aligns) {
    const anchors = captures.filter((capture) => capture.name === "anchor" && capture.patternIndex === align.patternIndex);
    if (anchors.length === 1) alignColumn = anchors[0].startColumn;
  }
  return { indent, outdent, ...(alignColumn === undefined ? {} : { alignColumn }) };
}
