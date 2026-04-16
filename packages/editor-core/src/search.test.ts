import { describe, expect, it } from "vitest";

import { collectSearchMatches, compileSearchPattern } from "./search";

describe("search helpers", () => {
  it("compiles valid patterns and rejects invalid ones", () => {
    expect(compileSearchPattern("a+")).toBeInstanceOf(RegExp);
    expect(compileSearchPattern("(")).toBeNull();
    expect(compileSearchPattern("")).toBeNull();
  });

  it("collects non-empty and zero-width matches safely", () => {
    expect(collectSearchMatches("alpha beta alpha", "alpha")).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 }
    ]);
    expect(collectSearchMatches("ab", "(?=b)")).toEqual([{ from: 1, to: 2 }]);
  });
});
