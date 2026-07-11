/// <reference lib="deno.ns" />

import { createTextDocument, planIndentation } from "@mewhhaha/wx-core";

import { createDenoTreeSitterLanguageServices } from "./deno";
import { materializeIndentationFixture, typescriptIndentationFixtures } from "./indentFixtures";
import { typescriptIndentQuery } from "./indentQueries";

function assertEquals(actual: unknown, expected: unknown, context: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${context}: expected ${right}, received ${left}`);
}

Deno.test("Deno and Node/browser workers share executable wx-indent-v1 fixtures", async () => {
  const root = new URL("../../../", import.meta.url);
  const services = createDenoTreeSitterLanguageServices({
    parserWasmUrl: new URL("node_modules/.pnpm/web-tree-sitter@0.26.8/node_modules/web-tree-sitter/web-tree-sitter.wasm", root).href,
    languageWasmUrl: new URL("node_modules/.pnpm/tree-sitter-typescript@0.23.2/node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm", root).href,
    query: "(identifier) @type",
    indentQuery: typescriptIndentQuery,
    owner: "controller"
  });
  try {
    await services.lifecycle!.whenReady!();
    for (const fixture of typescriptIndentationFixtures) {
      const { text, offset } = materializeIndentationFixture(fixture);
      const doc = createTextDocument(text);
      const document = { revision: 1, doc };
      await services.highlighter!.open!(document);
      const result = await services.indentation!.getIndentation({ document, offset, action: fixture.action });
      assertEquals(result, fixture.expected.result, `${fixture.name} result`);
      const plan = planIndentation(doc, [{ from: offset }], fixture.action, undefined, [result]);
      assertEquals(doc.applyChanges(plan.changes).text, fixture.expected.text, `${fixture.name} text`);
      assertEquals(plan.insertionOffsets[0], fixture.expected.cursor, `${fixture.name} cursor`);
    }
  } finally {
    await services.lifecycle!.destroy();
  }
});
