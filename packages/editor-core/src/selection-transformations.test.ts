import { describe, expect, it } from "vitest";

import { type TextChange } from "./document";
import {
  alignSelectionColumns,
  applyFormatterChanges,
  collapseSelections,
  decrementSelections,
  ensureForwardSelections,
  flipSelectionDirection,
  incrementSelections,
  indentSelections,
  joinSelectionLines,
  keepPrimarySelection,
  mergeConsecutiveSelections,
  mergeOverlappingSelections,
  outdentSelections,
  removePrimarySelection,
  replaceSelectionCharacters,
  rotatePrimarySelection,
  splitSelectionsByRegex,
  splitSelectionsOnNewline,
  transformSelectionCase,
  trimSelections
} from "./selection-transformations";
import {
  applyTransaction,
  createEditorState,
  createSelectionSet,
  getSelectionRanges,
  type EditorMode,
  type EditorState,
  type SelectionRange,
  type Transaction
} from "./state";

function state(
  value: string,
  ranges: Array<[number, number]>,
  primaryIndex = 0,
  mode: EditorMode = "normal"
): EditorState {
  return createEditorState({
    value,
    mode,
    selection: createSelectionSet(
      ranges.map(([anchor, head]) => ({ anchor, head, preferredColumn: null })),
      primaryIndex
    )
  });
}

function fullSelection(value: string, reversed = false): EditorState {
  const edge = Math.max(0, value.length - 1);
  return state(value, [reversed ? [edge, 0] : [0, edge]]);
}

function apply(source: EditorState, transaction: Transaction): EditorState {
  return applyTransaction(source, transaction);
}

function selectedTexts(source: EditorState): string[] {
  return getSelectionRanges(source).map(({ from, to }) => source.doc.slice(from, to));
}

function direction(range: SelectionRange): "forward" | "reversed" {
  return range.anchor <= range.head ? "forward" : "reversed";
}

function expectSafeTransaction(source: EditorState, transaction: Transaction): EditorState {
  const changes = [...(transaction.changes ?? [])];
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]!;
    expect(change.from).toBeGreaterThanOrEqual(0);
    expect(change.to).toBeGreaterThanOrEqual(change.from);
    expect(change.to).toBeLessThanOrEqual(source.doc.length);
    if (index > 0) {
      expect(changes[index - 1]!.to).toBeLessThanOrEqual(change.from);
    }
  }

  const next = apply(source, transaction);
  expect(next.selection.ranges.length).toBeGreaterThan(0);
  expect(next.selection.primaryIndex).toBeGreaterThanOrEqual(0);
  expect(next.selection.primaryIndex).toBeLessThan(next.selection.ranges.length);
  for (const range of next.selection.ranges) {
    expect(range.anchor).toBeGreaterThanOrEqual(0);
    expect(range.head).toBeGreaterThanOrEqual(0);
    if (next.mode === "insert") {
      expect(range.anchor).toBeLessThanOrEqual(next.doc.length);
      expect(range.head).toBeLessThanOrEqual(next.doc.length);
    } else if (next.doc.length > 0) {
      expect(range.anchor).toBeLessThan(next.doc.length);
      expect(range.head).toBeLessThan(next.doc.length);
    }
  }
  const normalizedRanges = getSelectionRanges(next);
  for (let index = 1; index < normalizedRanges.length; index += 1) {
    const previous = normalizedRanges[index - 1]!;
    const current = normalizedRanges[index]!;
    expect(previous.to).toBeLessThanOrEqual(current.from);
  }
  return next;
}

interface ModelRange {
  anchor: number;
  head: number;
}

interface ModelState {
  text: string;
  ranges: ModelRange[];
  primaryIndex: number;
}

interface ModelStep {
  state: ModelState;
  changes: TextChange[];
}

function modelOffsets(range: ModelRange): { from: number; to: number } {
  return {
    from: Math.min(range.anchor, range.head),
    to: Math.max(range.anchor, range.head) + 1
  };
}

function normalizeModel(model: ModelState): ModelState {
  const lastOffset = Math.max(0, model.text.length - 1);
  const sourcePrimary = Math.max(0, Math.min(model.primaryIndex, model.ranges.length - 1));
  const entries = model.ranges
    .map((range, index) => {
      const normalized = {
        anchor: Math.max(0, Math.min(lastOffset, range.anchor)),
        head: Math.max(0, Math.min(lastOffset, range.head))
      };
      return {
        range: normalized,
        ...modelOffsets(normalized),
        index,
        primary: index === sourcePrimary
      };
    })
    .sort(
      (left, right) =>
        left.from - right.from ||
        left.to - right.to ||
        left.range.anchor - right.range.anchor ||
        left.range.head - right.range.head ||
        left.index - right.index
    );
  const deduped: typeof entries = [];
  for (const entry of entries) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.from === entry.from && previous.to === entry.to) {
      if (entry.primary) {
        previous.range = entry.range;
        previous.primary = true;
      }
    } else {
      deduped.push(entry);
    }
  }
  return {
    text: model.text,
    ranges: deduped.map((entry) => entry.range),
    primaryIndex: Math.max(0, deduped.findIndex((entry) => entry.primary))
  };
}

function modelFromEditor(source: EditorState): ModelState {
  return {
    text: source.doc.text,
    ranges: source.selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
    primaryIndex: source.selection.primaryIndex
  };
}

function mergeModel(model: ModelState, adjacent: boolean): ModelState {
  const groups: Array<{
    from: number;
    to: number;
    representative: ModelRange;
    representativeIndex: number;
    containsPrimary: boolean;
  }> = [];
  model.ranges.forEach((range, index) => {
    const offsets = modelOffsets(range);
    const previous = groups[groups.length - 1];
    if (previous && (adjacent ? offsets.from <= previous.to : offsets.from < previous.to)) {
      previous.to = Math.max(previous.to, offsets.to);
      if (index === model.primaryIndex) {
        previous.representative = range;
        previous.representativeIndex = index;
        previous.containsPrimary = true;
      }
    } else {
      groups.push({
        ...offsets,
        representative: range,
        representativeIndex: index,
        containsPrimary: index === model.primaryIndex
      });
    }
  });
  return {
    text: model.text,
    ranges: groups.map((group) =>
      group.representative.anchor <= group.representative.head
        ? { anchor: group.from, head: group.to - 1 }
        : { anchor: group.to - 1, head: group.from }
    ),
    primaryIndex: Math.max(0, groups.findIndex((group) => group.containsPrimary))
  };
}

function applyModelChanges(text: string, changes: readonly TextChange[]): string {
  let cursor = 0;
  let result = "";
  for (const change of changes) {
    result += text.slice(cursor, change.from);
    result += change.insert;
    cursor = change.to;
  }
  return result + text.slice(cursor);
}

function modelReplace(model: ModelState): ModelStep {
  const merged = mergeModel(model, false);
  const changes = merged.ranges.map((range) => {
    const { from, to } = modelOffsets(range);
    return { from, to, insert: "X".repeat(to - from) };
  });
  return { state: { ...merged, text: applyModelChanges(model.text, changes) }, changes };
}

function toggleAscii(text: string): string {
  return Array.from(text, (character) =>
    /[a-z]/.test(character)
      ? character.toUpperCase()
      : /[A-Z]/.test(character)
        ? character.toLowerCase()
        : character
  ).join("");
}

function modelToggleCase(model: ModelState): ModelStep {
  const merged = mergeModel(model, false);
  const changes = merged.ranges.map((range) => {
    const { from, to } = modelOffsets(range);
    return { from, to, insert: toggleAscii(model.text.slice(from, to)) };
  });
  return { state: { ...merged, text: applyModelChanges(model.text, changes) }, changes };
}

function modelInsert(model: ModelState, offset: number): ModelStep {
  const change = { from: offset, to: offset, insert: "!" };
  const ranges = model.ranges.map((range) => {
    const { from, to } = modelOffsets(range);
    const nextFrom = from + (offset < from ? 1 : 0);
    const nextTo = to + (offset < to ? 1 : 0);
    return range.anchor <= range.head
      ? { anchor: nextFrom, head: nextTo - 1 }
      : { anchor: nextTo - 1, head: nextFrom };
  });
  return {
    state: normalizeModel({
      text: applyModelChanges(model.text, [change]),
      ranges,
      primaryIndex: model.primaryIndex
    }),
    changes: [change]
  };
}

function modelSelectionStep(
  model: ModelState,
  operation: "flip" | "forward" | "anchor" | "head" | "rotate-next" | "rotate-previous" | "remove"
): ModelStep {
  let next: ModelState;
  switch (operation) {
    case "flip":
      next = normalizeModel({
        ...model,
        ranges: model.ranges.map((range) => ({ anchor: range.head, head: range.anchor }))
      });
      break;
    case "forward":
      next = normalizeModel({
        ...model,
        ranges: model.ranges.map((range) => ({
          anchor: Math.min(range.anchor, range.head),
          head: Math.max(range.anchor, range.head)
        }))
      });
      break;
    case "anchor":
    case "head":
      next = normalizeModel({
        ...model,
        ranges: model.ranges.map((range) => {
          const point = range[operation];
          return { anchor: point, head: point };
        })
      });
      break;
    case "rotate-next":
      next = { ...model, primaryIndex: (model.primaryIndex + 1) % model.ranges.length };
      break;
    case "rotate-previous":
      next = {
        ...model,
        primaryIndex: (model.primaryIndex + model.ranges.length - 1) % model.ranges.length
      };
      break;
    case "remove": {
      if (model.ranges.length === 1) {
        next = model;
        break;
      }
      const ranges = model.ranges.filter((_, index) => index !== model.primaryIndex);
      next = {
        ...model,
        ranges,
        primaryIndex: Math.min(model.primaryIndex, ranges.length - 1)
      };
      break;
    }
  }
  return { state: next, changes: [] };
}

function expectModelState(actual: EditorState, expected: ModelState): void {
  expect(actual.doc.text).toBe(expected.text);
  expect(
    actual.selection.ranges.map(({ anchor, head }) => ({ anchor, head }))
  ).toEqual(expected.ranges);
  expect(actual.selection.primaryIndex).toBe(expected.primaryIndex);
  expect(actual.selection.ranges.map(direction)).toEqual(
    expected.ranges.map((range) => direction({ ...range, preferredColumn: null }))
  );
}

describe("selection algebra", () => {
  it("collapses, keeps, removes, flips, forwards, and rotates every primary position", () => {
    for (let primary = 0; primary < 3; primary += 1) {
      const source = state("abcdefgh", [[2, 0], [3, 4], [7, 6]], primary);
      expect(apply(source, keepPrimarySelection(source)).selection.ranges).toEqual([
        source.selection.ranges[primary]
      ]);

      const removed = apply(source, removePrimarySelection(source));
      expect(removed.selection.ranges).toHaveLength(2);
      expect(removed.selection.ranges).not.toContainEqual(source.selection.ranges[primary]);
      expect(apply(source, rotatePrimarySelection(source)).selection.primaryIndex).toBe(
        (primary + 1) % 3
      );
      expect(apply(source, rotatePrimarySelection(source, -1)).selection.primaryIndex).toBe(
        (primary + 2) % 3
      );
    }

    const reversed = state("abcd", [[3, 1]]);
    expect(apply(reversed, collapseSelections(reversed, "anchor")).selection.ranges[0]!.head).toBe(3);
    expect(apply(reversed, collapseSelections(reversed)).selection.ranges[0]!.head).toBe(1);
    expect(apply(reversed, flipSelectionDirection(reversed)).selection.ranges[0]).toMatchObject({
      anchor: 1,
      head: 3
    });
    expect(apply(reversed, ensureForwardSelections(reversed)).selection.ranges[0]).toMatchObject({
      anchor: 1,
      head: 3
    });
  });

  it("merges nested and transitive overlaps using the aggregate endpoint", () => {
    const source = state("abcdefghijklmnop", [[0, 9], [3, 2], [8, 12]], 1);
    const merged = apply(source, mergeOverlappingSelections(source));
    expect(getSelectionRanges(merged)).toEqual([{ from: 0, to: 13 }]);
    expect(merged.selection.ranges[0]).toMatchObject({ anchor: 12, head: 0 });
    expect(merged.selection.primaryIndex).toBe(0);
  });

  it("distinguishes overlap from adjacency", () => {
    const source = state("abcdef", [[0, 1], [2, 3], [5, 4]]);
    expect(getSelectionRanges(apply(source, mergeOverlappingSelections(source)))).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
      { from: 4, to: 6 }
    ]);
    expect(getSelectionRanges(apply(source, mergeConsecutiveSelections(source)))).toEqual([
      { from: 0, to: 6 }
    ]);
  });

  it("matches an independent interval-union model for forward/reversed ranges and all primaries", () => {
    const inputs: Array<Array<[number, number]>> = [
      [[0, 4], [2, 3], [4, 7]],
      [[7, 4], [3, 1], [9, 8]],
      [[0, 1], [2, 2], [5, 3]],
      [[6, 0], [2, 2], [4, 3]]
    ];
    let seed = 0x5eed1234;
    const randomOffset = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % 10;
    };
    for (let sample = 0; sample < 32; sample += 1) {
      inputs.push(Array.from({ length: 3 }, () => [randomOffset(), randomOffset()]));
    }

    for (const ranges of inputs) {
      for (let requestedPrimary = 0; requestedPrimary < ranges.length; requestedPrimary += 1) {
        const source = state("0123456789", ranges, requestedPrimary);
        for (const adjacent of [false, true]) {
          const intervals = getSelectionRanges(source).map((value, index) => ({ ...value, index }));
          const groups: Array<{ from: number; to: number; indices: number[] }> = [];
          for (const interval of intervals) {
            const last = groups[groups.length - 1];
            if (last && (adjacent ? interval.from <= last.to : interval.from < last.to)) {
              last.to = Math.max(last.to, interval.to);
              last.indices.push(interval.index);
            } else {
              groups.push({ from: interval.from, to: interval.to, indices: [interval.index] });
            }
          }

          const transaction = adjacent
            ? mergeConsecutiveSelections(source)
            : mergeOverlappingSelections(source);
          const actual = apply(source, transaction);
          expect(getSelectionRanges(actual)).toEqual(
            groups.map(({ from, to }) => ({ from, to }))
          );
          const primaryGroup = groups.findIndex((group) =>
            group.indices.includes(source.selection.primaryIndex)
          );
          expect(actual.selection.primaryIndex).toBe(primaryGroup);
          expect(direction(actual.selection.ranges[primaryGroup]!)).toBe(
            direction(source.selection.ranges[source.selection.primaryIndex]!)
          );
        }
      }
    }
  });
});

describe("selection splitting and trimming", () => {
  it("selects regex non-matches and never leaves the source selection", () => {
    const source = state("xxaa--bb--ccYY", [[2, 11]]);
    const split = apply(source, splitSelectionsByRegex(source, /--/));
    expect(selectedTexts(split)).toEqual(["aa", "bb", "cc"]);
    expect(getSelectionRanges(split).at(-1)!.to).toBe(12);

    const reversed = state("aa--bb", [[5, 0]]);
    const reversedSplit = apply(reversed, splitSelectionsByRegex(reversed, /--/g));
    expect(selectedTexts(reversedSplit)).toEqual(["aa", "bb"]);
    expect(reversedSplit.selection.ranges.map(direction)).toEqual(["reversed", "reversed"]);

    const overlapping = state("abcdefgh", [[0, 5], [7, 2]], 1);
    const normalized = apply(overlapping, splitSelectionsByRegex(overlapping, /,/));
    expect(getSelectionRanges(normalized)).toEqual([{ from: 0, to: 8 }]);
    expect(direction(normalized.selection.ranges[0]!)).toBe("reversed");
  });

  it("advances zero-width Unicode regexes by whole code points and terminates at the end", () => {
    const source = fullSelection("A😀B");
    const split = apply(source, splitSelectionsByRegex(source, /(?=😀)|(?=B)/gu));
    expect(selectedTexts(split)).toEqual(["A", "😀", "B"]);
    expect(getSelectionRanges(split)).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 3 },
      { from: 3, to: 4 }
    ]);

    const atEnd = apply(source, splitSelectionsByRegex(source, /$/gu));
    expect(selectedTexts(atEnd)).toEqual(["A😀B"]);
  });

  it("splits CRLF atomically and omits leading, consecutive, and trailing empty pieces", () => {
    const source = fullSelection("\r\naa\r\n\r\nbb\r\n");
    const split = apply(source, splitSelectionsOnNewline(source));
    expect(selectedTexts(split)).toEqual(["aa", "bb"]);
    expect(getSelectionRanges(split)).toEqual([
      { from: 2, to: 4 },
      { from: 8, to: 10 }
    ]);

    const reversed = fullSelection("aa\r\nbb", true);
    expect(
      apply(reversed, splitSelectionsOnNewline(reversed)).selection.ranges.map(direction)
    ).toEqual(["reversed", "reversed"]);

    const delimitersOnly = fullSelection("\r\n");
    expect(apply(delimitersOnly, splitSelectionsOnNewline(delimitersOnly)).selection).toEqual(
      delimitersOnly.selection
    );

    const partialCr = state("a\r\nb", [[0, 1]]);
    expect(selectedTexts(apply(partialCr, splitSelectionsOnNewline(partialCr)))).toEqual(["a\r"]);
    const partialLf = state("a\r\nb", [[2, 3]]);
    expect(selectedTexts(apply(partialLf, splitSelectionsOnNewline(partialLf)))).toEqual(["\nb"]);

    const overlapping = state("ab\ncdef", [[0, 5], [6, 3]], 1);
    const normalized = apply(overlapping, splitSelectionsOnNewline(overlapping));
    expect(getSelectionRanges(normalized)).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 7 }
    ]);
    expect(direction(normalized.selection.ranges[1]!)).toBe("reversed");
  });

  it("trims only bounds, removes whitespace-only ranges, and chooses a deterministic primary", () => {
    const value = "  abc  |   | def ";
    const source = state(value, [[6, 0], [8, 10], [12, 16]], 1);
    const trimmed = apply(source, trimSelections(source));
    expect(trimmed.doc.text).toBe(value);
    expect(selectedTexts(trimmed)).toEqual(["abc", "def"]);
    expect(trimmed.selection.ranges.map(direction)).toEqual(["reversed", "forward"]);
    expect(trimmed.selection.primaryIndex).toBe(1);

    const whitespace = fullSelection("   ");
    const fallback = apply(whitespace, trimSelections(whitespace));
    expect(fallback.doc.text).toBe("   ");
    expect(fallback.selection.ranges).toEqual([
      { anchor: 2, head: 2, preferredColumn: null }
    ]);

    const overlapping = state("  abcdef  ", [[0, 6], [9, 4]], 1);
    const normalized = apply(overlapping, trimSelections(overlapping));
    expect(getSelectionRanges(normalized)).toEqual([{ from: 2, to: 8 }]);
    expect(direction(normalized.selection.ranges[0]!)).toBe("reversed");

    const allWhitespace = state("  aa  bb  ", [[0, 1], [5, 4], [8, 9]]);
    for (let primary = 0; primary < allWhitespace.selection.ranges.length; primary += 1) {
      const sourceForPrimary = state("  aa  bb  ", [[0, 1], [5, 4], [8, 9]], primary);
      const activeHead = sourceForPrimary.selection.ranges[primary]!.head;
      const result = apply(sourceForPrimary, trimSelections(sourceForPrimary));
      expect(result.selection.ranges).toEqual([
        { anchor: activeHead, head: activeHead, preferredColumn: null }
      ]);
      expect(result.selection.primaryIndex).toBe(0);
    }

    const empty = state("abc", [[1, 1]], 0, "insert");
    expect(apply(empty, trimSelections(empty)).selection).toEqual(empty.selection);
  });
});

describe("text transformations", () => {
  it("joins only selected line breaks, preserves whitespace, and deduplicates overlap", () => {
    const source = fullSelection("one  \r\n  two\nthree");
    const transaction = joinSelectionLines(source);
    expect(transaction.changes).toEqual([
      { from: 5, to: 7, insert: " " },
      { from: 12, to: 13, insert: " " }
    ]);
    expect(apply(source, transaction).doc.text).toBe("one     two three");

    const overlapping = state("aa\nbb\ncc", [[0, 7], [2, 5]], 1);
    const overlappingTransaction = joinSelectionLines(overlapping, true);
    expect(overlappingTransaction.changes).toHaveLength(2);
    const joined = apply(overlapping, overlappingTransaction);
    expect(joined.doc.text).toBe("aa bb cc");
    expect(selectedTexts(joined)).toEqual([" ", " "]);
    expect(joined.selection.primaryIndex).toBe(0);

    expect(joinSelectionLines(fullSelection("one line"))).toEqual({});
    expect(joinSelectionLines(state("a\r\nb", [[0, 1]]))).toEqual({});
  });

  it("repeats one replacement grapheme per selected grapheme and rejects invalid operands", () => {
    const source = fullSelection("a😀e\u0301");
    const replaced = apply(source, replaceSelectionCharacters(source, "X"));
    expect(replaced.doc.text).toBe("XXX");
    expect(selectedTexts(replaced)).toEqual(["XXX"]);

    const combiningReplacement = apply(source, replaceSelectionCharacters(source, "o\u0308"));
    expect(combiningReplacement.doc.text).toBe("o\u0308o\u0308o\u0308");
    expect(replaceSelectionCharacters(source, "")).toEqual({});
    expect(replaceSelectionCharacters(source, "XY")).toEqual({});
    expect(replaceSelectionCharacters(source, "\ud800")).toEqual({});

    const empty = state("abc", [[1, 1]], 0, "insert");
    expect(replaceSelectionCharacters(empty, "X")).toEqual({});
  });

  it("expands partial UTF-16 selections to grapheme boundaries and merges the same cluster", () => {
    for (const offset of [1, 2]) {
      const source = state("x😀y", [[offset, offset]]);
      expect(apply(source, replaceSelectionCharacters(source, "Q")).doc.text).toBe("xQy");
    }

    for (const offset of [1, 2]) {
      const source = state("xe\u0301y", [[offset, offset]]);
      expect(apply(source, replaceSelectionCharacters(source, "Q")).doc.text).toBe("xQy");
    }

    const family = "👩‍👩‍👧‍👧";
    for (let offset = 1; offset <= family.length; offset += 1) {
      const source = state(`x${family}y`, [[offset, offset]]);
      expect(apply(source, replaceSelectionCharacters(source, "Q")).doc.text).toBe("xQy");
    }

    const duplicate = state("x😀y", [[2, 1], [2, 2]], 0);
    const transaction = replaceSelectionCharacters(duplicate, "💡");
    expect(transaction.changes).toEqual([{ from: 1, to: 3, insert: "💡" }]);
    const merged = apply(duplicate, transaction);
    expect(merged.doc.text).toBe("x💡y");
    expect(selectedTexts(merged)).toEqual(["💡"]);
    expect(direction(merged.selection.ranges[0]!)).toBe("reversed");
    expect(merged.selection.primaryIndex).toBe(0);
  });

  it("toggles each cased code point independently and remaps Unicode expansions", () => {
    const source = fullSelection("aB1ßİ");
    const toggled = apply(source, transformSelectionCase(source, "toggle"));
    expect(toggled.doc.text).toBe("Ab1SSi\u0307");
    expect(selectedTexts(toggled)).toEqual(["Ab1SSi\u0307"]);

    const multiple = state("xß y", [[1, 1], [3, 3]], 1);
    const upper = apply(multiple, transformSelectionCase(multiple, "upper"));
    expect(upper.doc.text).toBe("xSS Y");
    expect(selectedTexts(upper)).toEqual(["SS", "Y"]);
    expect(upper.selection.primaryIndex).toBe(1);
  });

  it("keeps immutable source bounds for alignment and shrinking replacements", () => {
    const source = state("a\n  b", [[0, 0], [4, 4]], 1);
    const aligned = apply(source, alignSelectionColumns(source));
    expect(aligned.doc.text).toBe("  a\n  b");
    expect(selectedTexts(aligned)).toEqual(["a", "b"]);
    expect(aligned.selection.primaryIndex).toBe(1);

    const adjacentAcrossLine = state("xxxxx\nb", [[5, 5], [6, 6]], 1);
    const adjacentAligned = apply(
      adjacentAcrossLine,
      alignSelectionColumns(adjacentAcrossLine)
    );
    expect(adjacentAligned.doc.text).toBe("xxxxx\n     b");
    expect(selectedTexts(adjacentAligned)).toEqual(["\n", "b"]);

    const shrinking = state("abc def", [[0, 2], [4, 6]], 1);
    const replaced = apply(shrinking, replaceSelectionCharacters(shrinking, "💡"));
    expect(replaced.doc.text).toBe("💡💡💡 💡💡💡");
    expect(selectedTexts(replaced)).toEqual(["💡💡💡", "💡💡💡"]);
    expect(replaced.selection.primaryIndex).toBe(1);
  });

  it("aligns by visible cells with portable default and injected width policies", () => {
    const family = "👩‍👩‍👧‍👧";
    const value = `\tA\n界B\ne\u0301C\n${family}D\n    E`;
    const source = state(
      value,
      ["A", "B", "C", "D", "E"].map((character) => {
        const offset = value.indexOf(character);
        return [offset, offset];
      })
    );
    const aligned = apply(source, alignSelectionColumns(source, { tabWidth: 4 }));
    expect(aligned.doc.text).toBe(`\tA\n界  B\ne\u0301   C\n${family}  D\n    E`);
    expect(selectedTexts(aligned)).toEqual(["A", "B", "C", "D", "E"]);

    let callbackCalls = 0;
    const customValue = "xA\n  B";
    const custom = state(customValue, [[1, 1], [5, 5]]);
    const customAligned = apply(
      custom,
      alignSelectionColumns(custom, {
        cellWidth(grapheme) {
          callbackCalls += 1;
          return grapheme === "x" ? 3 : 1;
        }
      })
    );
    expect(customAligned.doc.text).toBe("xA\n   B");
    expect(callbackCalls).toBeGreaterThan(0);
  });

  it("coalesces same-line selections before padding so earlier edits cannot shift later survivors", () => {
    const source = state("a  b", [[0, 0], [3, 3]], 0);
    const transaction = alignSelectionColumns(source);
    expect(transaction.changes).toEqual([{ from: 0, to: 0, insert: "   " }]);
    const aligned = apply(source, transaction);
    expect(aligned.doc.text).toBe("   a  b");
    expect(selectedTexts(aligned)).toEqual(["a"]);
    expect(aligned.selection.ranges[0]!.head).toBe(3);

    const laterPrimary = state("a  b", [[0, 0], [3, 3]], 1);
    const retained = apply(laterPrimary, alignSelectionColumns(laterPrimary));
    expect(retained.doc.text).toBe("a  b");
    expect(selectedTexts(retained)).toEqual(["b"]);
    expect(retained.selection.primaryIndex).toBe(0);
  });

  it("uses overlapping originals for the target while retaining the primary's true start", () => {
    const source = state("abcdef", [[0, 4], [3, 5]], 1);
    const unchanged = apply(source, alignSelectionColumns(source));
    expect(unchanged.doc.text).toBe("abcdef");
    expect(unchanged.selection.ranges).toEqual([
      { anchor: 3, head: 5, preferredColumn: null }
    ]);
    expect(unchanged.selection.primaryIndex).toBe(0);

    const paddedTransaction = alignSelectionColumns(source, { column: 5 });
    expect(paddedTransaction.changes).toEqual([{ from: 3, to: 3, insert: "  " }]);
    const padded = apply(source, paddedTransaction);
    expect(padded.doc.text).toBe("abc  def");
    expect(selectedTexts(padded)).toEqual(["def"]);
    expect(padded.selection.ranges[0]).toMatchObject({ anchor: 5, head: 7 });
    expect(padded.selection.primaryIndex).toBe(0);
  });

  it("aligns one deterministic survivor per line with same-line tabs and wide text", () => {
    const value = "a 界b\n\tc  d";
    const source = state(value, [[0, 0], [3, 3], [6, 6], [9, 9]], 0);
    const transaction = alignSelectionColumns(source, { tabWidth: 4 });
    expect(transaction.changes).toEqual([
      { from: 0, to: 0, insert: "       " },
      { from: 6, to: 6, insert: "   " }
    ]);
    const aligned = apply(source, transaction);
    expect(aligned.doc.text).toBe("       a 界b\n\t   c  d");
    expect(selectedTexts(aligned)).toEqual(["a", "c"]);
    expect(aligned.selection.primaryIndex).toBe(0);
  });
});

describe("structural and numeric transformations", () => {
  it("indents and outdents LF/CRLF linewise selections without rewriting line endings", () => {
    for (const newline of ["\n", "\r\n"]) {
      const value = `a${newline}b${newline}`;
      const source = state(value, [[0, value.length - 1]]);
      const indented = apply(source, indentSelections(source, "  "));
      expect(indented.doc.text).toBe(`  a${newline}  b${newline}`);
      expect(apply(indented, outdentSelections(indented, "  ")).doc.text).toBe(value);
    }
  });

  it("parses signed radix magnitudes and applies the documented zero-crossing sign policy", () => {
    const cases: Array<{
      input: string;
      delta: "increment" | "decrement";
      output: string;
    }> = [
      { input: "-0x01", delta: "increment", output: "0x00" },
      { input: "0x00", delta: "decrement", output: "-0x01" },
      { input: "+0X0A", delta: "increment", output: "+0X0B" },
      { input: "0b000", delta: "decrement", output: "-0b001" },
      { input: "-0o001", delta: "decrement", output: "-0o002" },
      { input: "-001", delta: "increment", output: "000" },
      { input: "+000", delta: "increment", output: "+001" }
    ];

    for (const { input, delta, output } of cases) {
      const source = fullSelection(input);
      const transaction =
        delta === "increment" ? incrementSelections(source) : decrementSelections(source);
      expect(apply(source, transaction).doc.text).toBe(output);
    }
  });

  it("uses arbitrary precision, preserves digit case and padding, and remaps numeric growth", () => {
    const source = state(
      "9 0X0F 999999999999999999999",
      [[0, 0], [2, 5], [7, 27]],
      2
    );
    const incremented = apply(source, incrementSelections(source));
    expect(incremented.doc.text).toBe("10 0X10 1000000000000000000000");
    expect(selectedTexts(incremented)).toEqual(["10", "0X10", "1000000000000000000000"]);
    expect(incremented.selection.primaryIndex).toBe(2);

    const digitCase = fullSelection("0X0F");
    expect(apply(digitCase, decrementSelections(digitCase)).doc.text).toBe("0X0E");
  });

  it("accepts only valid, bounded, non-overlapping formatter changes", () => {
    const source = fullSelection("abcdef");
    const invalid: Array<readonly TextChange[] | null | undefined> = [
      null,
      undefined,
      [],
      [{ from: -1, to: 1, insert: "x" }],
      [{ from: 0, to: 7, insert: "x" }],
      [{ from: 2, to: 1, insert: "x" }],
      [
        { from: 0, to: 3, insert: "x" },
        { from: 2, to: 4, insert: "y" }
      ]
    ];
    for (const changes of invalid) {
      expect(applyFormatterChanges(source, changes)).toEqual({});
    }

    const formatted = applyFormatterChanges(source, [
      { from: 0, to: 1, insert: "A" },
      { from: 5, to: 6, insert: "F!" }
    ]);
    const next = apply(source, formatted);
    expect(next.doc.text).toBe("AbcdeF!");
    expect(selectedTexts(next)).toEqual(["AbcdeF!"]);
  });
});

describe("transaction property matrix", () => {
  it("maintains bounds, ordered output edits, normalized selections, and one-transaction shape", () => {
    const fixtures: Array<{
      source: EditorState;
      operations: Array<(source: EditorState) => Transaction>;
    }> = [
      {
        source: state("alpha beta", [[0, 4], [6, 9]], 0),
        operations: [
          (source) => transformSelectionCase(source, "toggle"),
          (source) => replaceSelectionCharacters(source, "é"),
          (source) => alignSelectionColumns(source)
        ]
      },
      {
        source: state("aa--bb", [[5, 0]], 0),
        operations: [
          (source) => splitSelectionsByRegex(source, /--/),
          (source) => trimSelections(source)
        ]
      },
      {
        source: state("0123456789", [[0, 6], [3, 4], [6, 8]], 2),
        operations: [mergeOverlappingSelections, mergeConsecutiveSelections]
      },
      {
        source: state("abc", [[1, 1]], 0, "insert"),
        operations: [
          (source) => replaceSelectionCharacters(source, "😀"),
          splitSelectionsOnNewline,
          trimSelections
        ]
      },
      {
        source: fullSelection("a\nb\n"),
        operations: [joinSelectionLines, (source) => indentSelections(source, "\t")]
      },
      {
        source: fullSelection("a\r\nb\r\n", true),
        operations: [splitSelectionsOnNewline, joinSelectionLines]
      },
      {
        source: fullSelection("😀e\u0301ß"),
        operations: [
          (source) => transformSelectionCase(source, "upper"),
          (source) => transformSelectionCase(source, "toggle"),
          (source) => replaceSelectionCharacters(source, "o\u0308")
        ]
      }
    ];

    for (const fixture of fixtures) {
      for (const operation of fixture.operations) {
        const transaction = operation(fixture.source);
        expect(transaction).toEqual(expect.any(Object));
        expectSafeTransaction(fixture.source, transaction);
      }
    }
  });

  it("matches an independent seeded evolving document, edit, selection, primary, and direction model", () => {
    let seed = 0xc0decafe;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed;
    };
    const baseText = "aBc12\nxyZ34\nmnopQRstu";

    for (let sequence = 0; sequence < 32; sequence += 1) {
      const requestedRanges: Array<[number, number]> = [0, 5, 10, 15].map((start) => {
        const end = Math.min(baseText.length - 1, start + (random() % 5));
        return random() & 1 ? [start, end] : [end, start];
      });
      let actual = state(baseText, requestedRanges, random() % requestedRanges.length);
      let model = modelFromEditor(actual);

      for (let step = 0; step < 96; step += 1) {
        const choice = random() % 12;
        let transaction: Transaction;
        let expected: ModelStep;
        if (choice === 0) {
          transaction = flipSelectionDirection(actual);
          expected = modelSelectionStep(model, "flip");
        } else if (choice === 1) {
          transaction = ensureForwardSelections(actual);
          expected = modelSelectionStep(model, "forward");
        } else if (choice === 2) {
          transaction = collapseSelections(actual, "anchor");
          expected = modelSelectionStep(model, "anchor");
        } else if (choice === 3) {
          transaction = collapseSelections(actual, "head");
          expected = modelSelectionStep(model, "head");
        } else if (choice === 4) {
          transaction = rotatePrimarySelection(actual);
          expected = modelSelectionStep(model, "rotate-next");
        } else if (choice === 5) {
          transaction = rotatePrimarySelection(actual, -1);
          expected = modelSelectionStep(model, "rotate-previous");
        } else if (choice === 6) {
          transaction = removePrimarySelection(actual);
          expected = modelSelectionStep(model, "remove");
        } else if (choice === 7) {
          transaction = mergeOverlappingSelections(actual);
          expected = { state: mergeModel(model, false), changes: [] };
        } else if (choice === 8) {
          transaction = mergeConsecutiveSelections(actual);
          expected = { state: mergeModel(model, true), changes: [] };
        } else if (choice === 9) {
          transaction = replaceSelectionCharacters(actual, "X");
          expected = modelReplace(model);
        } else if (choice === 10) {
          transaction = transformSelectionCase(actual, "toggle");
          expected = modelToggleCase(model);
        } else {
          const offset = random() % (model.text.length + 1);
          const change = { from: offset, to: offset, insert: "!" };
          transaction = applyFormatterChanges(actual, [change]);
          expected = modelInsert(model, offset);
        }

        expect(transaction.changes ?? []).toEqual(expected.changes);
        actual = expectSafeTransaction(actual, transaction);
        model = expected.state;
        expectModelState(actual, model);
      }
    }
  });
});
