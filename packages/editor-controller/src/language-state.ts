import { mapOffsetThroughChanges, type EditorState, type TextChange } from "@wx/editor-core";
import type { EditorDiagnostic, HighlightSpan } from "@wx/editor-language";
import type { EditorLineChange, EditorLineChangeState } from "./types";

export function buildHighlightCache(doc: EditorState["doc"], spans: readonly HighlightSpan[]): Map<number, HighlightSpan[]> {
  const cache = new Map<number, HighlightSpan[]>();

  for (const span of spans) {
    if (span.to <= span.from) {
      continue;
    }

    const startLine = doc.positionAt(span.from).line;
    const endLine = doc.positionAt(span.to - 1).line;

    for (let line = startLine; line <= endLine; line += 1) {
      const lineInfo = doc.lineAt(line);
      const from = Math.max(span.from, lineInfo.start);
      const to = Math.min(span.to, lineInfo.end);

      if (to <= from) {
        continue;
      }

      const entry = cache.get(line);
      const clipped = { from, to, role: span.role };

      if (entry) {
        entry.push(clipped);
      } else {
        cache.set(line, [clipped]);
      }
    }
  }

  return cache;
}

export function spansEqual(left: readonly HighlightSpan[], right: readonly HighlightSpan[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((span, index) => {
    const other = right[index];
    return !!other && span.from === other.from && span.to === other.to && span.role === other.role;
  });
}

export function highlightMapsEqual(
  left: ReadonlyMap<number, readonly HighlightSpan[]>,
  right: ReadonlyMap<number, readonly HighlightSpan[]>
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [line, spans] of left) {
    const other = right.get(line);
    if (!other || !spansEqual(spans, other)) {
      return false;
    }
  }

  return true;
}

export function buildDiagnosticsCache(doc: EditorState["doc"], diagnostics: readonly EditorDiagnostic[]): Map<number, EditorDiagnostic[]> {
  const nextByLine = new Map<number, EditorDiagnostic[]>();

  for (const diagnostic of diagnostics) {
    const safeFrom = Math.max(0, Math.min(doc.length, diagnostic.from));
    const safeTo = Math.max(safeFrom, Math.min(doc.length, Math.max(diagnostic.from + 1, diagnostic.to)));
    const startLine = doc.positionAt(safeFrom).line;
    const endLine = doc.positionAt(Math.max(safeFrom, safeTo - 1)).line;

    for (let line = startLine; line <= endLine; line += 1) {
      const entry = nextByLine.get(line);

      if (entry) {
        entry.push({ ...diagnostic, from: safeFrom, to: safeTo });
      } else {
        nextByLine.set(line, [{ ...diagnostic, from: safeFrom, to: safeTo }]);
      }
    }
  }

  return nextByLine;
}

export function buildLineChangesMap(changes: readonly EditorLineChange[]): Map<number, EditorLineChangeState> {
  const next = new Map<number, EditorLineChangeState>();

  for (const change of changes) {
    if (change.line < 0 || !Number.isFinite(change.line)) {
      continue;
    }

    if (change.kind === "deleted") {
      const previous = next.get(change.line) ?? { kind: null, deleted: false };
      next.set(change.line, { ...previous, deleted: true });
      continue;
    }

    const previous = next.get(change.line) ?? { kind: null, deleted: false };
    next.set(change.line, {
      kind: change.kind === "modified" || previous.kind === "modified" ? "modified" : change.kind,
      deleted: previous.deleted
    });
  }

  return next;
}

export function diagnosticsEqual(left: readonly EditorDiagnostic[], right: readonly EditorDiagnostic[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((diagnostic, index) => {
    const other = right[index];
    return (
      !!other &&
      diagnostic.from === other.from &&
      diagnostic.to === other.to &&
      diagnostic.severity === other.severity &&
      diagnostic.message === other.message &&
      diagnostic.source === other.source
    );
  });
}

export function lineChangesEqual(left: readonly EditorLineChange[], right: readonly EditorLineChange[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((change, index) => {
    const other = right[index];
    return !!other && change.line === other.line && change.kind === other.kind;
  });
}

export function remapHighlightSpans(
  doc: EditorState["doc"],
  spans: readonly HighlightSpan[],
  changes: readonly TextChange[]
): HighlightSpan[] {
  const next: HighlightSpan[] = [];

  for (const span of spans) {
    const originalLength = Math.max(0, span.to - span.from);
    const hasOverlappingChange = changes.some((change) => change.from < span.to && change.to > span.from);
    const startAffinity = changes.some(
      (change) => change.from === span.from && change.to === span.from && change.insert.length > 0
    )
      ? "right"
      : "left";
    const from = Math.max(0, Math.min(doc.length, mapOffsetThroughChanges(span.from, changes, startAffinity)));
    const mappedTo = Math.max(from, Math.min(doc.length, mapOffsetThroughChanges(span.to, changes, "right")));
    const to = hasOverlappingChange ? mappedTo : Math.max(from, Math.min(doc.length, from + originalLength));

    if (to <= from) {
      continue;
    }

    next.push({
      from,
      to,
      role: span.role
    });
  }

  return next;
}
