import type { TextChange, TextDocument } from "@mewhhaha/wx-core";
import type { CodeActionContext, CommentToggler, EditorCodeAction, EditorDiagnostic, EditorHover, EditorLanguageServiceOwner, EditorLanguageServices, EditorLineRange, Formatter, HighlightSpan, Highlighter, HoverSource } from "@mewhhaha/wx-language";

import { createWgslCommentToggler } from "./commentToggler";
import { isSceneWorkerResponse, SCENE_WORKER_PROTOCOL_VERSION, type SceneWorkerResponse, type SceneWorkerRpcRequest, type SceneWorkerRpcRequestInput } from "./protocol";

export type SceneLangServiceState = "starting" | "ready" | "failed" | "destroying" | "destroyed";
export type SceneLangServiceErrorCode = "init" | "protocol" | "runtime" | "timeout" | "destroyed";

export class SceneLangServiceError extends Error {
  constructor(message: string, readonly code: SceneLangServiceErrorCode) { super(message); this.name = "SceneLangServiceError"; }
}

export interface SceneWorkerHost {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener?(type: string, listener: (event: Event) => void): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface SceneLangLanguageServicesOptions {
  wasmUrl: string;
  createWorker?: () => SceneWorkerHost;
  /** Bounds initial Wasm startup. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Bounds an individual RPC after startup. Defaults to `timeoutMs`. */
  requestTimeoutMs?: number;
  /** Explicit worker ownership. Omitted services are externally owned. */
  owner?: EditorLanguageServiceOwner;
}

export interface SceneLangPipelineMetrics {
  workerCrossings: number;
  workerMessageBytes: number;
  workerDocumentBytesCopied: number;
  wasmOperations: number;
  wasmSourceBytesCopied: number;
  pendingRequests: number;
  maxPendingRequests: number;
}

interface Deferred<T> { resolve(value: T): void; reject(reason: Error): void; timeout: ReturnType<typeof setTimeout>; generation: number; type: SceneWorkerRpcRequest["type"]; }

function defaultWorkerFactory(): SceneWorkerHost { return new Worker(new URL("./sceneLang.worker.js", import.meta.url), { type: "module" }); }

/** A single-owner service instance. Recreate it after `failed` or `destroyed`; instances never revive in place. */
export class SceneLangWorkerServices implements Highlighter, HoverSource, Formatter {
  private worker: SceneWorkerHost | null = null;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: Error) => void;
  private readonly pending = new Map<number, Deferred<unknown>>();
  private readonly handleMessage: (event: MessageEvent<SceneWorkerResponse>) => void;
  private readonly handleFailure: (event: Event) => void;
  private readonly generation = 1;
  private initTimeout: ReturnType<typeof setTimeout> | null = null;
  private nextRequestId = 1;
  private state_: SceneLangServiceState = "starting";
  private failure_: SceneLangServiceError | null = null;
  private readonly requestTimeoutMs: number;
  private readonly counters: SceneLangPipelineMetrics = {
    workerCrossings: 0,
    workerMessageBytes: 0,
    workerDocumentBytesCopied: 0,
    wasmOperations: 0,
    wasmSourceBytesCopied: 0,
    pendingRequests: 0,
    maxPendingRequests: 0
  };

  get state(): SceneLangServiceState { return this.state_; }
  get error(): SceneLangServiceError | null { return this.failure_; }
  get metrics(): Readonly<SceneLangPipelineMetrics> { return { ...this.counters }; }
  whenReady(): Promise<void> { return this.ready; }

  constructor(options: SceneLangLanguageServicesOptions) {
    this.ready = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    // A caller may inspect state instead of awaiting readiness; keep that from becoming an unhandled rejection.
    void this.ready.catch(() => undefined);
    this.requestTimeoutMs = options.requestTimeoutMs ?? options.timeoutMs ?? 10_000;
    this.handleMessage = (event) => this.receive(event.data);
    this.handleFailure = (event) => this.fail(new SceneLangServiceError(`Scene language worker ${event.type}.`, "runtime"));
    try {
      this.worker = (options.createWorker ?? defaultWorkerFactory)();
      this.worker.addEventListener("message", this.handleMessage as (event: Event) => void);
      this.worker.addEventListener("error", this.handleFailure);
      this.worker.addEventListener("messageerror", this.handleFailure);
      this.initTimeout = setTimeout(() => this.fail(new SceneLangServiceError("Scene language worker initialization timed out.", "timeout")), options.timeoutMs ?? 10_000);
      this.worker.postMessage({ type: "init", version: SCENE_WORKER_PROTOCOL_VERSION, wasmUrl: options.wasmUrl });
    } catch (error) {
      this.fail(new SceneLangServiceError(`Scene language worker initialization failed: ${error instanceof Error ? error.message : String(error)}`, "init"));
    }
  }

  async open(document: { revision: number; doc: TextDocument }): Promise<void> { await this.ready; this.post({ type: "open", version: SCENE_WORKER_PROTOCOL_VERSION, revision: document.revision, text: document.doc.text }); }
  async update(document: { revision: number; doc: TextDocument }, changes: readonly TextChange[]): Promise<void> { await this.ready; this.post({ type: "update", version: SCENE_WORKER_PROTOCOL_VERSION, revision: document.revision, text: document.doc.text, changes }); }
  async getHighlights(lines: EditorLineRange, revision: number): Promise<HighlightSpan[]> { return this.request({ type: "highlights", revision, lines }); }
  async diagnostics(document: { revision: number }): Promise<readonly EditorDiagnostic[]> { return this.request({ type: "diagnostics", revision: document.revision }); }
  async hover(document: { revision: number }, offset: number): Promise<EditorHover | null> { return this.request({ type: "hover", revision: document.revision, offset }); }
  async format(context: { document: { revision: number; doc: TextDocument }; selection: { from: number; to: number } }): Promise<readonly TextChange[]> {
    const nextText = await this.request<string>({ type: "format", revision: context.document.revision, selection: context.selection });
    return nextText === context.document.doc.text ? [] : [{ from: 0, to: context.document.doc.length, insert: nextText }];
  }
  async getCodeActions(context: CodeActionContext): Promise<readonly EditorCodeAction[]> { return this.request<EditorCodeAction[]>({ type: "code-actions", revision: context.document.revision, selection: context.selection }); }

  destroy(): void {
    if (this.state_ === "destroying" || this.state_ === "destroyed") return;
    this.state_ = "destroying";
    this.removeListeners();
    this.fail(new SceneLangServiceError("Scene language worker was destroyed.", "destroyed"));
    this.worker?.terminate();
    this.worker = null;
    this.state_ = "destroyed";
  }

  private receive(payload: unknown): void {
    if (!isSceneWorkerResponse(payload)) return this.fail(new SceneLangServiceError("Unsupported Scene language worker protocol.", "protocol"));
    const message = payload;
    this.counters.workerCrossings += 1;
    this.counters.workerMessageBytes += estimateMessageBytes(message);
    if ("boundary" in message && message.boundary) {
      this.counters.wasmOperations += message.boundary.operations;
      this.counters.wasmSourceBytesCopied += message.boundary.sourceBytesCopied;
    }
    if (message.type === "ready") { if (this.state_ === "starting") { this.clearInitTimeout(); this.state_ = "ready"; this.resolveReady(); } return; }
    if (message.type === "error") return this.fail(new SceneLangServiceError(message.message, message.phase === "protocol" ? "protocol" : message.phase === "init" ? "init" : "runtime"));
    if (this.state_ !== "ready" || message.generation !== this.generation) return;
    const deferred = this.pending.get(message.requestId);
    if (!deferred || deferred.generation !== message.generation) return;
    if (deferred.type !== message.type) return this.fail(new SceneLangServiceError("Scene language worker returned a mismatched response.", "protocol"));
    this.pending.delete(message.requestId); clearTimeout(deferred.timeout); this.updatePendingMetrics();
    if (message.type === "diagnostics") deferred.resolve(message.diagnostics);
    else if (message.type === "hover") deferred.resolve(message.hover);
    else if (message.type === "format") deferred.resolve(message.text);
    else if (message.type === "code-actions") deferred.resolve(message.actions);
    else deferred.resolve(message.spans);
  }

  private request<T>(message: SceneWorkerRpcRequestInput): Promise<T> {
    return this.ready.then(() => {
      if (this.state_ !== "ready") throw this.failure_ ?? new SceneLangServiceError("Scene language worker was destroyed.", "destroyed");
      return new Promise<T>((resolve, reject) => {
      const requestId = this.nextRequestId++;
      const timeout = setTimeout(() => this.fail(new SceneLangServiceError("Scene language worker request timed out.", "timeout")), this.requestTimeoutMs);
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timeout, generation: this.generation, type: message.type });
      this.updatePendingMetrics();
      try { this.post({ ...message, requestId, generation: this.generation, version: SCENE_WORKER_PROTOCOL_VERSION } as SceneWorkerRpcRequest); }
      catch (error) { this.fail(new SceneLangServiceError(`Scene language worker request failed: ${error instanceof Error ? error.message : String(error)}`, "runtime")); }
      });
    });
  }
  private post(message: unknown): void {
    if (!this.worker || this.state_ === "destroying" || this.state_ === "destroyed") throw new SceneLangServiceError("Scene language worker was destroyed.", "destroyed");
    try {
      this.worker.postMessage(message);
      this.counters.workerCrossings += 1;
      this.counters.workerMessageBytes += estimateMessageBytes(message);
      if (message && typeof message === "object" && "text" in message && typeof (message as { text?: unknown }).text === "string") {
        this.counters.workerDocumentBytesCopied += (message as { text: string }).text.length * 2;
      }
    }
    catch (cause) {
      const error = new SceneLangServiceError(`Scene language worker request failed: ${cause instanceof Error ? cause.message : String(cause)}`, "runtime");
      this.fail(error);
      throw error;
    }
  }
  private fail(error: SceneLangServiceError): void {
    if (this.failure_) return;
    this.failure_ = error;
    this.clearInitTimeout();
    const shouldDisposeWorker = this.state_ !== "destroying" && this.state_ !== "destroyed";
    if (shouldDisposeWorker) this.state_ = "failed";
    this.rejectReady(error);
    for (const deferred of this.pending.values()) {
      clearTimeout(deferred.timeout);
      deferred.reject(error);
    }
    this.pending.clear();
    this.updatePendingMetrics();
    if (shouldDisposeWorker) {
      this.removeListeners();
      this.worker?.terminate();
      this.worker = null;
    }
  }
  private clearInitTimeout(): void { if (this.initTimeout) { clearTimeout(this.initTimeout); this.initTimeout = null; } }
  private updatePendingMetrics(): void {
    this.counters.pendingRequests = this.pending.size;
    this.counters.maxPendingRequests = Math.max(this.counters.maxPendingRequests, this.pending.size);
  }
  private removeListeners(): void { if (!this.worker) return; this.worker.removeEventListener?.("message", this.handleMessage as (event: Event) => void); this.worker.removeEventListener?.("error", this.handleFailure); this.worker.removeEventListener?.("messageerror", this.handleFailure); }
}

function estimateMessageBytes(value: unknown): number {
  const stack: unknown[] = [value];
  let bytes = 0;
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === "string") bytes += next.length * 2;
    else if (typeof next === "number") bytes += 8;
    else if (typeof next === "boolean") bytes += 1;
    else if (Array.isArray(next)) stack.push(...next);
    else if (next && typeof next === "object") {
      for (const [key, entry] of Object.entries(next)) {
        bytes += key.length * 2;
        stack.push(entry);
      }
    }
  }
  return bytes;
}

export function createSceneLangLanguageServices(options: SceneLangLanguageServicesOptions): EditorLanguageServices {
  const workerServices = new SceneLangWorkerServices(options);
  const comments: CommentToggler = createWgslCommentToggler();
  return {
    highlighter: workerServices,
    diagnostics: workerServices,
    hover: workerServices,
    codeActions: workerServices,
    formatter: workerServices,
    comments,
    lifecycle: {
      get state() {
        return workerServices.state;
      },
      get error() {
        return workerServices.error;
      },
      owner: options.owner,
      whenReady: () => workerServices.whenReady(),
      destroy: () => workerServices.destroy(),
      recreate: () => createSceneLangLanguageServices(options)
    }
  };
}
