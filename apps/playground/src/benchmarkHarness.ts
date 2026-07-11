import treeSitterWasmUrl from "./assets/web-tree-sitter.wasm?url";
import typescriptWasmUrl from "./assets/tree-sitter-typescript.wasm?url";

import { phTheme } from "@mewhhaha/wx-theme";
import { createSelectionSet } from "@mewhhaha/wx-core";
import { createEditorController } from "@mewhhaha/wx-controller";
import { createTreeSitterLanguageServices, typescriptHighlightQuery } from "@wx/editor-tree-sitter";
import { createEditor, type EditorHandle } from "@mewhhaha/wx-dom";

declare global {
  interface Window { __wxBench?: { runSuite(options?: Partial<BenchmarkRunOptions>): Promise<BenchmarkSuiteResult> }; }
}

interface BenchmarkRunOptions { lineCount: number; iterations: number; suite: "smoke" | "full"; }
interface Metric { samples: number[]; unit: "ms" | "bytes" | "count"; }
interface BenchmarkScenario { id: string; workload: string; state: "cold" | "warm"; fixture: string; metrics: Record<string, Metric | null>; capabilities: Record<string, boolean>; }
interface BenchmarkSuiteResult { formatVersion: number; scenarios: BenchmarkScenario[]; }
const DEFAULT_OPTIONS: BenchmarkRunOptions = { lineCount: 1000, iterations: 30, suite: "smoke" };

function nextPaint(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }
async function settledAfterPaint(): Promise<void> { await nextPaint(); await nextPaint(); }
function dispatchKey(target: HTMLTextAreaElement, key: string): void { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); }
function dispatchLineBreak(target: HTMLTextAreaElement): void {
  target.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph", data: null }));
}

function createFixture(lineCount: number, kind = "typescript"): string {
  const lead = kind === "unicode" ? "const café = '😀';" : kind === "long-line" ? `const payload = "${"x".repeat(4000)}";` : "type User = { id: number; name: string };";
  const lines = [lead, "export function edit(users: User[]) {"];
  while (lines.length < lineCount - 1) lines.push(kind === "soft-wrap" ? `  const item${lines.length} = users[${lines.length % 5}]?.name ?? "a very long wrapped diagnostic value";` : `  const item${lines.length} = users[${lines.length % 5}]?.name;`);
  lines.push("  return users.length; }");
  return lines.slice(0, lineCount).join("\n");
}

async function memoryBytes(): Promise<number | null> {
  const measure = (performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }).measureUserAgentSpecificMemory;
  if (!measure) return null;
  try { return (await measure.call(performance)).bytes; } catch { return null; }
}

function diagnosticService(lineCount: number) {
  return {
    diagnostics: {
      async diagnostics() {
        return Array.from({ length: lineCount }, (_, line) => ({ from: line * 18, to: line * 18 + 5, severity: line % 2 ? "warning" as const : "error" as const, message: `Benchmark diagnostic ${line}` }));
      }
    }
  };
}

async function mountEditor(mount: HTMLDivElement, lineCount: number, useLanguage: boolean, fixture: string, condition: "none" | "many-selection" | "diagnostic-heavy"): Promise<{ editor: EditorHandle; textarea: HTMLTextAreaElement; syncMs: number; nextPaintMs: number; firstInteractiveMs: number; settledMs: number }> {
  const treeSitter = useLanguage ? createTreeSitterLanguageServices({ parserWasmUrl: treeSitterWasmUrl, languageWasmUrl: typescriptWasmUrl, query: typescriptHighlightQuery, owner: "view" }) : null;
  const languageServices = condition === "diagnostic-heavy" ? (treeSitter ? [treeSitter, diagnosticService(lineCount)] : [diagnosticService(lineCount)]) : treeSitter;
  const value = createFixture(lineCount, fixture);
  const selection = condition === "many-selection"
    ? createSelectionSet(Array.from({ length: Math.min(256, lineCount) }, (_, line) => {
      const offset = value.indexOf("item", Math.floor((line * (value.length - 1)) / Math.min(256, lineCount)));
      return { anchor: Math.max(0, offset), head: Math.max(0, offset), preferredColumn: null };
    }))
    : undefined;
  const controller = selection ? createEditorController({ value, selection }) : undefined;
  const started = performance.now();
  const editor = createEditor(mount, { filePath: "bench/fixture.ts", value, controller, languageServices, theme: phTheme, softWrap: fixture === "soft-wrap" });
  const syncMs = performance.now() - started;
  await nextPaint(); const nextPaintMs = performance.now() - started;
  if (treeSitter?.lifecycle?.whenReady) {
    await treeSitter.lifecycle.whenReady();
    await editor.controller.refreshLanguage({ forceDocumentSync: true, refreshLineChanges: false });
  }
  if (condition === "diagnostic-heavy") {
    await editor.controller.refreshLanguage({ refreshHighlights: false, refreshDiagnostics: true, refreshLineChanges: false });
    const deadline = performance.now() + 5_000;
    while (editor.controller.getPresentationState().language.diagnostics.length < lineCount && performance.now() < deadline) {
      await nextPaint();
    }
    if (editor.controller.getPresentationState().language.diagnostics.length < lineCount) throw new Error("Diagnostic-heavy fixture did not become interactive");
  }
  const firstInteractiveMs = performance.now() - started;
  await settledAfterPaint(); const settledMs = performance.now() - started;
  editor.focus();
  const textarea = mount.querySelector("[data-wx-editor='input']");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Benchmark could not find editor textarea");
  return { editor, textarea, syncMs, nextPaintMs, firstInteractiveMs, settledMs };
}

async function measureAction(textarea: HTMLTextAreaElement, action: () => void): Promise<{ sync: number; nextPaint: number; settled: number }> {
  const started = performance.now(); action(); const sync = performance.now() - started;
  await nextPaint(); const paintedMs = performance.now() - started;
  await settledAfterPaint(); return { sync, nextPaint: paintedMs, settled: performance.now() - started };
}
function metric(): Metric { return { samples: [], unit: "ms" }; }
function push(target: Record<string, Metric | null>, name: string, value: number): void { (target[name] ??= metric())?.samples.push(value); }

async function runScenario(mount: HTMLDivElement, spec: { id: string; useLanguage: boolean; fixture: string; action: "mount" | "motion" | "newline"; condition?: "none" | "many-selection" | "diagnostic-heavy" }, options: BenchmarkRunOptions): Promise<BenchmarkScenario> {
  const metrics: Record<string, Metric | null> = { synchronousMs: metric(), nextPaintMs: metric(), firstInteractiveMs: spec.action === "mount" ? metric() : null, settledMs: metric(), domNodes: { samples: [], unit: "count" }, materializedVisualRows: { samples: [], unit: "count" }, outputBytes: null, heapBytes: null, rssBytes: null, workerMessageBytes: null };
  let firstMemory: number | null = null;
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    mount.replaceChildren();
    const mounted = await mountEditor(mount, options.lineCount, spec.useLanguage, spec.fixture, spec.condition ?? "none");
    try {
      if (spec.action === "mount") { push(metrics, "synchronousMs", mounted.syncMs); push(metrics, "nextPaintMs", mounted.nextPaintMs); push(metrics, "firstInteractiveMs", mounted.firstInteractiveMs); push(metrics, "settledMs", mounted.settledMs); }
      else {
        const result = await measureAction(mounted.textarea, () => {
          if (spec.action === "motion") { for (let index = 0; index < 200; index += 1) dispatchKey(mounted.textarea, "j"); }
          else { dispatchKey(mounted.textarea, "g"); dispatchKey(mounted.textarea, "g"); dispatchKey(mounted.textarea, "i"); dispatchLineBreak(mounted.textarea); dispatchKey(mounted.textarea, "Escape"); }
        });
        push(metrics, "synchronousMs", result.sync); push(metrics, "nextPaintMs", result.nextPaint); push(metrics, "settledMs", result.settled);
      }
      metrics.domNodes?.samples.push(mount.querySelectorAll("*").length);
      metrics.materializedVisualRows?.samples.push(mounted.editor.controller.getPresentationState().viewport.visualRows.length);
      const memory = await memoryBytes(); if (memory !== null) { firstMemory ??= memory; (metrics.heapBytes ??= { samples: [], unit: "bytes" }).samples.push(memory - firstMemory); }
    } finally { mounted.editor.destroy(); mount.replaceChildren(); }
  }
  return { id: spec.id, workload: spec.action, state: spec.action === "mount" ? "cold" : "warm", fixture: `${options.lineCount}-line-${spec.fixture}`, metrics, capabilities: { heapMeasurement: metrics.heapBytes !== null, browserRss: false, workerMessageBytes: false, ansiOutputBytes: false, viewportScopedLayout: true } };
}

export function installBenchmarkHarness(app: HTMLDivElement): void {
  app.innerHTML = '<main class="workspace"><div id="mount-editor" class="workspace__editor"></div></main>';
  const mount = app.querySelector<HTMLDivElement>("#mount-editor"); if (!mount) throw new Error("Benchmark harness could not find mount point");
  window.__wxBench = { async runSuite(input = {}) {
    const options = { ...DEFAULT_OPTIONS, ...input };
    const smoke = [
      { id: "dom.mount.no-language", useLanguage: false, fixture: "typescript", action: "mount" as const },
      { id: "dom.key-to-paint.motion-200", useLanguage: false, fixture: "typescript", action: "motion" as const },
      { id: "dom.key-to-paint.newline", useLanguage: false, fixture: "typescript", action: "newline" as const },
      { id: "treesitter.mount.typescript", useLanguage: true, fixture: "typescript", action: "mount" as const }
    ];
    const full = [...smoke,
      { id: "dom.key-to-paint.unicode", useLanguage: false, fixture: "unicode", action: "newline" as const },
      { id: "dom.key-to-paint.long-line", useLanguage: false, fixture: "long-line", action: "motion" as const },
      { id: "dom.key-to-paint.soft-wrap", useLanguage: false, fixture: "soft-wrap", action: "motion" as const },
      { id: "dom.key-to-paint.many-selection", useLanguage: false, fixture: "typescript", action: "motion" as const, condition: "many-selection" as const },
      { id: "dom.key-to-paint.diagnostic-heavy", useLanguage: false, fixture: "typescript", action: "newline" as const, condition: "diagnostic-heavy" as const }
    ];
    const scenarios: BenchmarkScenario[] = [];
    for (const spec of options.suite === "full" ? full : smoke) scenarios.push(await runScenario(mount, spec, options));
    return { formatVersion: 1, scenarios };
  } };
}
