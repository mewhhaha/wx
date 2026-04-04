import treeSitterWasmUrl from "./assets/web-tree-sitter.wasm?url";
import typescriptWasmUrl from "./assets/tree-sitter-typescript.wasm?url";
import { phTheme } from "./phTheme";

import { createTreeSitterLanguageServices, typescriptHighlightQuery } from "@wx/editor-tree-sitter";
import { createEditor, type EditorHandle } from "@wx/editor-view-dom";

declare global {
  interface Window {
    __wxBench?: {
      runSuite(options?: Partial<BenchmarkRunOptions>): Promise<BenchmarkSuiteResult>;
    };
  }
}

interface BenchmarkRunOptions {
  lineCount: number;
  iterations: number;
}

interface BenchmarkScenarioRun {
  mountMs: number;
  moveDownMs: number;
  newlineAtTopMs: number;
  rowCount: number;
}

interface BenchmarkScenarioResult {
  name: string;
  runs: BenchmarkScenarioRun[];
}

interface BenchmarkSuiteResult {
  scenarios: BenchmarkScenarioResult[];
}

const DEFAULT_OPTIONS: BenchmarkRunOptions = {
  lineCount: 1000,
  iterations: 3
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function waitForDomQuiet(target: HTMLElement, quietMs = 32, timeoutMs = 5_000): Promise<void> {
  let lastMutationAt = performance.now();

  const observer = new MutationObserver(() => {
    lastMutationAt = performance.now();
  });

  observer.observe(target, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true
  });

  const startedAt = performance.now();

  try {
    while (performance.now() - startedAt < timeoutMs) {
      await nextFrame();

      if (performance.now() - lastMutationAt >= quietMs) {
        return;
      }
    }
  } finally {
    observer.disconnect();
  }
}

function dispatchKey(target: HTMLTextAreaElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function createBenchmarkSource(lineCount: number): string {
  const lines = [
    'import { greet } from "./hello";',
    "",
    "type User = {",
    "  id: number;",
    "  name: string;",
    "};",
    "",
    "export function boot(users: User[]) {"
  ];

  while (lines.length < Math.max(2, lineCount - 2)) {
    const index = lines.length - 8;
    lines.push(`  const user${index} = users[${index % 5}]!;`);
    lines.push(`  console.log(greet(user${index}.name));`);
  }

  lines.push("  return users.length;");
  lines.push("}");

  return lines.slice(0, lineCount).join("\n");
}

async function mountEditor(
  mount: HTMLDivElement,
  lineCount: number,
  useLanguage: boolean
): Promise<{ editor: EditorHandle; textarea: HTMLTextAreaElement; mountMs: number }> {
  const languageServices = useLanguage
    ? createTreeSitterLanguageServices({
        parserWasmUrl: treeSitterWasmUrl,
        languageWasmUrl: typescriptWasmUrl,
        query: typescriptHighlightQuery
      })
    : null;

  const mountStartedAt = performance.now();
  const editor = createEditor(mount, {
    filePath: "bench/large.ts",
    value: createBenchmarkSource(lineCount),
    languageServices,
    theme: phTheme
  });

  editor.focus();
  await waitForDomQuiet(mount);

  const textarea = mount.querySelector("[data-wx-editor='input']");

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error("Benchmark could not find editor textarea");
  }

  return {
    editor,
    textarea,
    mountMs: performance.now() - mountStartedAt
  };
}

async function measureMovement(textarea: HTMLTextAreaElement, mount: HTMLDivElement): Promise<number> {
  const startedAt = performance.now();

  for (let index = 0; index < 200; index += 1) {
    dispatchKey(textarea, "j");
  }

  await waitForDomQuiet(mount);
  return performance.now() - startedAt;
}

async function measureNewlineAtTop(textarea: HTMLTextAreaElement, mount: HTMLDivElement): Promise<number> {
  dispatchKey(textarea, "g");
  dispatchKey(textarea, "g");
  await waitForDomQuiet(mount);

  const startedAt = performance.now();
  dispatchKey(textarea, "i");
  dispatchKey(textarea, "Enter");
  dispatchKey(textarea, "Escape");
  await waitForDomQuiet(mount);
  return performance.now() - startedAt;
}

async function runScenario(
  mount: HTMLDivElement,
  scenario: { name: string; useLanguage: boolean },
  options: BenchmarkRunOptions
): Promise<BenchmarkScenarioResult> {
  const runs: BenchmarkScenarioRun[] = [];

  for (let index = 0; index < options.iterations; index += 1) {
    mount.replaceChildren();

    const { editor, textarea, mountMs } = await mountEditor(mount, options.lineCount, scenario.useLanguage);

    try {
      const moveDownMs = await measureMovement(textarea, mount);
      const newlineAtTopMs = await measureNewlineAtTop(textarea, mount);
      const rowCount = mount.querySelectorAll("[data-wx-editor-row]").length;

      runs.push({
        mountMs,
        moveDownMs,
        newlineAtTopMs,
        rowCount
      });
    } finally {
      editor.destroy();
      mount.replaceChildren();
      await nextFrame();
    }
  }

  return {
    name: scenario.name,
    runs
  };
}

export function installBenchmarkHarness(app: HTMLDivElement): void {
  app.innerHTML = `
    <main class="workspace">
      <div id="mount-editor" class="workspace__editor"></div>
    </main>
  `;

  const mount = app.querySelector<HTMLDivElement>("#mount-editor");

  if (!mount) {
    throw new Error("Benchmark harness could not find mount point");
  }

  window.__wxBench = {
    async runSuite(input = {}) {
      const options: BenchmarkRunOptions = {
        ...DEFAULT_OPTIONS,
        ...input
      };

      const scenarios = [
        await runScenario(mount, { name: "DOM only", useLanguage: false }, options),
        await runScenario(mount, { name: "TypeScript tree-sitter", useLanguage: true }, options)
      ];

      return { scenarios };
    }
  };
}
