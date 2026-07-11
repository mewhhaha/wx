import { describe, expect, it } from "vitest";

import {
  PieceTableTextDocument,
  StringTextDocument,
  createTextDocument,
  getDocumentRetentionStats,
  getDocumentStorageStats,
  mapOffsetThroughChanges,
  type TextChange,
  type TextDocument
} from "./document";
import {
  applyTransaction,
  createEditorState,
  createSelectionSet,
  normalizeSelection,
  type EditorMode,
  type EditorState,
  type SelectionRange
} from "./state";

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function randomInteger(random: () => number, maximumExclusive: number): number {
  return maximumExclusive <= 1 ? 0 : random() % maximumExclusive;
}

const INSERTS = ["", "x", "\n", "\r\n", "β", "😀", " \n"] as const;

function randomChanges(random: () => number, length: number): TextChange[] {
  const changes: TextChange[] = [];
  const desired = 1 + randomInteger(random, 3);
  let availableFrom = 0;

  for (let index = 0; index < desired && availableFrom <= length; index += 1) {
    const from = availableFrom + randomInteger(random, length - availableFrom + 1);
    const to = from + randomInteger(random, Math.min(4, length - from) + 1);
    let insert = INSERTS[randomInteger(random, INSERTS.length)];
    if (from === to && insert.length === 0) {
      insert = "x";
    }
    changes.push({ from, to, insert });
    availableFrom = to;
  }

  // Simultaneous edits are deliberately unordered at the API boundary.
  for (let index = changes.length - 1; index > 0; index -= 1) {
    const target = randomInteger(random, index + 1);
    [changes[index], changes[target]] = [changes[target], changes[index]];
  }
  return changes;
}

function randomSelection(
  random: () => number,
  doc: TextDocument,
  mode: EditorMode
): EditorState["selection"] {
  const maximum = mode === "insert" ? doc.length : Math.max(0, doc.length - 1);
  const ranges: SelectionRange[] = [];
  const count = 1 + randomInteger(random, 3);
  for (let index = 0; index < count; index += 1) {
    const anchor = randomInteger(random, maximum + 1);
    const head = randomInteger(random, maximum + 1);
    ranges.push({ anchor, head, preferredColumn: randomInteger(random, 4) === 0 ? randomInteger(random, 8) : null });
  }
  return normalizeSelection(doc, createSelectionSet(ranges, randomInteger(random, ranges.length)), mode);
}

function withDocument(doc: TextDocument, selection: EditorState["selection"], mode: EditorMode): EditorState {
  return {
    ...createEditorState({ mode }),
    doc,
    selection,
    mode
  };
}

function expectEquivalent(reference: TextDocument, actual: TextDocument): void {
  expect(actual.text).toBe(reference.text);
  expect(actual.length).toBe(reference.length);
  expect(actual.lineCount).toBe(reference.lineCount);

  for (let target = -2; target <= reference.length + 2; target += 1) {
    expect(actual.charAt(target), `charAt(${target})`).toBe(reference.charAt(target));
    expect(actual.positionAt(target), `positionAt(${target})`).toEqual(reference.positionAt(target));
  }

  for (let index = -2; index <= reference.lineCount + 1; index += 1) {
    const expectedLine = reference.lineAt(index);
    expect(actual.lineAt(index), `lineAt(${index})`).toEqual(expectedLine);
    for (const column of [-2, 0, 1, expectedLine.end - expectedLine.start, expectedLine.end - expectedLine.start + 2]) {
      expect(actual.offsetAt({ line: index, column }), `offsetAt(${index}, ${column})`).toBe(
        reference.offsetAt({ line: index, column })
      );
    }
  }

  for (let from = 0; from <= reference.length; from += Math.max(1, Math.floor(reference.length / 7))) {
    const to = Math.min(reference.length, from + 5);
    expect(actual.slice(from, to), `slice(${from}, ${to})`).toBe(reference.slice(from, to));
  }
}

describe("piece-table text document", () => {
  it("preserves UTF-16 offsets, CRLF, mixed endings, and an empty final line", () => {
    const text = "😀\r\nalpha\rbravo\n";
    const reference = new StringTextDocument(text);
    const actual = createTextDocument(text);

    expectEquivalent(reference, actual);
    expect(actual.lineCount).toBe(3);
    expect(actual.lineAt(0).text).toBe("😀\r");
    expect(actual.lineAt(1).text).toBe("alpha\rbravo");
    expect(actual.lineAt(2)).toEqual({ index: 2, start: text.length, end: text.length, text: "" });
    expect(actual.charAt(0)).toBe("\ud83d");
    expect(actual.charAt(1)).toBe("\ude00");
  });

  it("keeps the prior-piece line start when later pieces contain the target", () => {
    const reference = new StringTextDocument("a\nbXc");
    const actual = createTextDocument("a\nbc").applyChanges([{ from: 3, to: 3, insert: "X" }]);

    expectEquivalent(reference, actual);
    expect(actual.positionAt(4)).toEqual({ line: 1, column: 2 });
  });

  it("orders non-overlapping multi-edits and rejects intersecting replacements", () => {
    const changes = [
      { from: 4, to: 6, insert: "Z" },
      { from: 3, to: 3, insert: "!" },
      { from: 1, to: 3, insert: "XY" }
    ];
    const document = createTextDocument("abcdef");

    expect(document.applyChanges(changes).text).toBe("aXY!dZ");
    expect(() =>
      document.applyChanges([
        { from: 1, to: 4, insert: "" },
        { from: 3, to: 5, insert: "" }
      ])
    ).toThrowError(new RangeError("Text changes must not overlap"));
  });

  it("maps selections consistently through unordered simultaneous edits", () => {
    const changes = [
      { from: 5, to: 5, insert: "b" },
      { from: 0, to: 0, insert: "a" }
    ];

    expect(mapOffsetThroughChanges(5, changes, "left")).toBe(6);
    expect(mapOffsetThroughChanges(5, changes, "right")).toBe(7);
    expect(mapOffsetThroughChanges(6, changes, "left")).toBe(8);
  });

  it("matches the string oracle through deterministic randomized edits and selections", () => {
    const random = createRandom(0x51a7e5ed);
    let reference: TextDocument = new StringTextDocument("😀\r\nalpha\nbeta\rfinal\n");
    let actual = createTextDocument(reference.text);

    for (let iteration = 0; iteration < 400; iteration += 1) {
      const mode: EditorMode = randomInteger(random, 2) === 0 ? "normal" : "insert";
      const referenceSelection = randomSelection(random, reference, mode);
      const actualSelection = normalizeSelection(actual, referenceSelection, mode);
      const changes = randomChanges(random, reference.length);
      const referenceNext = applyTransaction(withDocument(reference, referenceSelection, mode), { changes });
      const actualNext = applyTransaction(withDocument(actual, actualSelection, mode), { changes });

      expect(actualNext.selection, `selection after iteration ${iteration}`).toEqual(referenceNext.selection);
      expectEquivalent(referenceNext.doc, actualNext.doc);
      reference = referenceNext.doc;
      actual = actualNext.doc;
    }

    expect(actual).toBeInstanceOf(PieceTableTextDocument);
  });

  it("proves a 20,000-line one-character edit scans and allocates constant storage", () => {
    const text = Array.from({ length: 20_000 }, (_, index) => `const value${index} = ${index};`).join("\n");
    const document = createTextDocument(text);
    const target = Math.floor(document.length / 2);

    expect(getDocumentStorageStats(document).textMaterialized).toBe(false);
    const edited = document.applyChanges([{ from: target, to: target, insert: "x" }]);
    expect(edited.charAt(target)).toBe("x");
    expect(edited.lineAt(10_000).index).toBe(10_000);

    const stats = getDocumentStorageStats(edited);
    expect(stats).toMatchObject({
      kind: "piece-table",
      pieceCount: 3,
      sourceBufferCount: 2,
      lastEditScannedCodeUnits: 1,
      lastEditTouchedPieces: 2,
      lastEditCreatedPieces: 3,
      lastEditIndexedBytes: 0,
      textMaterialized: false
    });
    expect(stats.lastEditMetadataBytes).toBeLessThan(512);

    const retained = getDocumentRetentionStats([document, edited]);
    expect(retained.documentCount).toBe(2);
    expect(retained.uniqueSourceBufferCount).toBe(2);
    expect(retained.sourceTextBytes).toBe((text.length + 1) * 2);
    expect(getDocumentStorageStats(edited).textMaterialized).toBe(false);
  });
});
