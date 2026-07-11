import sceneLangWasmUrl from "@wx/scene-lang-wasm/scene-lang.wasm?url";
import { createSceneLangWasm, type SceneLangWasm } from "@wx/scene-lang-wasm";

export type PreviewState = "loading" | "ready" | "failed" | "disabled";

export interface PreviewHandle {
  retry(): Promise<void>;
  schedule(source: string): void;
  destroy(): void;
}

interface PreviewRuntime {
  compile(source: string): ReturnType<SceneLangWasm["compile"]>;
}

export interface PreviewDependencies {
  createRuntime?: () => Promise<PreviewRuntime>;
  getGpu?: () => any;
  getCanvasContext?: (canvas: HTMLCanvasElement) => any;
  createResizeObserver?: (callback: ResizeObserverCallback) => Pick<ResizeObserver, "observe" | "disconnect">;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

/** Optional WebGPU surface. Its lifetime is deliberately independent of the editor. */
export function createPreview(
  mount: HTMLDivElement,
  notify: (state: PreviewState, message?: string) => void,
  dependencies: PreviewDependencies = {}
): PreviewHandle {
  const createRuntime = dependencies.createRuntime ?? (() => createSceneLangWasm({ wasmUrl: sceneLangWasmUrl }));
  const getGpu = dependencies.getGpu ?? (() => (navigator as Navigator & { gpu?: any }).gpu);
  const getCanvasContext = dependencies.getCanvasContext ?? ((target) => target.getContext("webgpu"));
  const createResizeObserver = dependencies.createResizeObserver ?? ((callback) => new ResizeObserver(callback));
  const requestFrame = dependencies.requestAnimationFrame ?? requestAnimationFrame;
  const cancelFrame = dependencies.cancelAnimationFrame ?? cancelAnimationFrame;
  const canvas = document.createElement("canvas");
  const error = document.createElement("div");
  const retry = document.createElement("button");
  canvas.className = "shader-preview__canvas";
  canvas.dataset.shaderPreviewCanvas = "true";
  error.className = "shader-preview__error";
  error.dataset.shaderPreviewError = "true";
  retry.className = "feature-status__retry";
  retry.type = "button";
  retry.textContent = "Retry preview";
  retry.addEventListener("click", () => { void start(); });
  mount.replaceChildren(canvas, error, retry);

  let runtime: PreviewRuntime | null = null;
  let device: any = null;
  let context: any = null;
  let format: string | null = null;
  let pipeline: any = null;
  let frame = 0;
  let scheduled = 0;
  let source = "";
  let generation = 0;
  let destroyed = false;
  let uniformBuffer: any = null;
  const observer = createResizeObserver(() => { if (pipeline) void draw(); });
  observer.observe(mount);

  function fail(reason: unknown): void {
    if (destroyed) return;
    const message = reason instanceof Error ? reason.message : String(reason);
    cancel();
    release();
    mount.dataset.shaderPreviewState = "error";
    error.textContent = `Preview unavailable: ${message}`;
    error.hidden = false;
    retry.hidden = false;
    canvas.hidden = true;
    notify("failed", message);
  }

  function cancel(): void {
    if (frame) cancelFrame(frame);
    if (scheduled) cancelFrame(scheduled);
    frame = 0;
    scheduled = 0;
  }

  function release(): void {
    const ownedDevice = device;
    try { uniformBuffer?.destroy?.(); } catch { /* best effort GPU teardown */ }
    try { ownedDevice?.destroy?.(); } catch { /* best effort GPU teardown */ }
    uniformBuffer = null;
    pipeline = null;
    device = null;
    context = null;
    format = null;
  }

  async function ensureContext(token: number): Promise<boolean> {
    if (device && context && format) return true;
    const gpu = getGpu();
    if (!gpu) { notify("disabled", "WebGPU is not available in this browser."); return false; }
    const adapter = await gpu.requestAdapter();
    if (destroyed || token !== generation) return false;
    if (!adapter) throw new Error("WebGPU did not provide an adapter.");
    const nextDevice = await adapter.requestDevice();
    if (destroyed || token !== generation) { try { nextDevice.destroy?.(); } catch {} return false; }
    const nextContext = getCanvasContext(canvas);
    if (!nextContext) {
      try { nextDevice.destroy?.(); } catch { /* best effort GPU teardown */ }
      throw new Error("WebGPU canvas context is unavailable.");
    }
    device = nextDevice;
    context = nextContext;
    format = typeof gpu.getPreferredCanvasFormat === "function" ? gpu.getPreferredCanvasFormat() : "bgra8unorm";
    Promise.resolve(nextDevice.lost).then((reason: { message?: string } | undefined) => {
      if (!destroyed && device === nextDevice) fail(reason?.message || "The WebGPU device was lost.");
    }).catch((reason: unknown) => {
      if (!destroyed && device === nextDevice) fail(reason);
    });
    return true;
  }

  function resize(): void {
    if (!device || !context || !format) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(mount.clientWidth * ratio));
    canvas.height = Math.max(1, Math.floor(mount.clientHeight * ratio));
    context.configure({ device, format, alphaMode: "opaque" });
  }

  async function compileAndRender(token: number): Promise<void> {
    if (!runtime || destroyed || token !== generation) return;
    const compiled = runtime.compile(source);
    if (!compiled.ok || !compiled.wgsl) throw new Error(compiled.error ?? "Shader compile failed.");
    if (!await ensureContext(token) || destroyed || token !== generation) return;
    resize();
    const module = device.createShaderModule({ code: compiled.wgsl });
    if (typeof module.getCompilationInfo === "function") {
      const info = await module.getCompilationInfo();
      if (destroyed || token !== generation) return;
      const messages = info.messages.filter((entry: { type: string }) => entry.type === "error");
      if (messages.length) throw new Error(messages.map((entry: { message: string }) => entry.message).join("\n"));
    }
    // A self-contained pipeline keeps preview errors at this boundary; shader code supplies both entry points.
    pipeline = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs_main" }, fragment: { module, entryPoint: "fs_main", targets: [{ format }] }, primitive: { topology: "triangle-list" } });
    if (destroyed || token !== generation) return;
    mount.dataset.shaderPreviewState = "ready";
    error.hidden = true;
    retry.hidden = true;
    canvas.hidden = false;
    notify("ready");
    await draw();
  }

  async function draw(): Promise<void> {
    try {
      if (!device || !context || !pipeline || destroyed) return;
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: .02, g: .02, b: .03, a: 1 }, loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline); pass.draw(3); pass.end(); device.queue.submit([encoder.finish()]);
    } catch (cause) { fail(cause); }
  }

  async function start(): Promise<void> {
    const token = ++generation;
    cancel(); release();
    notify("loading");
    try {
      runtime = await createRuntime();
      if (destroyed || token !== generation) return;
      await compileAndRender(token);
    } catch (cause) { if (token === generation) fail(cause); }
  }

  return {
    retry: start,
    schedule(next) {
      source = next;
      if (scheduled || !runtime) return;
      scheduled = requestFrame(() => { scheduled = 0; const token = ++generation; void compileAndRender(token).catch(fail); });
    },
    destroy() { destroyed = true; ++generation; cancel(); observer.disconnect(); retry.remove(); release(); }
  };
}
