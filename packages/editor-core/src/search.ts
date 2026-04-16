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
