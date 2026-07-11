/// <reference lib="deno.ns" />

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createTextDocument } from "@mewhhaha/wx-core";
import { createDenoTreeSitterLanguageServices } from "@wx/editor-tree-sitter/deno";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const samples = Number(Deno.args[0]);
const lineCount = Number(Deno.args[1]);
if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(lineCount) || lineCount < 1) throw new Error("Expected positive sample and line counts");
const runtime = join(root, "node_modules/.pnpm/web-tree-sitter@0.26.8/node_modules/web-tree-sitter/web-tree-sitter.wasm");
const grammar = join(root, "node_modules/.pnpm/tree-sitter-typescript@0.23.2/node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm");
const query = await Deno.readTextFile(join(root, "apps/playground/src/assets/tree-sitter-typescript-highlights.scm"));
const text = Array.from({ length: lineCount }, (_, index) => `const value${index} = ${index};`).join("\n");
const readyMs: number[] = [], openMs: number[] = [];
for (let sample = 0; sample < samples; sample += 1) {
  const services = createDenoTreeSitterLanguageServices({ parserWasmUrl: new URL(`file://${runtime}`).href, languageWasmUrl: new URL(`file://${grammar}`).href, query, owner: "controller" });
  try {
    let start = performance.now();
    await services.lifecycle?.whenReady?.();
    readyMs.push(performance.now() - start);
    start = performance.now();
    await services.highlighter?.open?.({ revision: 1, doc: createTextDocument(text) });
    openMs.push(performance.now() - start);
  } finally { await services.lifecycle?.destroy?.(); }
}
console.log(JSON.stringify({ readyMs, openMs }));
