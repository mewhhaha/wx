import type { TextChange, TextDocument } from "@mewhhaha/wx-core";
import type { CommentToggler, LanguageDocumentSnapshot, SyntaxSelectionRange } from "@mewhhaha/wx-language";

const LINE_COMMENT_PREFIX = "// ";
const BLOCK_COMMENT_OPEN = "/* ";
const BLOCK_COMMENT_CLOSE = " */";

function clampSelection(document: TextDocument, selection: SyntaxSelectionRange): SyntaxSelectionRange {
  const from = Math.max(0, Math.min(document.length, selection.from));
  const to = Math.max(from, Math.min(document.length, selection.to));
  return { from, to };
}

function selectionEndOffset(selection: SyntaxSelectionRange): number {
  return selection.to > selection.from ? selection.to - 1 : selection.to;
}

function touchedLines(document: TextDocument, selection: SyntaxSelectionRange): ReturnType<TextDocument["lineAt"]>[] {
  const normalized = clampSelection(document, selection);
  const startLine = document.positionAt(normalized.from).line;
  const endLine = document.positionAt(selectionEndOffset(normalized)).line;
  const lines = [];

  for (let line = startLine; line <= endLine; line += 1) {
    lines.push(document.lineAt(line));
  }

  return lines;
}

function isBlankLine(text: string): boolean {
  return text.trim().length === 0;
}

function indentationLength(text: string): number {
  return text.match(/^\s*/)?.[0].length ?? 0;
}

function isLineCommented(text: string): boolean {
  if (isBlankLine(text)) {
    return true;
  }

  const indent = indentationLength(text);
  return text.slice(indent).startsWith("//");
}

function selectionSpansWholeLines(document: TextDocument, selection: SyntaxSelectionRange): boolean {
  const normalized = clampSelection(document, selection);
  const lines = touchedLines(document, normalized);
  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];

  if (!firstLine || !lastLine) {
    return false;
  }

  return normalized.from <= firstLine.start && normalized.to >= lastLine.end;
}

function shouldUseLineComments(document: TextDocument, selection: SyntaxSelectionRange): boolean {
  const normalized = clampSelection(document, selection);

  if (touchedLines(document, normalized).length > 1) {
    return true;
  }

  if (normalized.to - normalized.from <= 1) {
    return true;
  }

  return selectionSpansWholeLines(document, normalized);
}

function toggleLineComments(document: TextDocument, selection: SyntaxSelectionRange): readonly TextChange[] {
  const lines = touchedLines(document, selection);

  if (lines.length === 0) {
    return [];
  }

  const shouldUncomment = lines.every((line) => isLineCommented(line.text));
  const changes: TextChange[] = [];

  for (const line of lines) {
    if (isBlankLine(line.text)) {
      continue;
    }

    const indent = indentationLength(line.text);
    const markerOffset = line.start + indent;

    if (shouldUncomment) {
      const slice = document.slice(markerOffset, Math.min(document.length, markerOffset + 3));
      const removeLength = slice.startsWith("// ") ? 3 : slice.startsWith("//") ? 2 : 0;

      if (removeLength > 0) {
        changes.push({ from: markerOffset, to: markerOffset + removeLength, insert: "" });
      }

      continue;
    }

    changes.push({ from: markerOffset, to: markerOffset, insert: LINE_COMMENT_PREFIX });
  }

  return changes;
}

function blockRangeForSelection(document: TextDocument, selection: SyntaxSelectionRange): SyntaxSelectionRange {
  const normalized = clampSelection(document, selection);

  if (normalized.to > normalized.from) {
    return normalized;
  }

  const line = document.lineAt(document.positionAt(normalized.from).line);
  return { from: line.start, to: line.end };
}

function trimOuterWhitespace(document: TextDocument, selection: SyntaxSelectionRange): SyntaxSelectionRange {
  let from = selection.from;
  let to = selection.to;

  while (from < to && /\s/.test(document.slice(from, from + 1))) {
    from += 1;
  }

  while (to > from && /\s/.test(document.slice(to - 1, to))) {
    to -= 1;
  }

  return { from, to };
}

function toggleBlockComments(document: TextDocument, selection: SyntaxSelectionRange): readonly TextChange[] {
  const blockRange = trimOuterWhitespace(document, blockRangeForSelection(document, selection));
  const selectedText = document.slice(blockRange.from, blockRange.to);

  if (selectedText.startsWith("/*") && selectedText.endsWith("*/") && selectedText.length >= 4) {
    const openEnd = selectedText.startsWith("/* ") ? blockRange.from + 3 : blockRange.from + 2;
    const closeStart = selectedText.endsWith(" */") ? blockRange.to - 3 : blockRange.to - 2;
    return [
      { from: closeStart, to: blockRange.to, insert: "" },
      { from: blockRange.from, to: openEnd, insert: "" }
    ];
  }

  if (
    blockRange.from >= 2 &&
    blockRange.to + 2 <= document.length &&
    document.slice(blockRange.from - 2, blockRange.from) === "/*" &&
    document.slice(blockRange.to, blockRange.to + 2) === "*/"
  ) {
    return [
      { from: blockRange.to, to: blockRange.to + 2, insert: "" },
      { from: blockRange.from - 2, to: blockRange.from, insert: "" }
    ];
  }

  return [
    { from: blockRange.to, to: blockRange.to, insert: BLOCK_COMMENT_CLOSE },
    { from: blockRange.from, to: blockRange.from, insert: BLOCK_COMMENT_OPEN }
  ];
}

export function createWgslCommentToggler(): CommentToggler {
  return {
    async toggleComments(context: { document: LanguageDocumentSnapshot; selection: SyntaxSelectionRange }) {
      return shouldUseLineComments(context.document.doc, context.selection)
        ? toggleLineComments(context.document.doc, context.selection)
        : toggleBlockComments(context.document.doc, context.selection);
    },
    async toggleBlockComments(context: { document: LanguageDocumentSnapshot; selection: SyntaxSelectionRange }) {
      return toggleBlockComments(context.document.doc, context.selection);
    },
    async toggleLineComments(context: { document: LanguageDocumentSnapshot; selection: SyntaxSelectionRange }) {
      return toggleLineComments(context.document.doc, context.selection);
    }
  };
}

export const __internal = {
  toggleLineComments,
  toggleBlockComments,
  shouldUseLineComments
};
