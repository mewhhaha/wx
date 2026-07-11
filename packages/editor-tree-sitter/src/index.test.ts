import { describe, expect, it, vi } from "vitest";

import { createTextDocument } from "@mewhhaha/wx-core";
import type { HighlightSpan } from "@mewhhaha/wx-language";

import { createTreeSitterLanguageServices, type TreeSitterWorkerHost } from "./index";
import { typescriptHighlightQuery } from "./highlightQuery";
import { createNodeTreeSitterLanguageServices } from "./node";
import { TREE_SITTER_WORKER_PROTOCOL_VERSION } from "./messages";
import { LanguageServiceError, TreeSitterLanguageProvider } from "./provider";

class FakeWorkerHost implements TreeSitterWorkerHost {
  readonly messages: unknown[] = [];
  terminated = false;
  throwOnPost = false;
  private readonly listeners = new Map<string, (event: Event) => void>();

  addEventListener(type: "message" | "error" | "messageerror", listener: (event: Event) => void): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: "message" | "error" | "messageerror", listener: (event: Event) => void): void {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  postMessage(message: unknown): void {
    if (this.throwOnPost) throw new Error("post failed");
    this.messages.push(message);
  }

  emit(data: unknown): void {
    this.listeners.get("message")?.({ data } as MessageEvent);
  }

  emitFailure(type: "error" | "messageerror"): void { this.listeners.get(type)?.({ type } as Event); }
  listenerCount(): number { return this.listeners.size; }

  terminate(): void {
    this.terminated = true;
  }
}

describe("tree-sitter query", () => {
  it("includes key syntax captures for the demo language", () => {
    expect(typescriptHighlightQuery).toContain("@keyword");
    expect(typescriptHighlightQuery).toContain("@string");
    expect(typescriptHighlightQuery).toContain("@comment");
    expect(typescriptHighlightQuery).toContain("@function.method");
    expect(typescriptHighlightQuery).toContain("@punctuation.bracket");
    expect(typescriptHighlightQuery).toContain("@type.builtin");
  });
});

describe("tree-sitter language services", () => {
  it("drives highlighting through the shared worker host protocol", async () => {
    const worker = new FakeWorkerHost();
    const services = createTreeSitterLanguageServices({
      parserWasmUrl: "/parser.wasm",
      parserRuntimeUrl: "/runtime.js",
      languageWasmUrl: "/language.wasm",
      query: "(identifier) @type",
      createWorker: () => worker
    });

    worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    const opened = services.highlighter?.open({
      revision: 1,
      doc: createTextDocument("const value = 1;")
    });
    await Promise.resolve();
    const openRequest = worker.messages.at(-1) as { requestId: number; generation: number };
    worker.emit({ type: "synced", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, requestId: openRequest.requestId, generation: openRequest.generation, revision: 1, documentLength: 16, mode: "open" });
    await opened;

    const highlightsPromise = services.highlighter!.getHighlights({ fromLine: 0, toLine: 0 }, 1);
    await Promise.resolve();
    const highlightRequest = worker.messages.at(-1) as { type: string; version: number; requestId: number };
    const spans: HighlightSpan[] = [{ from: 0, to: 5, role: "keyword" }];
    worker.emit({
      type: "highlights",
      version: TREE_SITTER_WORKER_PROTOCOL_VERSION,
      revision: 1,
      requestId: highlightRequest.requestId,
      generation: (highlightRequest as { generation: number }).generation,
      spans
    });

    expect(worker.messages[0]).toEqual({
      type: "init",
      version: TREE_SITTER_WORKER_PROTOCOL_VERSION,
      parserWasmUrl: "/parser.wasm",
      parserRuntimeUrl: "/runtime.js",
      languageWasmUrl: "/language.wasm",
      query: "(identifier) @type"
    });
    expect(worker.messages[1]).toMatchObject({ type: "open", revision: 1, text: "const value = 1;" });
    expect(highlightRequest).toMatchObject({ type: "highlight", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    expect(await highlightsPromise).toEqual(spans);

    services.highlighter?.destroy?.();
    expect(worker.terminated).toBe(true);
  });

  it("exports a Node host helper without changing the browser helper", () => {
    expect(createTreeSitterLanguageServices).toBeTypeOf("function");
    expect(createNodeTreeSitterLanguageServices).toBeTypeOf("function");
  });

  it("rejects readiness and cleans up after init or protocol failure", async () => {
    for (const response of [
      { type: "error", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, message: "wasm unavailable" },
      { type: "unknown", version: TREE_SITTER_WORKER_PROTOCOL_VERSION },
      { type: "highlights", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, generation: 1, revision: 1, requestId: 1, spans: [{ from: 0, to: 1, role: "not-a-role" }] }
    ]) {
      const worker = new FakeWorkerHost();
      const provider = makeProvider(worker);
      worker.emit(response);
      await expect(provider.readiness).rejects.toBeInstanceOf(LanguageServiceError);
      expect(provider.status).toBe("failed");
      expect(worker.terminated).toBe(true);
      expect(worker.listenerCount()).toBe(0);
    }
  });

  it.each(["error", "messageerror"] as const)("fails pending RPCs on worker %s", async (type) => {
    const worker = new FakeWorkerHost();
    const provider = makeProvider(worker);
    worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    const pending = provider.getHighlights({ fromLine: 0, toLine: 0 }, 1);
    worker.emitFailure(type);
    await expect(pending).rejects.toMatchObject({ code: "runtime" });
    expect(worker.terminated).toBe(true);
  });

  it("bounds initialization and RPC timeouts", async () => {
    vi.useFakeTimers();
    try {
      const initWorker = new FakeWorkerHost();
      const initializing = makeProvider(initWorker, 5);
      await vi.advanceTimersByTimeAsync(5);
      await expect(initializing.readiness).rejects.toMatchObject({ code: "timeout" });

      const worker = new FakeWorkerHost();
      const provider = makeProvider(worker, 5);
      worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
      const pending = provider.getHighlights({ fromLine: 0, toLine: 0 }, 1);
      await Promise.resolve();
      const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
      expect(provider.status).toBe("failed");
      expect(worker.terminated).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("settles pending work on destroy, ignores stale responses, and permits recreation", async () => {
    const first = new FakeWorkerHost();
    const provider = makeProvider(first);
    first.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    const pending = provider.getHighlights({ fromLine: 0, toLine: 0 }, 1);
    await Promise.resolve();
    const requestId = (first.messages.at(-1) as { requestId: number }).requestId;
    const destroyed = expect(pending).rejects.toMatchObject({ code: "destroyed" });
    provider.destroy();
    provider.destroy();
    await destroyed;
    first.emit({ type: "highlights", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, generation: 1, revision: 1, requestId, spans: [] });
    expect(first.terminated).toBe(true);
    expect(first.listenerCount()).toBe(0);

    const second = new FakeWorkerHost();
    const recreated = makeProvider(second);
    second.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    const next = recreated.getHighlights({ fromLine: 0, toLine: 0 }, 1);
    await Promise.resolve();
    second.emit({ type: "highlights", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, generation: 1, revision: 1, requestId: 1, spans: [] });
    await expect(next).resolves.toEqual([]);
  });

  it("fails every pending RPC when one request times out or receives a mismatched response", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorkerHost();
      const provider = makeProvider(worker, 5);
      worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
      const highlights = provider.getHighlights({ fromLine: 0, toLine: 0 }, 1);
      const selection = provider.expandSelection({ from: 0, to: 1 }, 0, 1);
      const handledHighlights = highlights.catch((error) => error);
      const handledSelection = selection.catch((error) => error);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(5);
      await expect(handledHighlights).resolves.toMatchObject({ code: "timeout" });
      await expect(handledSelection).resolves.toMatchObject({ code: "timeout" });

      const mismatchWorker = new FakeWorkerHost();
      const mismatchProvider = makeProvider(mismatchWorker);
      mismatchWorker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
      const mismatched = mismatchProvider.getHighlights({ fromLine: 0, toLine: 0 }, 1);
      const handledMismatch = mismatched.catch((error) => error);
      await Promise.resolve();
      mismatchWorker.emit({ type: "selection", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, generation: 1, revision: 1, requestId: 1, selection: null });
      await expect(handledMismatch).resolves.toMatchObject({ code: "protocol" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles postMessage throws during init and RPC without leaking a worker", async () => {
    const initWorker = new FakeWorkerHost();
    initWorker.throwOnPost = true;
    const initializing = makeProvider(initWorker);
    await expect(initializing.readiness).rejects.toThrow("post failed");
    expect(initWorker.terminated).toBe(true);

    const worker = new FakeWorkerHost();
    const provider = makeProvider(worker);
    worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    worker.throwOnPost = true;
    await expect(provider.getHighlights({ fromLine: 0, toLine: 0 }, 1)).rejects.toThrow("post failed");
    expect(provider.status).toBe("failed");
    expect(worker.terminated).toBe(true);
  });

  it("publishes a recreatable lifecycle without claiming ownership", async () => {
    const worker = new FakeWorkerHost();
    const replacement = new FakeWorkerHost();
    const workers = [worker, replacement];
    const services = createTreeSitterLanguageServices({
      parserWasmUrl: "/parser.wasm",
      languageWasmUrl: "/language.wasm",
      query: "(identifier) @type",
      createWorker: () => workers.shift()!
    });
    expect(services.lifecycle?.state).toBe("starting");
    expect(services.lifecycle?.owner).toBeUndefined();
    worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    await services.lifecycle?.whenReady?.();
    expect(services.lifecycle?.state).toBe("ready");
    const recreated = services.lifecycle?.recreate?.();
    expect(recreated?.lifecycle?.state).toBe("starting");
    recreated?.lifecycle?.destroy();
    services.lifecycle?.destroy();
    expect(worker.terminated).toBe(true);
  });

  it("keeps a 1,000-update burst to one in-flight and one coalesced edit-only message", async () => {
    const worker = new FakeWorkerHost();
    const provider = makeProvider(worker, 1_000);
    worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });

    const initialText = `${"const seed = 0;\n".repeat(2_000)}tail`;
    const opened = provider.open({ revision: 1, doc: createTextDocument(initialText) });
    await Promise.resolve();
    const openRequest = worker.messages.at(-1) as { requestId: number; generation: number };
    worker.emit({ type: "synced", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, requestId: openRequest.requestId, generation: openRequest.generation, revision: 1, documentLength: initialText.length, mode: "open" });
    await opened;

    let text = initialText;
    const updates: Promise<void>[] = [];
    for (let index = 0; index < 1_000; index += 1) {
      const change = { from: text.length, to: text.length, insert: "x" };
      text += "x";
      updates.push(provider.update({ revision: index + 2, doc: createTextDocument(text) }, [change]));
    }
    await Promise.resolve();
    await Promise.resolve();

    const first = worker.messages.filter((message) => (message as { type?: string }).type === "update").at(-1) as {
      type: string; requestId: number; generation: number; revision: number; documentLength: number; batches: unknown[]; text?: string;
    };
    expect(first).toMatchObject({ type: "update", revision: 2, documentLength: initialText.length + 1 });
    expect(first.text).toBeUndefined();
    expect(provider.metrics).toMatchObject({ queueDepth: 2, maxQueueDepth: 2, acknowledgedRevision: 1 });

    worker.emit({ type: "synced", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, requestId: first.requestId, generation: first.generation, revision: 2, documentLength: initialText.length + 1, mode: "incremental" });
    await Promise.resolve();
    const second = worker.messages.filter((message) => (message as { type?: string }).type === "update").at(-1) as typeof first;
    expect(second).not.toBe(first);
    expect(second).toMatchObject({ revision: 1_001, documentLength: text.length });
    expect(second.batches).toHaveLength(999);
    expect(second.text).toBeUndefined();
    worker.emit({ type: "synced", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, requestId: second.requestId, generation: second.generation, revision: 1_001, documentLength: text.length, mode: "incremental" });
    await expect(Promise.all(updates)).resolves.toHaveLength(1_000);
    expect(provider.metrics).toMatchObject({ queueDepth: 0, maxQueueDepth: 2, acknowledgedRevision: 1_001, incrementalSyncs: 2, coalescedUpdates: 998 });
    expect(provider.metrics.copiedTextBytes - new TextEncoder().encode(initialText).length).toBe(1_000);
  });

  it("falls back to an acknowledged full open when incremental state diverges", async () => {
    const worker = new FakeWorkerHost();
    const provider = makeProvider(worker);
    worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    const opened = provider.open({ revision: 1, doc: createTextDocument("one") });
    await Promise.resolve();
    const open = worker.messages.at(-1) as { requestId: number; generation: number };
    worker.emit({ type: "synced", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, requestId: open.requestId, generation: open.generation, revision: 1, documentLength: 3, mode: "open" });
    await opened;

    const updated = provider.update({ revision: 2, doc: createTextDocument("one!") }, [{ from: 3, to: 3, insert: "!" }]);
    await Promise.resolve();
    const incremental = worker.messages.at(-1) as { requestId: number; generation: number };
    worker.emit({ type: "sync-required", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, requestId: incremental.requestId, generation: incremental.generation, revision: 0, reason: "base-revision" });
    const fallback = worker.messages.at(-1) as { type: string; requestId: number; generation: number; revision: number; text: string };
    expect(fallback).toMatchObject({ type: "open", revision: 2, text: "one!" });
    worker.emit({ type: "synced", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, requestId: fallback.requestId, generation: fallback.generation, revision: 2, documentLength: 4, mode: "open" });
    await expect(updated).resolves.toBeUndefined();
    expect(provider.metrics).toMatchObject({ fullSyncFallbacks: 1, acknowledgedRevision: 2 });
  });

  it("round-trips revision-aware indentation and removes its abort listener on success", async () => {
    const worker = new FakeWorkerHost();
    const provider = makeProvider(worker);
    worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const document = { revision: 7, doc: createTextDocument("function f() {\n}\n") };
    const pending = provider.getIndentation({ document, offset: 15, action: "enter", signal: controller.signal });
    await Promise.resolve();
    const request = worker.messages.at(-1) as { type: string; generation: number; requestId: number };
    expect(request).toMatchObject({ type: "indentation", revision: 7, offset: 15, action: "enter" });
    worker.emit({
      type: "indentation-result",
      version: TREE_SITTER_WORKER_PROTOCOL_VERSION,
      generation: request.generation,
      requestId: request.requestId,
      result: { revision: 7, status: "ok", indent: 1, outdent: 0 }
    });
    await expect(pending).resolves.toEqual({ revision: 7, status: "ok", indent: 1, outdent: 0 });
    const abortListener = add.mock.calls.find(([type]) => type === "abort")?.[1];
    expect(abortListener).toBeDefined();
    expect(remove).toHaveBeenCalledWith("abort", abortListener);
    provider.destroy();
  });

  it("cancels aborted indentation without failing the provider or retaining listeners", async () => {
    const worker = new FakeWorkerHost();
    const provider = makeProvider(worker);
    worker.emit({ type: "ready", version: TREE_SITTER_WORKER_PROTOCOL_VERSION });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = provider.getIndentation({
      document: { revision: 3, doc: createTextDocument("{}") },
      offset: 1,
      action: "open-below",
      signal: controller.signal
    });
    await Promise.resolve();
    const request = worker.messages.at(-1) as { generation: number; requestId: number };
    controller.abort();
    await expect(pending).resolves.toEqual({ revision: 3, status: "stale" });
    expect(worker.messages.at(-1)).toMatchObject({
      type: "cancel",
      generation: request.generation,
      requestId: request.requestId
    });
    expect(remove).toHaveBeenCalled();
    expect(provider.status).toBe("ready");
    provider.destroy();
  });
});

function makeProvider(worker: FakeWorkerHost, timeoutMs = 100): TreeSitterLanguageProvider {
  return new TreeSitterLanguageProvider({
    parserWasmUrl: "/parser.wasm",
    languageWasmUrl: "/language.wasm",
    query: "(identifier) @type",
    timeoutMs,
    createWorker: () => worker
  });
}
