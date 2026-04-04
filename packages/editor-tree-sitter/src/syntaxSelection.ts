import type { SyntaxSelectionRange } from "@wx/editor-language";

export interface SyntaxNodeLike {
  startIndex: number;
  endIndex: number;
  parent: SyntaxNodeLike | null;
  namedChildren?: readonly SyntaxNodeLike[];
}

function namedChildrenOf(node: SyntaxNodeLike): readonly SyntaxNodeLike[] {
  return node.namedChildren ?? [];
}

function clampRange(range: SyntaxSelectionRange): SyntaxSelectionRange {
  return {
    from: Math.min(range.from, range.to),
    to: Math.max(range.from, range.to)
  };
}

function findDeepestNamedNodeContaining(node: SyntaxNodeLike, range: SyntaxSelectionRange): SyntaxNodeLike | null {
  if (node.startIndex > range.from || node.endIndex < range.to) {
    return null;
  }

  for (const child of namedChildrenOf(node)) {
    const match = findDeepestNamedNodeContaining(child, range);
    if (match) {
      return match;
    }
  }

  return node;
}

function findChildContainingOffset(node: SyntaxNodeLike, offset: number): SyntaxNodeLike | null {
  for (const child of namedChildrenOf(node)) {
    if (child.startIndex <= offset && child.endIndex > offset) {
      return child;
    }
  }

  return null;
}

export function expandSyntaxSelection(root: SyntaxNodeLike, selection: SyntaxSelectionRange): SyntaxSelectionRange | null {
  const range = clampRange(selection);
  const match = findDeepestNamedNodeContaining(root, range);

  if (!match) {
    return null;
  }

  let node: SyntaxNodeLike | null = match;
  while (node && node.startIndex === range.from && node.endIndex === range.to) {
    node = node.parent;
  }

  if (!node) {
    return null;
  }

  return { from: node.startIndex, to: node.endIndex };
}

export function shrinkSyntaxSelection(
  root: SyntaxNodeLike,
  selection: SyntaxSelectionRange,
  activeOffset: number
): SyntaxSelectionRange | null {
  const range = clampRange(selection);
  const cursorSelection = { from: activeOffset, to: activeOffset + 1 };

  if (range.from === cursorSelection.from && range.to === cursorSelection.to) {
    return null;
  }

  const match = findDeepestNamedNodeContaining(root, range);

  if (!match || match.startIndex !== range.from || match.endIndex !== range.to) {
    return cursorSelection;
  }

  let child = findChildContainingOffset(match, activeOffset);
  while (child && child.startIndex === match.startIndex && child.endIndex === match.endIndex) {
    child = findChildContainingOffset(child, activeOffset);
  }

  if (!child) {
    return cursorSelection;
  }

  return { from: child.startIndex, to: child.endIndex };
}
