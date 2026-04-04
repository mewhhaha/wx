import treeSitterWasmUrl from "./assets/web-tree-sitter.wasm?url";
import typescriptWasmUrl from "./assets/tree-sitter-typescript.wasm?url";
import { installBenchmarkHarness } from "./benchmarkHarness";
import { phTheme } from "./phTheme";

import { createTreeSitterLanguageServices, typescriptHighlightQuery } from "@wx/editor-tree-sitter";
import { createEditor } from "@wx/editor-view-dom";

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

function findRange(source: string, needle: string): { from: number; to: number } {
  const from = source.indexOf(needle);

  if (from < 0) {
    throw new Error(`Could not find sample segment: ${needle}`);
  }

  return {
    from,
    to: from + needle.length
  };
}

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");

  if (!app) {
    return;
  }

  if (new URL(window.location.href).searchParams.has("bench")) {
    installBenchmarkHarness(app);
    return;
  }

  const treeSitterLanguageServices = createTreeSitterLanguageServices({
    parserWasmUrl: treeSitterWasmUrl,
    languageWasmUrl: typescriptWasmUrl,
    query: typescriptHighlightQuery
  });

  const languageServices = {
    ...treeSitterLanguageServices,
    diagnostics: {
      async diagnostics() {
        return [
          {
            ...findRange(sample, "greet"),
            severity: "info" as const,
            source: "fake-lsp",
            code: "info.greet",
            message: "Fake LSP info: imported symbol resolves cleanly."
          },
          {
            ...findRange(sample, "console.log"),
            severity: "warning" as const,
            source: "fake-lsp",
            code: "warn.console-log",
            message: "Fake LSP warning: avoid console.log in production code."
          },
          {
            ...findRange(sample, "return message;"),
            severity: "error" as const,
            source: "fake-lsp",
            code: "error.return-type",
            message: "Fake LSP error: expected `number`, got `string`."
          }
        ];
      }
    },
    hover: {
      async hover(_document, offset: number) {
        if (offset >= findRange(sample, "User").from && offset < findRange(sample, "User").to) {
          return {
            source: "fake-lsp",
            content: "type User = { id: number; name: string }"
          };
        }

        if (offset >= findRange(sample, "message").from && offset < findRange(sample, "message").to) {
          return {
            source: "fake-lsp",
            content: "const message: string"
          };
        }

        return {
          source: "fake-lsp",
          content: "Hover info from the fake LSP demo."
        };
      }
    },
    codeActions: {
      async getCodeActions() {
        return [
          {
            title: "Replace console.log with console.warn",
            changes: [
              {
                ...findRange(sample, "console.log"),
                insert: "console.warn"
              }
            ]
          },
          {
            title: "Rename message to userMessage",
            changes: [
              {
                ...findRange(sample, "message"),
                insert: "userMessage"
              }
            ]
          }
        ];
      }
    }
  };

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
      languageServices,
      theme: phTheme
    }).focus();
  }
}

void main();
