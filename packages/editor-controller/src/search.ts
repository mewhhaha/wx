export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
