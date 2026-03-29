import { describe, expect, it } from "vitest";

import { expandSyntaxSelection, shrinkSyntaxSelection, type SyntaxNodeLike } from "./syntaxSelection";

function node(
  startIndex: number,
  endIndex: number,
  namedChildren: SyntaxNodeLike[] = []
): SyntaxNodeLike {
  const current: SyntaxNodeLike = {
    startIndex,
    endIndex,
    parent: null,
    namedChildren
  };

  for (const child of namedChildren) {
    child.parent = current;
  }

  return current;
}

describe("syntax selection", () => {
  it("expands from a character to the deepest named node and then to its parent", () => {
    const tree = node(0, 18, [
      node(0, 6, [node(0, 6)]),
      node(7, 18, [node(9, 14)])
    ]);

    expect(expandSyntaxSelection(tree, { from: 10, to: 11 })).toEqual({ from: 9, to: 14 });
    expect(expandSyntaxSelection(tree, { from: 9, to: 14 })).toEqual({ from: 7, to: 18 });
  });

  it("shrinks to the child on the active cursor path", () => {
    const tree = node(0, 18, [
      node(0, 6),
      node(7, 18, [node(9, 14), node(16, 17)])
    ]);

    expect(shrinkSyntaxSelection(tree, { from: 7, to: 18 }, 10)).toEqual({ from: 9, to: 14 });
    expect(shrinkSyntaxSelection(tree, { from: 7, to: 18 }, 16)).toEqual({ from: 16, to: 17 });
  });

  it("returns null when the current selection is not a syntax-node span", () => {
    const tree = node(0, 18, [node(0, 6), node(7, 18, [node(9, 14)])]);

    expect(shrinkSyntaxSelection(tree, { from: 8, to: 18 }, 10)).toEqual({ from: 10, to: 11 });
  });

  it("falls back to the cursor when there is no smaller child selection", () => {
    const tree = node(0, 18, [node(0, 6), node(7, 18, [node(9, 14)])]);

    expect(shrinkSyntaxSelection(tree, { from: 9, to: 14 }, 10)).toEqual({ from: 10, to: 11 });
    expect(shrinkSyntaxSelection(tree, { from: 10, to: 11 }, 10)).toBeNull();
  });
});
