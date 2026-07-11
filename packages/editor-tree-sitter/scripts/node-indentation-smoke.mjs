import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createNodeTreeSitterLanguageServices } from "../dist/node.js";
import {
  materializeIndentationFixture,
  typescriptIndentationFixtures,
  typescriptIndentQuery
} from "../dist/index.js";

const parserRuntimeUrl = import.meta.resolve("web-tree-sitter");
const services = createNodeTreeSitterLanguageServices({
  parserRuntimeUrl: fileURLToPath(parserRuntimeUrl),
  parserWasmUrl: fileURLToPath(new URL("./web-tree-sitter.wasm", parserRuntimeUrl)),
  languageWasmUrl: fileURLToPath(import.meta.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm")),
  query: "(identifier) @type",
  indentQuery: typescriptIndentQuery,
  owner: "controller"
});

try {
  await services.lifecycle.whenReady();
  for (const fixture of typescriptIndentationFixtures) {
    const { text, offset } = materializeIndentationFixture(fixture);
    const doc = { text, length: text.length };
    const document = { revision: 1, doc };
    await services.highlighter.open(document);
    const result = await services.indentation.getIndentation({ document, offset, action: fixture.action });
    assert.deepEqual(result, fixture.expected.result, fixture.name);
  }

  const fixture = typescriptIndentationFixtures[0];
  const { text, offset } = materializeIndentationFixture(fixture);
  assert.deepEqual(
    await services.indentation.getIndentation({
      document: { revision: 2, doc: { text, length: text.length } },
      offset,
      action: fixture.action
    }),
    { revision: 2, status: "stale" }
  );
  console.log(`Verified ${typescriptIndentationFixtures.length} Node worker indentation fixtures.`);
} finally {
  await services.lifecycle.destroy();
}
