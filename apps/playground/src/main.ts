import sceneLangWasmUrl from "./assets/scene-lang.wasm?url";
import { installBenchmarkHarness } from "./benchmarkHarness";
import { phTheme } from "./phTheme";

import { createCharacterSelection, createTextDocument } from "@wx/editor-core";
import { createEditorController } from "@wx/editor-controller";
import { createSceneLangWasm, renderCompiledScene, type ScenePreviewFrame } from "@wx/scene-lang-wasm";
import { createSceneLangLanguageServices } from "@wx/scene-lang-worker";
import { createEditor } from "@wx/editor-view-dom";

import "./style.css";

const fallbackSample = `screen
  size fill

  status
    left " NOR "
    file "examples/editor.scene"
    right "10:8"

  line 8
    gutter number 8
    text "status file is owned by the status block"
    diagnostic info at 0
      eol "The status block renders once per frame"

  line 9
    guttr number 9
    text "const message = greet(user.name)"
    diagnostic warning at 18
      eol "Replace guttr with gutter"

  line 10
    gutter number 10
    text "return message"
    diagnostic error at 0
      below "expected number, got string"

  cursor block at line 10 col 6
`;

const previewStyles = new Map<number, string>([
  [0, "scene-preview__cell--text"],
  [1, "scene-preview__cell--status"],
  [2, "scene-preview__cell--gutter"],
  [3, "scene-preview__cell--warning"],
  [4, "scene-preview__cell--error"],
  [5, "scene-preview__cell--info"],
  [6, "scene-preview__cell--hint"],
  [7, "scene-preview__cell--cursor"]
]);

function renderPreviewFrame(mount: HTMLDivElement, frame: ScenePreviewFrame): void {
  mount.replaceChildren();

  const surface = document.createElement("div");
  surface.className = "scene-preview__surface";
  surface.style.setProperty("--scene-preview-columns", String(frame.width));

  for (const row of frame.rows) {
    const line = document.createElement("div");
    line.className = "scene-preview__line";
    line.style.setProperty("--scene-preview-columns", String(frame.width));

    for (const cell of row) {
      const span = document.createElement("span");
      span.className = `scene-preview__cell ${previewStyles.get(cell.style) ?? "scene-preview__cell--text"}`;
      span.textContent = cell.char === " " ? "\u00a0" : cell.char;
      line.append(span);
    }
    surface.append(line);
  }

  mount.append(surface);
}

function renderPreviewError(mount: HTMLDivElement, error: unknown): void {
  mount.innerHTML = "";
  const panel = document.createElement("div");
  panel.className = "scene-preview__error";
  panel.textContent = error instanceof Error ? error.message : String(error);
  mount.append(panel);
}

function measurePreviewGrid(preview: HTMLDivElement): { width: number; height: number } {
  const surfaceProbe = document.createElement("div");
  const probe = document.createElement("span");
  surfaceProbe.className = "scene-preview__surface";
  probe.className = "scene-preview__cell scene-preview__cell--text";
  probe.textContent = "M";
  surfaceProbe.style.position = "absolute";
  surfaceProbe.style.visibility = "hidden";
  surfaceProbe.style.pointerEvents = "none";
  surfaceProbe.style.inset = "0 auto auto 0";
  surfaceProbe.style.width = "auto";
  surfaceProbe.style.height = "auto";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  surfaceProbe.append(probe);
  preview.append(surfaceProbe);

  const rect = probe.getBoundingClientRect();
  surfaceProbe.remove();

  const cellWidth = rect.width > 0 ? rect.width : 9;
  const cellHeight = rect.height > 0 ? rect.height : 20;
  const computed = window.getComputedStyle(preview);
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
  const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
  const availableWidth = Math.max(cellWidth, preview.clientWidth - paddingLeft - paddingRight);
  const availableHeight = Math.max(cellHeight, preview.clientHeight - paddingTop - paddingBottom);

  return {
    width: Math.max(1, Math.floor(availableWidth / cellWidth)),
    height: Math.max(1, Math.floor(availableHeight / cellHeight))
  };
}

async function requestJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json() as T;
}

async function loadInitialSceneSource(): Promise<string> {
  try {
    const response = await fetch("/__wx__/read?file=examples/editor.scene");

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = await response.json() as { text?: string };
    return typeof payload.text === "string" ? payload.text : fallbackSample;
  } catch {
    return fallbackSample;
  }
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

  const sceneLanguageServices = createSceneLangLanguageServices({
    wasmUrl: sceneLangWasmUrl
  });
  const sceneRuntime = await createSceneLangWasm({ wasmUrl: sceneLangWasmUrl });
  const sample = await loadInitialSceneSource();
  const initialSelectionOffset = Math.max(0, sample.indexOf("guttr"));
  const controller = createEditorController({
    value: sample,
    selection: createCharacterSelection(createTextDocument(sample), initialSelectionOffset)
  });

  app.innerHTML = `
    <main class="workspace">
      <div id="mount-editor" class="workspace__editor"></div>
      <aside class="workspace__preview">
        <div id="mount-preview" class="scene-preview" data-scene-preview="true"></div>
      </aside>
    </main>
  `;

  const mount = app.querySelector<HTMLDivElement>("#mount-editor");
  const preview = app.querySelector<HTMLDivElement>("#mount-preview");

  if (mount && preview) {
    let renderRunId = 0;
    let lastRenderedSource = controller.getState().doc.text;
    let resizeFrame = 0;

    const renderPreview = async (source: string) => {
      const runId = ++renderRunId;
      lastRenderedSource = source;

      preview.dataset.scenePreviewState = "running";

      try {
        const terminalSize = measurePreviewGrid(preview);
        const compiled = sceneRuntime.compile(source);
        const frame = await renderCompiledScene(compiled, {
          width: terminalSize.width,
          height: terminalSize.height
        });

        if (runId !== renderRunId) {
          return;
        }

        preview.dataset.scenePreviewState = "ready";
        renderPreviewFrame(preview, frame);
      } catch (error) {
        if (runId !== renderRunId) {
          return;
        }

        preview.dataset.scenePreviewState = "error";
        renderPreviewError(preview, error);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== 0) {
        cancelAnimationFrame(resizeFrame);
      }

      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        void renderPreview(lastRenderedSource);
      });
    });
    resizeObserver.observe(preview);

    const editor = createEditor(mount, {
      controller,
      filePath: "examples/editor.scene",
      languageServices: sceneLanguageServices,
      host: {
        async writeFile(context) {
          await requestJson("/__wx__/write", context);
        },
        async didWriteFile(context) {
          await renderPreview(context.text);
        },
        async getLineChanges(context) {
          const payload = await requestJson<{ changes: Array<{ line: number; kind: "added" | "modified" }> }>(
            "/__wx__/line-changes",
            context
          );
          return payload.changes;
        }
      },
      theme: phTheme,
      softWrap: true,
      indentGuides: {
        render: true,
        character: "╎",
        skipLevels: 1
      }
    });

    void renderPreview(controller.getState().doc.text);
    editor.focus();
    window.addEventListener(
      "beforeunload",
      () => {
        resizeObserver.disconnect();
        if (resizeFrame !== 0) {
          cancelAnimationFrame(resizeFrame);
        }
      },
      { once: true }
    );
  }
}

void main();
