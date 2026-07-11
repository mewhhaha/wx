import { describe, expect, it, vi } from "vitest";

import {
  createPreview,
  type PreviewDependencies,
  type PreviewState
} from "../src/preview";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function compiled(source: string) {
  return {
    ok: true,
    wgsl: source,
    usesTime: false,
    usesResolution: false,
    usesNoise: false
  };
}

interface MockGpuOptions {
  compilationInfo?: (code: string) => Promise<{ messages: readonly { type: string; message: string }[] }>;
  pipelineError?: Error;
  drawError?: Error;
}

function createMockGpu(options: MockGpuOptions = {}) {
  const lost = deferred<{ message?: string }>();
  const modules: string[] = [];
  const pipelines: string[] = [];
  const context = {
    configure: vi.fn(),
    getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({})) }))
  };
  const pass = {
    setPipeline: vi.fn(),
    draw: vi.fn(),
    end: vi.fn()
  };
  const device = {
    lost: lost.promise,
    destroy: vi.fn(),
    queue: { submit: vi.fn() },
    createShaderModule: vi.fn(({ code }: { code: string }) => {
      modules.push(code);
      return {
        code,
        getCompilationInfo: () => options.compilationInfo?.(code) ?? Promise.resolve({ messages: [] })
      };
    }),
    createRenderPipeline: vi.fn((input: { vertex: { module: { code: string } } }) => {
      if (options.pipelineError) throw options.pipelineError;
      pipelines.push(input.vertex.module.code);
      return { code: input.vertex.module.code };
    }),
    createCommandEncoder: vi.fn(() => {
      if (options.drawError) throw options.drawError;
      return {
        beginRenderPass: vi.fn(() => pass),
        finish: vi.fn(() => ({}))
      };
    })
  };
  const adapter = { requestDevice: vi.fn(async () => device) };
  const gpu = {
    requestAdapter: vi.fn(async () => adapter),
    getPreferredCanvasFormat: vi.fn(() => "bgra8unorm")
  };
  return { adapter, context, device, gpu, lost, modules, pipelines };
}

function createHarness(overrides: PreviewDependencies = {}) {
  const mount = document.createElement("div");
  document.body.append(mount);
  const statuses: Array<{ state: PreviewState; message?: string }> = [];
  const observer = { observe: vi.fn(), disconnect: vi.fn() };
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const handle = createPreview(
    mount,
    (state, message) => statuses.push({ state, message }),
    {
      createRuntime: async () => ({ compile: compiled }),
      createResizeObserver: () => observer,
      requestAnimationFrame(callback) {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
      ...overrides
    }
  );
  const flushFrame = () => {
    const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) throw new Error("No preview frame was scheduled");
    frames.delete(entry[0]);
    entry[1](performance.now());
  };
  return { flushFrame, frames, handle, mount, observer, statuses };
}

describe("shader preview failure and ownership boundary", () => {
  it("disables cleanly when WebGPU is unavailable", async () => {
    const harness = createHarness({ getGpu: () => undefined });
    harness.handle.schedule("initial");
    await harness.handle.retry();
    expect(harness.statuses).toEqual([
      { state: "loading", message: undefined },
      { state: "disabled", message: "WebGPU is not available in this browser." }
    ]);
    harness.handle.destroy();
    expect(harness.observer.disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    ["adapter", "adapter rejected"],
    ["device", "device rejected"],
    ["compilation-info", "compilation info rejected"],
    ["pipeline", "pipeline rejected"],
    ["draw", "draw rejected"]
  ] as const)("contains a rejected %s boundary", async (boundary, message) => {
    const mock = createMockGpu({
      compilationInfo: boundary === "compilation-info" ? async () => { throw new Error(message); } : undefined,
      pipelineError: boundary === "pipeline" ? new Error(message) : undefined,
      drawError: boundary === "draw" ? new Error(message) : undefined
    });
    const gpu = boundary === "adapter"
      ? { ...mock.gpu, requestAdapter: vi.fn(async () => { throw new Error(message); }) }
      : boundary === "device"
        ? { ...mock.gpu, requestAdapter: vi.fn(async () => ({ requestDevice: async () => { throw new Error(message); } })) }
        : mock.gpu;
    const harness = createHarness({ getGpu: () => gpu, getCanvasContext: () => mock.context });
    harness.handle.schedule("initial");
    await harness.handle.retry();
    expect(harness.statuses.at(-1)).toEqual({ state: "failed", message });
    expect(harness.mount.dataset.shaderPreviewState).toBe("error");
    expect(harness.mount.querySelector("[data-shader-preview-error='true']")?.textContent).toContain(message);
    harness.handle.destroy();
  });

  it("invalidates an older compilation before it can publish", async () => {
    const oldInfo = deferred<{ messages: readonly { type: string; message: string }[] }>();
    const newInfo = deferred<{ messages: readonly { type: string; message: string }[] }>();
    const mock = createMockGpu({
      compilationInfo(code) {
        if (code === "old") return oldInfo.promise;
        if (code === "new") return newInfo.promise;
        return Promise.resolve({ messages: [] });
      }
    });
    const harness = createHarness({ getGpu: () => mock.gpu, getCanvasContext: () => mock.context });
    harness.handle.schedule("initial");
    await harness.handle.retry();
    expect(mock.pipelines).toEqual(["initial"]);

    harness.handle.schedule("old");
    harness.flushFrame();
    await Promise.resolve();
    harness.handle.schedule("new");
    harness.flushFrame();
    await Promise.resolve();
    newInfo.resolve({ messages: [] });
    await vi.waitFor(() => expect(mock.pipelines).toEqual(["initial", "new"]));
    oldInfo.resolve({ messages: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(mock.pipelines).toEqual(["initial", "new"]);
    expect(mock.gpu.requestAdapter).toHaveBeenCalledOnce();
    expect(harness.statuses.at(-1)?.state).toBe("ready");
    harness.handle.destroy();
  });

  it("contains device loss and releases each owned device on retry and destroy", async () => {
    const first = createMockGpu();
    const second = createMockGpu();
    let attempt = 0;
    const gpu = {
      requestAdapter: vi.fn(async () => (++attempt === 1 ? first.adapter : second.adapter)),
      getPreferredCanvasFormat: vi.fn(() => "bgra8unorm")
    };
    const harness = createHarness({
      getGpu: () => gpu,
      getCanvasContext: () => attempt === 1 ? first.context : second.context
    });
    harness.handle.schedule("initial");
    await harness.handle.retry();
    await harness.handle.retry();
    expect(first.device.destroy).toHaveBeenCalledOnce();

    second.lost.resolve({ message: "device lost during test" });
    await vi.waitFor(() => expect(harness.statuses.at(-1)).toEqual({
      state: "failed",
      message: "device lost during test"
    }));
    expect(second.device.destroy).toHaveBeenCalledOnce();
    harness.handle.destroy();
    expect(second.device.destroy).toHaveBeenCalledOnce();
    expect(harness.observer.disconnect).toHaveBeenCalledOnce();
    expect(harness.frames.size).toBe(0);
  });
});
