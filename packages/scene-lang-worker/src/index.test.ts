import { describe, expect, it, vi } from "vitest";

import { SceneLangServiceError, SceneLangWorkerServices, type SceneWorkerHost } from "./index";
import { SCENE_WORKER_PROTOCOL_VERSION, type SceneWorkerResponse } from "./protocol";

class FakeWorker implements SceneWorkerHost {
  readonly posted: unknown[] = [];
  terminated = 0;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  addEventListener(type: string, listener: (event: Event) => void): void { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners); }
  removeEventListener(type: string, listener: (event: Event) => void): void { this.listeners.get(type)?.delete(listener); }
  postMessage(message: unknown): void { this.posted.push(message); }
  terminate(): void { this.terminated++; }
  emit(message: unknown): void { this.emitEvent("message", { data: message } as MessageEvent<SceneWorkerResponse>); }
  emitEvent(type: string, event: Event = new Event(type)): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  listenerCount(type: string): number { return this.listeners.get(type)?.size ?? 0; }
}

function ready(worker: FakeWorker): void { worker.emit({ type: "ready", version: SCENE_WORKER_PROTOCOL_VERSION }); }
function create(worker = new FakeWorker(), options: Partial<{ timeoutMs: number; requestTimeoutMs: number }> = {}): { worker: FakeWorker; service: SceneLangWorkerServices } {
  return { worker, service: new SceneLangWorkerServices({ wasmUrl: "scene.wasm", createWorker: () => worker, ...options }) };
}

describe("SceneLangWorkerServices lifecycle", () => {
  it("becomes ready and resolves RPC responses", async () => {
    const { worker, service } = create();
    ready(worker);
    await service.whenReady();
    const diagnostics = service.diagnostics({ revision: 4 });
    await Promise.resolve();
    const request = worker.posted.at(-1) as { requestId: number; generation: number };
    worker.emit({ type: "diagnostics", version: 1, requestId: request.requestId, generation: request.generation, diagnostics: [] });
    await expect(diagnostics).resolves.toEqual([]);
    expect(service.state).toBe("ready");
  });

  it("rejects readiness on structured init failure", async () => {
    const { worker, service } = create();
    worker.emit({ type: "error", version: 1, phase: "init", message: "Wasm fetch failed" });
    await expect(service.whenReady()).rejects.toMatchObject({ code: "init" });
    expect(service.state).toBe("failed");
  });

  it("fails on an unsupported protocol response", async () => {
    const { worker, service } = create();
    worker.emit({ type: "ready", version: 99 });
    await expect(service.whenReady()).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminated).toBe(1);
    expect(worker.listenerCount("message")).toBe(0);
  });

  it("fails a pending request on unknown or mismatched versioned responses", async () => {
    const { worker, service } = create();
    ready(worker);
    await service.whenReady();
    const pending = service.diagnostics({ revision: 1 });
    const handled = pending.catch((error) => error);
    await Promise.resolve();
    const request = worker.posted.at(-1) as { requestId: number; generation: number };
    worker.emit({ type: "hover", version: 1, requestId: request.requestId, generation: request.generation, hover: null });
    await expect(handled).resolves.toMatchObject({ code: "protocol" });
    expect(worker.terminated).toBe(1);
  });

  it.each(["error", "messageerror"])("rejects readiness on worker %s", async (type) => {
    const { worker, service } = create();
    worker.emitEvent(type);
    await expect(service.whenReady()).rejects.toMatchObject({ code: "runtime" });
  });

  it("times out initialization", async () => {
    vi.useFakeTimers();
    const { service } = create(undefined, { timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    await expect(service.whenReady()).rejects.toMatchObject({ code: "timeout" });
    vi.useRealTimers();
  });

  it("rejects pending RPC work exactly once when destroyed and removes listeners", async () => {
    const { worker, service } = create();
    ready(worker);
    await service.whenReady();
    const pending = service.diagnostics({ revision: 1 });
    await Promise.resolve();
    service.destroy();
    service.destroy();
    await expect(pending).rejects.toMatchObject({ code: "destroyed" });
    expect(worker.terminated).toBe(1);
    expect(worker.listenerCount("message")).toBe(0);
    expect(worker.listenerCount("error")).toBe(0);
    expect(worker.listenerCount("messageerror")).toBe(0);
    expect(service.state).toBe("destroyed");
  });

  it("rejects all pending work when a request times out", async () => {
    vi.useFakeTimers();
    const { worker, service } = create(undefined, { requestTimeoutMs: 5 });
    ready(worker);
    await service.whenReady();
    const first = service.diagnostics({ revision: 1 });
    const second = service.hover({ revision: 1 }, 0);
    const handledFirst = first.catch((error) => error);
    const handledSecond = second.catch((error) => error);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5);
    await expect(handledFirst).resolves.toMatchObject({ code: "timeout" });
    await expect(handledSecond).resolves.toMatchObject({ code: "timeout" });
    expect(service.state).toBe("failed");
    vi.useRealTimers();
  });

  it("ignores stale generations and supports safe recreation", async () => {
    const first = create();
    ready(first.worker);
    await first.service.whenReady();
    const pending = first.service.diagnostics({ revision: 1 });
    await Promise.resolve();
    const request = first.worker.posted.at(-1) as { requestId: number; generation: number };
    first.worker.emit({ type: "diagnostics", version: 1, requestId: request.requestId, generation: request.generation + 1, diagnostics: [] });
    first.service.destroy();
    await expect(pending).rejects.toBeInstanceOf(SceneLangServiceError);
    const second = create();
    ready(second.worker);
    await expect(second.service.whenReady()).resolves.toBeUndefined();
    expect(second.service.state).toBe("ready");
  });
});
