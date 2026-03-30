import treeSitterWasmUrl from "./assets/web-tree-sitter.wasm?url";
import typescriptWasmUrl from "./assets/tree-sitter-typescript.wasm?url";
import { installBenchmarkHarness } from "./benchmarkHarness";
import { phTheme } from "./phTheme";

import { createTreeSitterLanguageProvider, typescriptHighlightQuery } from "@whx/editor-tree-sitter";
import { createEditor } from "@whx/editor-view-dom";

import "./style.css";

const sample = `import { greet } from "./hello";

type User = {
  id: number;
  name: string;
};

export function boot(user: User) {
  const message = greet(user.name);
  console.log(message);
  return message;
}
`;

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");

  if (!app) {
    return;
  }

  if (new URL(window.location.href).searchParams.has("bench")) {
    installBenchmarkHarness(app);
    return;
  }

  const language = createTreeSitterLanguageProvider({
    parserWasmUrl: treeSitterWasmUrl,
    languageWasmUrl: typescriptWasmUrl,
    query: typescriptHighlightQuery
  });

  app.innerHTML = `
    <main class="workspace">
      <div id="mount-editor" class="workspace__editor"></div>
    </main>
  `;

  const mount = app.querySelector<HTMLDivElement>("#mount-editor");

  if (mount) {
    createEditor(mount, {
      filePath: "examples/chat-worker/src/worker.ts",
      value: sample,
      language,
      theme: phTheme
    }).focus();
  }
}

void main();
