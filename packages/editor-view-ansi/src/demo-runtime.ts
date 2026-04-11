import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createEditorController } from "../../editor-controller/src/index";
import { typescriptHighlightQuery } from "../../editor-tree-sitter/src/highlightQuery";
import { createNodeTreeSitterLanguageServices } from "../../editor-tree-sitter/src/node";
import { graphiteTheme, mintTheme, phTheme } from "../../../apps/playground/src/phTheme";

import { createAnsiEditorTerminal } from "./terminal";

function resolveDemoAssetPath(candidates: readonly string[]): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = resolve(here, "..", "..", "..");

  for (const candidate of candidates) {
    const absolute = resolve(workspaceRoot, candidate);
    if (existsSync(absolute)) {
      return absolute;
    }
  }

  throw new Error(`Could not locate demo asset. Tried: ${candidates.join(", ")}`);
}

export async function runAnsiMirrorDemo(): Promise<void> {
  const sample = [
    "export function smoothUnion(a: number, b: number, k: number): number {",
    "  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));",
    "  return (1 - h) * b + h * a - k * h * (1 - h);",
    "}",
    "",
    "export function shade(time: number) {",
    "  return `#${Math.floor(time * 17).toString(16)}`;",
    "}"
  ].join("\n");
  const treeSitterServices = createNodeTreeSitterLanguageServices({
    parserRuntimeUrl: resolveDemoAssetPath([
      "node_modules/.pnpm/web-tree-sitter@0.26.8/node_modules/web-tree-sitter/web-tree-sitter.js",
      "node_modules/web-tree-sitter/web-tree-sitter.js"
    ]),
    parserWasmUrl: resolveDemoAssetPath([
      "apps/playground/src/assets/web-tree-sitter.wasm",
      "node_modules/.pnpm/web-tree-sitter@0.26.8/node_modules/web-tree-sitter/web-tree-sitter.wasm"
    ]),
    languageWasmUrl: resolveDemoAssetPath([
      "apps/playground/src/assets/tree-sitter-typescript.wasm",
      "node_modules/.pnpm/tree-sitter-typescript@0.23.2/node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm"
    ]),
    query: typescriptHighlightQuery,
    workerModuleUrl: new URL("./nodeWorker.js", import.meta.url)
  });

  const controller = createEditorController({ value: sample });
  controller.setFilePath("examples/demo.ts");
  controller.setLanguageServices([treeSitterServices]);
  const terminal = createAnsiEditorTerminal({
    controller,
    input: process.stdin,
    output: process.stdout,
    write: (text) => process.stdout.write(text),
    theme: phTheme,
    availableThemes: [phTheme, graphiteTheme, mintTheme],
    cols: process.stdout.columns ?? 100,
    rows: process.stdout.rows ?? 28,
    enterAltScreen: true,
    indentGuides: {
      render: true,
      character: "│",
      skipLevels: 1,
      indentWidth: 2
    },
    exit: (code = 0) => process.exit(code)
  });
  terminal.mount();
}
