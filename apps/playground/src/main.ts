import sceneLangWasmUrl from "./assets/scene-lang.wasm?url";
import { installBenchmarkHarness } from "./benchmarkHarness";
import { phTheme, playgroundThemes } from "./phTheme";

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

const shaderFilePath = "examples/demo.wgsl";

const fallbackSample = `struct PreviewUniforms {
  time: f32,
  _pad0: vec3f,
  resolution: vec2f,
  _pad1: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: PreviewUniforms;
@group(0) @binding(1) var noise_texture: texture_2d<f32>;
@group(0) @binding(2) var noise_sampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

fn sd_circle(point: vec2f, radius: f32) -> f32 {
  return length(point) - radius;
}

fn sd_box(point: vec2f, half_size: vec2f) -> f32 {
  let q = abs(point) - half_size;
  return length(max(q, vec2f(0.0, 0.0))) + min(max(q.x, q.y), 0.0);
}

fn smooth_union(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn fill_mask(distance: f32, px: f32) -> f32 {
  return 1.0 - smoothstep(-px, px, distance);
}

fn stroke_mask(distance: f32, width: f32, px: f32) -> f32 {
  return 1.0 - smoothstep(width - px, width + px, abs(distance));
}

fn rotate2d(point: vec2f, angle: f32) -> vec2f {
  let s = sin(angle);
  let c = cos(angle);
  return vec2f(point.x * c - point.y * s, point.x * s + point.y * c);
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let clip = positions[index];
  var out: VertexOut;
  out.position = vec4f(clip, 0.0, 1.0);
  out.uv = clip * 0.5 + vec2f(0.5, 0.5);
  return out;
}

@fragment
fn fs_main(in_vertex: VertexOut) -> @location(0) vec4f {
  let uv = vec2f(in_vertex.uv.x, 1.0 - in_vertex.uv.y);
  let p = vec2f(
    (uv.x * 2.0 - 1.0) * (uniforms.resolution.x / max(uniforms.resolution.y, 1.0)),
    uv.y * 2.0 - 1.0,
  );
  let px = 1.0 / max(min(uniforms.resolution.x, uniforms.resolution.y), 1.0);
  let orb = sd_circle(p - vec2f(0.24 * sin(uniforms.time), 0.0), 0.26);
  let beam = sd_box(rotate2d(p, uniforms.time * 0.5), vec2f(0.24, 0.12));
  let scene = smooth_union(orb, beam, 0.18);
  let grain = textureSample(noise_texture, noise_sampler, fract(uv * 3.0 + vec2f(uniforms.time * 0.05, 0.0))).r;
  let red = fill_mask(scene, px);
  let green = stroke_mask(orb, 0.03, px);
  let blue = 0.28 / max(abs(beam), 0.001) + 0.2 * grain;
  return vec4f(red, green, blue, 1.0);
}
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

function getSourceFromUrl(locationHref: string): string | null {
  const url = new URL(locationHref);

  if (!url.searchParams.has("src")) {
    return null;
  }

  return url.searchParams.get("src") ?? "";
}

function setSourceInUrl(source: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("src", source);
  window.history.replaceState({}, "", url);
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
  const sourceFromUrl = getSourceFromUrl(window.location.href);

  if (sourceFromUrl !== null) {
    return sourceFromUrl;
  }

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
  private noiseTexture: any = null;
  private noiseSampler: any = null;
  private pipeline: any = null;
  private currentCompile: ShaderCompileResult | null = null;
  private animationFrame = 0;
  private startedAt = 0;
  private scheduledRenderFrame = 0;
  private pendingSource: string | null = null;

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

  scheduleRenderSource(source: string): void {
    this.pendingSource = source;

    if (this.scheduledRenderFrame !== 0) {
      return;
    }

    this.scheduledRenderFrame = window.requestAnimationFrame(() => {
      this.scheduledRenderFrame = 0;
      const nextSource = this.pendingSource;
      this.pendingSource = null;

      if (typeof nextSource === "string") {
        void this.renderSource(nextSource);
      }
    });
  }

  destroy(): void {
    this.stopAnimation();
    if (this.scheduledRenderFrame !== 0) {
      cancelAnimationFrame(this.scheduledRenderFrame);
      this.scheduledRenderFrame = 0;
    }
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
        },
        {
          binding: 1,
          visibility: shaderStage?.FRAGMENT ?? 2,
          texture: { sampleType: "float" }
        },
        {
          binding: 2,
          visibility: shaderStage?.FRAGMENT ?? 2,
          sampler: { type: "filtering" }
        }
      ]
    });

    this.uniformBuffer = this.device.createBuffer({
      size: 48,
      usage: (bufferUsage?.UNIFORM ?? 64) | (bufferUsage?.COPY_DST ?? 8)
    });

    this.noiseTexture = this.createNoiseTexture();
    this.noiseSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat"
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        },
        {
          binding: 1,
          resource: this.noiseTexture.createView()
        },
        {
          binding: 2,
          resource: this.noiseSampler
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

  private createNoiseTexture(): any {
    const textureUsage = (globalThis as { GPUTextureUsage?: { TEXTURE_BINDING: number; COPY_DST: number } }).GPUTextureUsage;
    const size = 128;
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = (y * size + x) * 4;
        const value = ((x * 73 + y * 151 + ((x ^ y) * 29)) % 256);
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
        data[index + 3] = 255;
      }
    }

    const texture = this.device.createTexture({
      size: { width: size, height: size, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: (textureUsage?.TEXTURE_BINDING ?? 4) | (textureUsage?.COPY_DST ?? 8)
    });

    this.device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: size * 4 },
      { width: size, height: size, depthOrArrayLayers: 1 }
    );

    return texture;
  }

  private drawFrame(timeSeconds: number): void {
    if (!this.device || !this.context || !this.pipeline || !this.bindGroup || !this.uniformBuffer) {
      return;
    }

    // Match WGSL uniform layout:
    // time: f32 @ 0
    // 12 bytes padding
    // _pad0: vec3f @ 16
    // resolution: vec2f @ 32
    // _pad1: vec2f @ 40
    const uniforms = new Float32Array(12);
    uniforms[0] = timeSeconds;
    uniforms[8] = this.canvas.width;
    uniforms[9] = this.canvas.height;
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
  const initialSelectionOffset = Math.max(0, sample.indexOf("@fragment"));
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
            didWriteFile(context) {
              setSourceInUrl(context.text);
              preview.scheduleRenderSource(context.text);
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
            didWriteFile(context) {
              setSourceInUrl(context.text);
              preview.scheduleRenderSource(context.text);
            },
            async getLineChanges(context) {
              return computeLineChanges(memoryFiles.get(context.filePath) ?? "", context.text);
            }
          },
      theme: phTheme,
      commandThemes: playgroundThemes,
      softWrap: true,
      indentGuides: {
        render: true,
        character: "╎",
        skipLevels: 1
      }
    });

    preview.scheduleRenderSource(controller.getState().doc.text);
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
