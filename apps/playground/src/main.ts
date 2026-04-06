import sceneLangWasmUrl from "./assets/scene-lang.wasm?url";
import { installBenchmarkHarness } from "./benchmarkHarness";
import { phTheme } from "./phTheme";

import { createCharacterSelection, createTextDocument } from "@wx/editor-core";
import { createEditorController } from "@wx/editor-controller";
import {
  createSceneLangWasm,
  type SceneLangWasm,
  type ShaderCompileResult
} from "@wx/scene-lang-wasm";
import { createSceneLangLanguageServices } from "@wx/scene-lang-worker";
import { createEditor } from "@wx/editor-view-dom";

import "./style.css";

const shaderFilePath = "examples/demo.shader";

const fallbackSample = `shader
uniform clock float builtin time
uniform viewport vec2 builtin resolution

vertex
  position fullscreen

fragment
  color
    r 0.5 + 0.5 * sin(clock + uv.x * 6.0)
    g 0.5 + 0.5 * sin(clock * 0.7 + uv.y * 8.0)
    b 0.35 + 0.65 * uv.x
    a 1.0
  clor
`;

type LineChangeKind = "added" | "modified";

function splitLines(text: string): string[] {
  return text.split("\n");
}

function computeLineChanges(baseText: string, currentText: string): Array<{ line: number; kind: LineChangeKind }> {
  const baseLines = splitLines(baseText);
  const currentLines = splitLines(currentText);
  const rowCount = baseLines.length + 1;
  const columnCount = currentLines.length + 1;
  const dp = Array.from({ length: rowCount }, () => new Array<number>(columnCount).fill(0));

  for (let row = baseLines.length - 1; row >= 0; row -= 1) {
    for (let column = currentLines.length - 1; column >= 0; column -= 1) {
      dp[row]![column] =
        baseLines[row] === currentLines[column]
          ? 1 + dp[row + 1]![column + 1]!
          : Math.max(dp[row + 1]![column]!, dp[row]![column + 1]!);
    }
  }

  const matches: Array<[number, number]> = [];
  let row = 0;
  let column = 0;

  while (row < baseLines.length && column < currentLines.length) {
    if (baseLines[row] === currentLines[column]) {
      matches.push([row, column]);
      row += 1;
      column += 1;
      continue;
    }

    if (dp[row + 1]![column]! >= dp[row]![column + 1]!) {
      row += 1;
    } else {
      column += 1;
    }
  }

  const anchors: Array<[number, number]> = [[-1, -1], ...matches, [baseLines.length, currentLines.length]];
  const changes: Array<{ line: number; kind: LineChangeKind }> = [];

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const [baseAnchor, currentAnchor] = anchors[index]!;
    const [nextBase, nextCurrent] = anchors[index + 1]!;
    const baseCount = nextBase - baseAnchor - 1;
    const currentCount = nextCurrent - currentAnchor - 1;

    if (currentCount <= 0) {
      continue;
    }

    const kind: LineChangeKind = baseCount === 0 ? "added" : "modified";

    for (let line = currentAnchor + 1; line < nextCurrent; line += 1) {
      changes.push({ line, kind });
    }
  }

  return changes;
}

function hasDevBridge(): boolean {
  return Boolean(import.meta.env.DEV);
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

async function loadInitialShaderSource(): Promise<string> {
  if (!hasDevBridge()) {
    return fallbackSample;
  }

  try {
    const response = await fetch(`/__wx__/read?file=${encodeURIComponent(shaderFilePath)}`);

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = await response.json() as { text?: string };
    return typeof payload.text === "string" ? payload.text : fallbackSample;
  } catch {
    return fallbackSample;
  }
}

class ShaderPreview {
  private readonly mount: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly errorPanel: HTMLDivElement;
  private readonly runtime: SceneLangWasm;
  private readonly resizeObserver: ResizeObserver;

  private adapter: any = null;
  private device: any = null;
  private context: any = null;
  private format: string | null = null;
  private bindGroupLayout: any = null;
  private bindGroup: any = null;
  private uniformBuffer: any = null;
  private pipeline: any = null;
  private currentCompile: ShaderCompileResult | null = null;
  private animationFrame = 0;
  private startedAt = 0;

  constructor(mount: HTMLDivElement, runtime: SceneLangWasm) {
    this.mount = mount;
    this.runtime = runtime;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "shader-preview__canvas";
    this.canvas.dataset.shaderPreviewCanvas = "true";
    this.errorPanel = document.createElement("div");
    this.errorPanel.className = "shader-preview__error";
    this.errorPanel.dataset.shaderPreviewError = "true";
    this.mount.replaceChildren(this.canvas, this.errorPanel);
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      if (this.currentCompile?.ok && !this.currentCompile.usesTime) {
        this.drawFrame(0);
      }
    });
    this.resizeObserver.observe(this.mount);
  }

  async renderSource(source: string): Promise<void> {
    const compiled = this.runtime.compile(source);
    this.currentCompile = compiled;

    if (!compiled.ok || !compiled.wgsl) {
      this.stopAnimation();
      this.showError(compiled.error ?? "Shader compile failed.");
      return;
    }

    const ready = await this.ensureContext();
    if (!ready) {
      this.showError("WebGPU is unavailable in this browser.");
      return;
    }

    this.resizeCanvas();

    try {
      const shaderModule = this.device.createShaderModule({ code: compiled.wgsl });
      if (typeof shaderModule.getCompilationInfo === "function") {
        const info = await shaderModule.getCompilationInfo();
        const shaderErrors = info.messages.filter((message: { type: string }) => message.type === "error");
        if (shaderErrors.length > 0) {
          this.stopAnimation();
          this.showError(shaderErrors.map((message: { message: string }) => message.message).join("\n"));
          return;
        }
      }

      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      });
      this.pipeline = this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: "vs_main"
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fs_main",
          targets: [{ format: this.format }]
        },
        primitive: {
          topology: "triangle-list"
        }
      });
    } catch (error) {
      this.stopAnimation();
      this.showError(error instanceof Error ? error.message : String(error));
      return;
    }

    this.mount.dataset.shaderPreviewState = "ready";
    this.canvas.hidden = false;
    this.errorPanel.hidden = true;
    this.startedAt = performance.now();

    if (compiled.usesTime) {
      this.startAnimation();
    } else {
      this.stopAnimation();
      this.drawFrame(0);
    }
  }

  destroy(): void {
    this.stopAnimation();
    this.resizeObserver.disconnect();
  }

  private async ensureContext(): Promise<boolean> {
    if (this.device && this.context) {
      return true;
    }

    const gpu = (navigator as Navigator & { gpu?: any }).gpu;
    if (!gpu) {
      return false;
    }

    this.adapter = await gpu.requestAdapter();
    if (!this.adapter) {
      return false;
    }

    this.device = await this.adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu");
    if (!this.device || !this.context) {
      return false;
    }

    this.format = typeof gpu.getPreferredCanvasFormat === "function" ? gpu.getPreferredCanvasFormat() : "bgra8unorm";
    const shaderStage = (globalThis as { GPUShaderStage?: { VERTEX: number; FRAGMENT: number } }).GPUShaderStage;
    const bufferUsage = (globalThis as { GPUBufferUsage?: { UNIFORM: number; COPY_DST: number } }).GPUBufferUsage;

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: (shaderStage?.VERTEX ?? 1) | (shaderStage?.FRAGMENT ?? 2),
          buffer: { type: "uniform" }
        }
      ]
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 32,
      usage: (bufferUsage?.UNIFORM ?? 64) | (bufferUsage?.COPY_DST ?? 8)
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        }
      ]
    });

    return true;
  }

  private resizeCanvas(): void {
    if (!this.device || !this.context || !this.format) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.floor(this.mount.clientWidth * devicePixelRatio));
    const nextHeight = Math.max(1, Math.floor(this.mount.clientHeight * devicePixelRatio));

    if (this.canvas.width !== nextWidth) {
      this.canvas.width = nextWidth;
    }
    if (this.canvas.height !== nextHeight) {
      this.canvas.height = nextHeight;
    }

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque"
    });
  }

  private drawFrame(timeSeconds: number): void {
    if (!this.device || !this.context || !this.pipeline || !this.bindGroup || !this.uniformBuffer) {
      return;
    }

    const uniforms = new Float32Array([
      timeSeconds,
      0,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      0,
      0
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const commandEncoder = this.device.createCommandEncoder();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1 },
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.draw(3);
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  private startAnimation(): void {
    this.stopAnimation();
    const tick = (now: number) => {
      this.animationFrame = window.requestAnimationFrame(tick);
      this.drawFrame((now - this.startedAt) / 1000);
    };
    this.animationFrame = window.requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.animationFrame !== 0) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }

  private showError(message: string): void {
    this.mount.dataset.shaderPreviewState = "error";
    this.errorPanel.textContent = message;
    this.errorPanel.hidden = false;
    this.canvas.hidden = true;
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
  const sample = await loadInitialShaderSource();
  const initialSelectionOffset = Math.max(0, sample.indexOf("clor"));
  const controller = createEditorController({
    value: sample,
    selection: createCharacterSelection(createTextDocument(sample), initialSelectionOffset)
  });

  app.innerHTML = `
    <main class="workspace">
      <div id="mount-editor" class="workspace__editor"></div>
      <aside class="workspace__preview">
        <div id="mount-preview" class="shader-preview" data-shader-preview="true"></div>
      </aside>
    </main>
  `;

  const mount = app.querySelector<HTMLDivElement>("#mount-editor");
  const previewMount = app.querySelector<HTMLDivElement>("#mount-preview");

  if (mount && previewMount) {
    const preview = new ShaderPreview(previewMount, sceneRuntime);
    const devBridgeEnabled = hasDevBridge();
    const memoryFiles = new Map<string, string>([[shaderFilePath, sample]]);

    const editor = createEditor(mount, {
      controller,
      filePath: shaderFilePath,
      languageServices: sceneLanguageServices,
      host: devBridgeEnabled
        ? {
            async writeFile(context) {
              await requestJson("/__wx__/write", context);
            },
            async didWriteFile(context) {
              await preview.renderSource(context.text);
            },
            async getLineChanges(context) {
              const payload = await requestJson<{ changes: Array<{ line: number; kind: "added" | "modified" | "deleted" }> }>(
                "/__wx__/line-changes",
                context
              );
              return payload.changes;
            }
          }
        : {
            async writeFile(context) {
              memoryFiles.set(context.filePath, context.text);
            },
            async didWriteFile(context) {
              await preview.renderSource(context.text);
            },
            async getLineChanges(context) {
              return computeLineChanges(memoryFiles.get(context.filePath) ?? "", context.text);
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

    void preview.renderSource(controller.getState().doc.text);
    editor.focus();
    window.addEventListener(
      "beforeunload",
      () => {
        preview.destroy();
      },
      { once: true }
    );
  }
}

void main();
