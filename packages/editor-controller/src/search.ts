export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileSearchPattern(query: string): RegExp | null {
  if (!query) {
    return null;
  }

  try {
    return new RegExp(query, "gu");
  } catch {
    return null;
  }
}

export function collectSearchMatches(text: string, query: string): Array<{ from: number; to: number }> {
  const pattern = compileSearchPattern(query);

  if (!pattern) {
    return [];
  }

  const matches: Array<{ from: number; to: number }> = [];
  let result = pattern.exec(text);

  while (result) {
    const matchedText = result[0] ?? "";
    const from = result.index;
    const to = from + Math.max(1, matchedText.length);
    matches.push({ from, to });

    if (matchedText.length === 0) {
      pattern.lastIndex = from + 1;
    }

    result = pattern.exec(text);
  }

  return matches;
}

export function searchMatchesEqual(
  left: readonly { from: number; to: number }[],
  right: readonly { from: number; to: number }[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    return !!other && entry.from === other.from && entry.to === other.to;
  });
}

export function searchMatchesByLineEqual(
  left: ReadonlyMap<number, readonly { from: number; to: number }[]>,
  right: ReadonlyMap<number, readonly { from: number; to: number }[]>
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [line, matches] of left) {
    const other = right.get(line);
    if (!other || !searchMatchesEqual(matches, other)) {
      return false;
    }
  }

  return true;
}
