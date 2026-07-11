import { installBenchmarkHarness } from "./benchmarkHarness";
import { wxHostClient } from "./host-client";
import { createCharacterSelection, createTextDocument } from "@mewhhaha/wx-core";
import { createEditorController } from "@mewhhaha/wx-controller";
import { phTheme, playgroundThemes } from "@mewhhaha/wx-theme";
import { createEditor } from "@mewhhaha/wx-dom";
import "./style.css";

const shaderFilePath = "examples/demo.wgsl";
const fallbackSample = `@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(points[index], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f { return vec4f(0.2, 0.5, 0.9, 1.0); }
`;

type StatusState = "loading" | "ready" | "failed" | "disabled" | "retrying";

function hasDevBridge(): boolean { return Boolean(import.meta.env.DEV); }
function sourceFromUrl(): string | null {
  const url = new URL(window.location.href);
  return url.searchParams.has("src") ? (url.searchParams.get("src") ?? "") : null;
}
function setSourceInUrl(source: string): void {
  const url = new URL(window.location.href); url.searchParams.set("src", source); window.history.replaceState({}, "", url);
}
function lineChanges(base: string, current: string): Array<{ line: number; kind: "added" | "modified" }> {
  const oldLines = base.split("\n"); const newLines = current.split("\n"); const result: Array<{ line: number; kind: "added" | "modified" }> = [];
  for (let index = 0; index < newLines.length; index += 1) if (oldLines[index] !== newLines[index]) result.push({ line: index, kind: index < oldLines.length ? "modified" : "added" });
  return result;
}
function matchesWorkspaceGlob(filePath: string, patterns: readonly string[] | undefined): boolean {
  return !patterns?.length || patterns.some((pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(filePath));
}

function statusRow(id: string, label: string): HTMLDivElement {
  const row = document.createElement("div"); row.className = "feature-status"; row.dataset.featureStatus = id;
  const text = document.createElement("span"); text.dataset.featureStatusMessage = id; text.textContent = `${label}: loading…`;
  const retry = document.createElement("button"); retry.type = "button"; retry.className = "feature-status__retry"; retry.textContent = "Retry"; retry.hidden = true; retry.dataset.featureRetry = id;
  row.append(text, retry); return row;
}

function setStatus(row: HTMLElement, label: string, state: StatusState, detail?: string): void {
  row.dataset.featureState = state;
  const text = row.querySelector<HTMLElement>("[data-feature-status-message]");
  const retry = row.querySelector<HTMLButtonElement>("[data-feature-retry]");
  if (text) text.textContent = `${label}: ${state}${detail ? ` — ${detail}` : ""}`;
  if (retry) retry.hidden = state !== "failed" && state !== "disabled";
}

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app"); if (!app) return;
  if (new URL(window.location.href).searchParams.has("bench")) { installBenchmarkHarness(app); return; }
  if (new URL(window.location.href).searchParams.has("soak")) {
    app.replaceChildren();
    app.dataset.wxSoakHost = "ready";
    return;
  }
  const fixture = new URL(window.location.href).searchParams.get("fixture");
  const editorOnly = fixture === "editor" || fixture === "language";
  const sample = sourceFromUrl() ?? fallbackSample;
  const controller = createEditorController({ value: sample, selection: createCharacterSelection(createTextDocument(sample), Math.max(0, sample.indexOf("@fragment"))) });
  app.replaceChildren();
  const workspace = document.createElement("main"); workspace.className = editorOnly ? "workspace workspace--editor-only" : "workspace";
  const mount = document.createElement("div"); mount.className = "workspace__editor"; mount.id = "mount-editor";
  const status = document.createElement("aside"); status.className = "workspace__status"; status.append(statusRow("language", "Syntax services"));
  workspace.append(mount, status);
  let previewMount: HTMLDivElement | null = null;
  if (!editorOnly) { const aside = document.createElement("aside"); aside.className = "workspace__preview"; previewMount = document.createElement("div"); previewMount.className = "shader-preview"; previewMount.dataset.shaderPreview = "true"; aside.append(previewMount); workspace.append(aside); status.append(statusRow("preview", "Preview")); }
  app.append(workspace);

  const memoryFiles = new Map([[shaderFilePath, sample]]);
  let preview: import("./preview").PreviewHandle | null = null;
  const host = hasDevBridge() ? {
    readFile: (context: { filePath: string }) => wxHostClient.readFile(context), searchFiles: async (context: { filePath: string; query: string }) => (await wxHostClient.searchFiles({ ...context, scope: "repo" })).files, searchWorkspace: async ({ signal, ...context }: import("@mewhhaha/wx-controller").EditorWorkspaceSearchRequest) => (await wxHostClient.searchWorkspace({ ...context, include: context.include ? [...context.include] : undefined, exclude: context.exclude ? [...context.exclude] : undefined }, signal)).results,
    listFolders: async (context: { filePath: string }) => (await wxHostClient.listFolders(context)).folders, writeFile: async (context: { filePath: string; text: string; expectedText?: string | null }) => { await wxHostClient.writeFile(context); },
    didWriteFile: (context: { text: string }) => { setSourceInUrl(context.text); preview?.schedule(context.text); }, getLineChanges: async (context: { filePath: string; text: string }) => (await wxHostClient.lineChanges(context)).changes
  } : {
    async readFile(context: { filePath: string }) { return { text: memoryFiles.get(context.filePath) ?? "" }; }, async searchFiles(context: { query: string }) { return [...memoryFiles.keys()].filter((path) => path.includes(context.query)).map((filePath) => ({ filePath })); }, async searchWorkspace(context: import("@mewhhaha/wx-controller").EditorWorkspaceSearchRequest) { const sensitive = context.case === "sensitive" || (context.case === "smart" && /[A-Z]/.test(context.query)); let expression: RegExp; try { expression = new RegExp(context.mode === "literal" ? context.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : context.query, `${sensitive ? "" : "i"}gu`); } catch { return []; } const results = []; for (const [filePath, text] of memoryFiles) { if (!matchesWorkspaceGlob(filePath, context.include) || (context.exclude?.length && matchesWorkspaceGlob(filePath, context.exclude))) continue; for (const [line, preview] of text.split(/\r?\n/).entries()) { expression.lastIndex = 0; for (const match of preview.matchAll(expression)) { results.push({ filePath, line, fromColumn: match.index, toColumn: match.index + match[0].length, preview }); if (results.length >= context.limit) return results; } } } return results; }, async listFolders() { return [{ folderPath: "." }, { folderPath: "examples" }]; },
    async writeFile(context: { filePath: string; text: string; expectedText?: string | null }) { if (context.expectedText !== undefined && memoryFiles.get(context.filePath) !== context.expectedText) throw new Error("File changed on disk"); memoryFiles.set(context.filePath, context.text); }, didWriteFile(context: { text: string }) { setSourceInUrl(context.text); preview?.schedule(context.text); }, async getLineChanges(context: { filePath: string; text: string }) { return lineChanges(memoryFiles.get(context.filePath) ?? "", context.text); }
  };
  if (hasDevBridge() && new URL(window.location.href).searchParams.has("host-test")) (window as Window & { __wxHostTestAdapter?: typeof host }).__wxHostTestAdapter = host;
  const editor = createEditor(mount, { controller, filePath: shaderFilePath, host, theme: phTheme, commandThemes: playgroundThemes, softWrap: true, indentGuides: { render: true, character: "╎", skipLevels: 1 } });
  editor.focus();

  const languageRow = status.querySelector<HTMLElement>("[data-feature-status='language']")!;
  async function startLanguage(): Promise<void> {
    setStatus(languageRow, "Syntax services", "retrying");
    try {
      if (new URL(window.location.href).searchParams.has("fail-language")) throw new Error("Tree-sitter request failed (test fixture)");
      const [{ createSceneLangLanguageServices }, { default: wasmUrl }] = await Promise.all([import("@wx/scene-lang-worker"), import("@wx/scene-lang-wasm/scene-lang.wasm?url")]);
      const services = createSceneLangLanguageServices({ wasmUrl, owner: "controller" });
      await editor.setLanguageServices(services);
      const lifecycle = Array.isArray(services) ? services[0]?.lifecycle : services.lifecycle;
      await lifecycle?.whenReady?.();
      setStatus(languageRow, "Syntax services", "ready");
    } catch (cause) { setStatus(languageRow, "Syntax services", "failed", cause instanceof Error ? cause.message : String(cause)); }
  }
  languageRow.querySelector<HTMLButtonElement>("[data-feature-retry]")!.addEventListener("click", () => {
    void (async () => {
      setStatus(languageRow, "Syntax services", "retrying");
      if (await controller.retryLanguageServices()) {
        setStatus(languageRow, "Syntax services", "ready");
        return;
      }
      await startLanguage();
    })();
  });
  if (fixture === "editor") setStatus(languageRow, "Syntax services", "disabled", "editor-only fixture"); else void startLanguage();

  if (previewMount) {
    const previewRow = status.querySelector<HTMLElement>("[data-feature-status='preview']")!;
    let previewStartup: Promise<void> | null = null;
    const startPreview = (): Promise<void> => {
      if (previewStartup) return previewStartup;
      previewStartup = (async () => {
        if (preview) {
          await preview.retry();
          return;
        }
        setStatus(previewRow, "Preview", "retrying");
        try {
          const module = await import("./preview");
          preview = module.createPreview(previewMount, (state, message) => setStatus(previewRow, "Preview", state, message));
          // Seed the source before startup so a retry always compiles the
          // current document, including after a failed lazy module fetch.
          preview.schedule(controller.getState().doc.text);
          await preview.retry();
        } catch (cause) {
          preview?.destroy();
          preview = null;
          setStatus(previewRow, "Preview", "failed", cause instanceof Error ? cause.message : String(cause));
        }
      })().finally(() => { previewStartup = null; });
      return previewStartup;
    };
    previewRow.querySelector<HTMLButtonElement>("[data-feature-retry]")!.addEventListener("click", () => { void startPreview(); });
    void startPreview();
  }
  window.addEventListener("beforeunload", () => { preview?.destroy(); editor.destroy(); controller.destroy(); }, { once: true });
}

void main().catch((error) => { console.error("Playground startup failed", error); });
