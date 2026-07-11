import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Language, Parser, Query, type Tree } from "web-tree-sitter";
import { describe, expect, it } from "vitest";

import { buildTreeEdit } from "./incrementalEdits";
import { queryIndentCaptures, resolveIndentCaptures } from "./indentQuery";
import { typescriptIndentQuery } from "./indentQueries";
import { IncrementalLineIndex } from "./lineIndex";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimePath = resolve(root, "node_modules/.pnpm/web-tree-sitter@0.26.8/node_modules/web-tree-sitter/web-tree-sitter.wasm");
const grammarPath = resolve(root, "node_modules/.pnpm/tree-sitter-typescript@0.23.2/node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm");
const queryPath = resolve(root, "apps/playground/src/assets/tree-sitter-typescript-highlights.scm");

describe("real TypeScript grammar incremental fallback parity", () => {
  it("produces the same tree and captures as a full sync", async () => {
    await Parser.init({ locateFile: () => runtimePath });
    const language = await Language.load(grammarPath);
    const parser = new Parser();
    parser.setLanguage(language);
    const query = new Query(language, readFileSync(queryPath, "utf8"));
    let text = Array.from({ length: 250 }, (_, index) => `const value${index}: string = "${index} 😀";`).join("\n");
    const index = new IncrementalLineIndex(text);
    let incremental = parser.parse(text);

    for (let revision = 0; revision < 100; revision += 1) {
      const from = index.utf16Starts[(revision * 17) % index.lineCount]! + 6;
      const change = { from, to: from, insert: revision % 10 === 0 ? "β\nconst extra = 1;\n" : "x" };
      incremental.edit(buildTreeEdit(text, change, index) as Parameters<Tree["edit"]>[0]);
      text = index.applyChange(change);
      const expectedStarts = [0];
      for (let offset = 0; offset < text.length; offset += 1) if (text[offset] === "\n") expectedStarts.push(offset + 1);
      expect(index.utf16Starts).toEqual(expectedStarts);
    }

    const previous = incremental;
    incremental = parser.parse(text, previous);
    previous.delete();
    const full = parser.parse(text);
    const captures = (tree: Tree) => query.captures(tree.rootNode).map((capture) => [capture.name, capture.node.startIndex, capture.node.endIndex]);
    expect(incremental.rootNode.toString()).toBe(full.rootNode.toString());
    expect(captures(incremental)).toEqual(captures(full));
    incremental.delete();
    full.delete();
    query.delete();
    parser.delete();
  });

  it("evaluates the wx-indent-v1 TypeScript subset in a bounded insertion window", async () => {
    await Parser.init({ locateFile: () => runtimePath });
    const language = await Language.load(grammarPath);
    const parser = new Parser();
    parser.setLanguage(language);
    const query = new Query(language, typescriptIndentQuery);
    const text = [
      "function call(",
      "  first: number,",
      "  second: number",
      ") {",
      "  const value = {",
      "    nested: true",
      "  };",
      "  return `${value}`;",
      "}"
    ].join("\n");
    const tree = parser.parse(text);
    const answerAt = (offset: number) => {
      return resolveIndentCaptures(queryIndentCaptures(query, tree.rootNode, text.length, offset), offset);
    };

    expect(answerAt(text.indexOf("second"))).toEqual({ indent: 0, outdent: 0, alignColumn: 13 });
    expect(answerAt(text.indexOf("const value"))).toEqual({ indent: 1, outdent: 0 });
    expect(answerAt(text.indexOf("};"))).toEqual({ indent: 2, outdent: 1 });
    expect(answerAt(text.indexOf("value}`"))).toEqual({ indent: 0, outdent: 0, opaque: true });

    const oneLine = "const x = { nested: { answer: true } };";
    const oneLineTree = parser.parse(oneLine);
    const offset = oneLine.indexOf("answer");
    expect(resolveIndentCaptures(queryIndentCaptures(query, oneLineTree.rootNode, oneLine.length, offset), offset))
      .toEqual({ indent: 0, outdent: 0 });

    oneLineTree.delete();
    tree.delete();
    query.delete();
    parser.delete();
  });
});
