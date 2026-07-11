import type { IndentationAction } from "@mewhhaha/wx-core";
import type { IndentationResult } from "@mewhhaha/wx-language";

export interface IndentationConformanceFixture {
  name: string;
  /** Exactly one `|` marks the insertion point; it is not part of the document. */
  input: string;
  action: IndentationAction;
  expected: {
    text: string;
    cursor: number;
    result: IndentationResult;
  };
}

export function materializeIndentationFixture(fixture: IndentationConformanceFixture): { text: string; offset: number } {
  const offset = fixture.input.indexOf("|");
  if (offset < 0 || offset !== fixture.input.lastIndexOf("|")) throw new Error(`${fixture.name} must contain exactly one cursor marker.`);
  return { text: fixture.input.slice(0, offset) + fixture.input.slice(offset + 1), offset };
}

/** Executable TypeScript fixtures shared by the core planner and real Node/Deno workers. */
export const typescriptIndentationFixtures: readonly IndentationConformanceFixture[] = [
  {
    name: "brace enter",
    input: "function f() {|\n}",
    action: "enter",
    expected: { text: "function f() {\n  \n}", cursor: 17, result: { revision: 1, status: "ok", indent: 1, outdent: 0 } }
  },
  {
    name: "body open below",
    input: "function f() {\n  value|\n}",
    action: "open-below",
    expected: { text: "function f() {\n  value\n  \n}", cursor: 25, result: { revision: 1, status: "ok", indent: 1, outdent: 0 } }
  },
  {
    name: "closer open above",
    input: "function f() {\n  value\n  |}",
    action: "open-above",
    expected: { text: "function f() {\n  value\n\n  }", cursor: 23, result: { revision: 1, status: "ok", indent: 1, outdent: 1 } }
  },
  {
    name: "argument alignment",
    input: "call(\n  first,|\n  second\n)",
    action: "open-below",
    expected: { text: "call(\n  first,\n    \n  second\n)", cursor: 19, result: { revision: 1, status: "ok", indent: 0, outdent: 0, alignColumn: 4 } }
  },
  {
    name: "array open below",
    input: "const a = [\n  one,|\n]",
    action: "open-below",
    expected: { text: "const a = [\n  one,\n  \n]", cursor: 21, result: { revision: 1, status: "ok", indent: 1, outdent: 0 } }
  },
  {
    name: "same-line nested scopes collapse",
    input: "const x = { nested: { value: true }| };",
    action: "enter",
    expected: { text: "const x = { nested: { value: true }\n };", cursor: 36, result: { revision: 1, status: "ok", indent: 0, outdent: 1 } }
  },
  {
    name: "nested template falls back",
    input: "function f() {\n  const value = `line\n    text|`;\n}",
    action: "enter",
    expected: { text: "function f() {\n  const value = `line\n    text\n    `;\n}", cursor: 50, result: { revision: 1, status: "incomplete" } }
  },
  {
    name: "nested comment falls back",
    input: "function f() {\n  // comment {|\n}",
    action: "enter",
    expected: { text: "function f() {\n  // comment {\n  \n}", cursor: 32, result: { revision: 1, status: "incomplete" } }
  },
  {
    name: "CRLF open below",
    input: "function f() {\r\n  value|\r\n}",
    action: "open-below",
    expected: { text: "function f() {\r\n  value\r\n  \r\n}", cursor: 27, result: { revision: 1, status: "ok", indent: 1, outdent: 0 } }
  }
];

/** No WGSL grammar is bundled; these are capture-model inputs, not grammar claims. */
export const sceneOrWgslCaptureFixtures = ["struct Light { | }", "compound { | }"] as const;
