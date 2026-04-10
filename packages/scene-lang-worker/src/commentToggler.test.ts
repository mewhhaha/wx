import { describe, expect, it } from "vitest";

import { createTextDocument } from "@wx/editor-core";

import { __internal } from "./commentToggler";

describe("WGSL comment toggler", () => {
  it("uses line comments for cursor-style selections", () => {
    const document = createTextDocument("let color = vec4f(1.0);\nlet glow = 1.0;");

    expect(__internal.shouldUseLineComments(document, { from: 4, to: 5 })).toBe(true);
    expect(__internal.toggleLineComments(document, { from: 4, to: 5 })).toEqual([
      { from: 0, to: 0, insert: "// " }
    ]);
  });

  it("uses block comments for partial single-line selections", () => {
    const document = createTextDocument("let color = vec4f(1.0);");

    expect(__internal.shouldUseLineComments(document, { from: 4, to: 9 })).toBe(false);
    expect(__internal.toggleBlockComments(document, { from: 4, to: 9 })).toEqual([
      { from: 9, to: 9, insert: " */" },
      { from: 4, to: 4, insert: "/* " }
    ]);
  });

  it("uses line comments for multi-line selections", () => {
    const document = createTextDocument("let color = 1.0;\nlet glow = 2.0;");

    expect(__internal.shouldUseLineComments(document, { from: 0, to: document.length })).toBe(true);
    expect(__internal.toggleLineComments(document, { from: 0, to: document.length })).toEqual([
      { from: 0, to: 0, insert: "// " },
      { from: 17, to: 17, insert: "// " }
    ]);
  });
});
