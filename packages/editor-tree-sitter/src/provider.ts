import type { TextChange, TextDocument } from "@mewhhaha/wx-core";
import type { EditorLanguageServiceOwner, EditorLanguageServices, EditorLineRange, HighlightSpan, Highlighter, IndentationProvider, IndentationResult, LanguageDocumentSnapshot, LanguageProvider, SyntaxSelectionRange, SyntaxSelector } from "@mewhhaha/wx-language";

import {
  estimateTreeSitterMessageBytes,
  isTreeSitterWorkerResponse,
  TREE_SITTER_WORKER_PROTOCOL_VERSION,
  treeSitterCopiedTextBytes,
  type TreeSitterWorkerMessage,
  type TreeSitterWorkerResponse,
  type WorkerTextChangeBatch
} from "./messages";

export interface TreeSitterWorkerHost {
  addEventListener(type: "message", listener: (event: MessageEvent<TreeSitterWorkerResponse>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<TreeSitterWorkerResponse>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface TreeSitterProviderOptions {
  parserWasmUrl: string;
  parserRuntimeUrl?: string;
  languageWasmUrl: string;
  query: string;
  /** Optional wx-indent-v1 query. Omit to use the documented plain-text fallback. */
  indentQuery?: string;
  createWorker: () => TreeSitterWorkerHost;
  /** Maximum time for initialization, document acknowledgements, and RPCs. */
  timeoutMs?: number;
  /** Explicit worker ownership. Omitted services are externally owned. */
  owner?: EditorLanguageServiceOwner;
}

export interface TreeSitterPipelineMetrics {
  workerCrossings: number;
  workerMessageBytes: number;
  copiedTextBytes: number;
  syncRequests: number;
  incrementalSyncs: number;
  fullSyncs: number;
  fullSyncFallbacks: number;
  coalescedUpdates: number;
  cancelledRequests: number;
  queueDepth: number;
  maxQueueDepth: number;
  acknowledgedRevision: number;
}

interface Deferred<T> {
  resolve(value: T): void;
  reject(reason: Error): void;
  timeout?: ReturnType<typeof setTimeout>;
}

interface DocumentSnapshot { revision: number; doc: TextDocument; }

interface SyncJob {
  kind: "open" | "update";
  baseRevision: number;
  target: DocumentSnapshot;
  batches: WorkerTextChangeBatch[];
  callers: Deferred<void>[];
  requestId: number;
  fallbackAttempted: boolean;
  timeout?: ReturnType<typeof setTimeout>;
}

interface HighlightJob extends Deferred<HighlightSpan[]> {
  lines: EditorLineRange;
  revision: number;
  requestId: number;
}

interface SelectionJob extends Deferred<SyntaxSelectionRange | null> {
  type: "expand-selection" | "shrink-selection";
  selection: SyntaxSelectionRange;
  activeOffset: number;
  revision: number;
  requestId: number;
}
interface IndentationJob extends Deferred<IndentationResult> {
  requestId: number;
  revision: number;
  cleanup(): void;
}

export type LanguageServiceState = "starting" | "ready" | "failed" | "destroying" | "destroyed";

export class LanguageServiceError extends Error {
  constructor(message: string, readonly code: "init" | "protocol" | "runtime" | "timeout" | "destroyed" | "cancelled") {
    super(message);
    this.name = "LanguageServiceError";
  }
}

/**
 * Backpressured Tree-sitter host. Document work is restricted to one worker
 * message in flight and one coalesced pending unit. Every open/update resolves
 * only after an explicit worker acknowledgement.
 */
export class TreeSitterLanguageProvider implements Highlighter, SyntaxSelector, IndentationProvider {
  private readonly worker: TreeSitterWorkerHost;
  private readonly pendingSelections = new Map<number, SelectionJob>();
  private readonly pendingIndentation = new Map<number, IndentationJob>();
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: Error) => void;
  private readonly handleMessage: (event: MessageEvent<TreeSitterWorkerResponse>) => void;
  private readonly handleFailure: (event: Event) => void;
  private readonly timeoutMs: number;
  private readonly generation = 1;
  private initTimeout: ReturnType<typeof setTimeout> | undefined;
  private state: LanguageServiceState = "starting";
  private failure: Error | null = null;
  private nextRequestId = 1;
  private terminated = false;
  private workerRevision = -1;
  private syncInFlight: SyncJob | null = null;
  private syncPending: SyncJob | null = null;
  private activeHighlight: HighlightJob | null = null;
  private pendingHighlight: HighlightJob | null = null;
  private readonly counters: TreeSitterPipelineMetrics = {
    workerCrossings: 0,
    workerMessageBytes: 0,
    copiedTextBytes: 0,
    syncRequests: 0,
    incrementalSyncs: 0,
    fullSyncs: 0,
    fullSyncFallbacks: 0,
    coalescedUpdates: 0,
    cancelledRequests: 0,
    queueDepth: 0,
    maxQueueDepth: 0,
    acknowledgedRevision: -1
  };

  get status(): LanguageServiceState { return this.state; }
  get error(): Error | null { return this.failure; }
  get readiness(): Promise<void> { return this.ready; }
  get metrics(): Readonly<TreeSitterPipelineMetrics> { return { ...this.counters }; }
  whenReady(): Promise<void> { return this.ready; }

  constructor(options: TreeSitterProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    // Callers may opt not to await readiness; never turn an expected service failure into an unhandled rejection.
    void this.ready.catch(() => undefined);
    this.worker = options.createWorker();
    this.handleMessage = (event) => this.onMessage(event.data);
    this.handleFailure = (event) => this.fail(new LanguageServiceError(`Tree-sitter worker ${event.type}.`, "runtime"));
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleFailure);
    this.worker.addEventListener("messageerror", this.handleFailure);
    this.initTimeout = setTimeout(() => this.fail(new LanguageServiceError("Tree-sitter worker initialization timed out.", "timeout")), this.timeoutMs);
    try {
      this.post({
        type: "init",
        version: TREE_SITTER_WORKER_PROTOCOL_VERSION,
        parserWasmUrl: options.parserWasmUrl,
        parserRuntimeUrl: options.parserRuntimeUrl,
        languageWasmUrl: options.languageWasmUrl,
        query: options.query,
        indentQuery: options.indentQuery
      });
    } catch {
      // post() has already transitioned the provider and rejected readiness.
    }
  }

  async open(document: DocumentSnapshot): Promise<void> {
    await this.ready;
    return this.enqueueOpen(document);
  }

  async update(document: DocumentSnapshot, changes: readonly TextChange[]): Promise<void> {
    await this.ready;
    if (changes.length === 0 && document.revision === this.latestQueuedRevision()) return;
    return this.enqueueUpdate(document, changes);
  }

  /** Optional controller fast path: preserve sequential edit coordinates in one pending unit. */
  async updateBatches(updates: readonly { document: DocumentSnapshot; changes: readonly TextChange[] }[]): Promise<void> {
    await this.ready;
    if (updates.length === 0) return;
    await Promise.all(updates.map((entry) => this.enqueueUpdate(entry.document, entry.changes)));
  }

  async getHighlights(lines: EditorLineRange, revision: number): Promise<HighlightSpan[]> {
    await this.ready;
    this.assertReady();
    return new Promise<HighlightSpan[]>((resolve, reject) => {
      const job: HighlightJob = { lines, revision, requestId: this.nextRequestId++, resolve, reject };
      if (this.pendingHighlight) {
        this.pendingHighlight.resolve([]);
        this.counters.cancelledRequests += 1;
      }
      this.pendingHighlight = job;
      this.updateQueueDepth();
      this.pump();
    });
  }

  async expandSelection(selection: SyntaxSelectionRange, activeOffset: number, revision: number): Promise<SyntaxSelectionRange | null> {
    return this.requestSelection("expand-selection", selection, activeOffset, revision);
  }

  async shrinkSelection(selection: SyntaxSelectionRange, activeOffset: number, revision: number): Promise<SyntaxSelectionRange | null> {
    return this.requestSelection("shrink-selection", selection, activeOffset, revision);
  }

  async getIndentation(context: { document: LanguageDocumentSnapshot; offset: number; action: "enter" | "open-below" | "open-above"; signal?: AbortSignal }): Promise<IndentationResult> {
    try {
      await this.ready;
      this.assertReady();
      if (context.signal?.aborted) return { revision: context.document.revision, status: "stale" };
      const requestId = this.nextRequestId++;
      return await new Promise<IndentationResult>((resolve, reject) => {
        let abort: (() => void) | undefined;
        const job: IndentationJob = {
          requestId,
          revision: context.document.revision,
          resolve,
          reject,
          cleanup: () => {
            clearTimeout(job.timeout);
            if (abort) context.signal?.removeEventListener("abort", abort);
          }
        };
        this.pendingIndentation.set(requestId, job);
        const complete = (status: "stale" | "error") => {
          if (!this.pendingIndentation.delete(requestId)) return;
          job.cleanup();
          resolve({ revision: context.document.revision, status });
          try {
            this.post({ type: "cancel", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, generation: this.generation, requestId });
          } catch {
            // `post` has already transitioned the provider and settled all remaining work.
          }
        };
        job.timeout = setTimeout(() => complete("error"), this.timeoutMs);
        abort = () => complete("stale");
        context.signal?.addEventListener("abort", abort, { once: true });
        this.post({ type: "indentation", version: TREE_SITTER_WORKER_PROTOCOL_VERSION, generation: this.generation, requestId, revision: context.document.revision, offset: context.offset, action: context.action });
      });
    } catch {
      return { revision: context.document.revision, status: "error" };
    }
  }

  private async requestSelection(type: SelectionJob["type"], selection: SyntaxSelectionRange, activeOffset: number, revision: number): Promise<SyntaxSelectionRange | null> {
    await this.ready;
    this.assertReady();
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const job: SelectionJob = { type, selection, activeOffset, revision, requestId, resolve, reject };
      job.timeout = setTimeout(() => this.fail(new LanguageServiceError(`Tree-sitter worker request ${requestId} timed out.`, "timeout")), this.timeoutMs);
      this.pendingSelections.set(requestId, job);
      this.post({ type, version: TREE_SITTER_WORKER_PROTOCOL_VERSION, generation: this.generation, requestId, revision, selection, activeOffset });
    });
  }

  private enqueueOpen(document: DocumentSnapshot): Promise<void> {
    this.assertReady();
    return new Promise<void>((resolve, reject) => {
      const caller: Deferred<void> = { resolve, reject };
      const next: SyncJob = {
        kind: "open",
        baseRevision: -1,
        target: document,
        batches: [],
        callers: [caller],
        requestId: 0,
        fallbackAttempted: false
      };
      if (this.syncPending) {
        next.callers.unshift(...this.syncPending.callers);
        this.counters.coalescedUpdates += 1;
      }
      this.syncPending = next;
      this.cancelHighlightsForDocumentSync();
      this.updateQueueDepth();
      this.pump();
    });
  }

  private enqueueUpdate(document: DocumentSnapshot, changes: readonly TextChange[]): Promise<void> {
    this.assertReady();
    return new Promise<void>((resolve, reject) => {
      const caller: Deferred<void> = { resolve, reject };

      if (this.syncPending?.kind === "open") {
        this.syncPending.target = document;
        this.syncPending.callers.push(caller);
        this.counters.coalescedUpdates += 1;
      } else if (this.syncPending) {
        this.syncPending.target = document;
        this.syncPending.batches.push({ revision: document.revision, changes: [...changes] });
        this.syncPending.callers.push(caller);
        this.counters.coalescedUpdates += 1;
      } else {
        const baseRevision = this.syncInFlight?.target.revision ?? this.workerRevision;
        if (baseRevision < 0) {
          this.syncPending = {
            kind: "open",
            baseRevision: -1,
            target: document,
            batches: [],
            callers: [caller],
            requestId: 0,
            fallbackAttempted: false
          };
        } else {
          this.syncPending = {
            kind: "update",
            baseRevision,
            target: document,
            batches: [{ revision: document.revision, changes: [...changes] }],
            callers: [caller],
            requestId: 0,
            fallbackAttempted: false
          };
        }
      }

      this.cancelHighlightsForDocumentSync();
      this.updateQueueDepth();
      this.pump();
    });
  }

  private latestQueuedRevision(): number {
    return this.syncPending?.target.revision ?? this.syncInFlight?.target.revision ?? this.workerRevision;
  }

  private pump(): void {
    if (this.state !== "ready") return;
    if (!this.syncInFlight && this.syncPending) {
      const job = this.syncPending;
      this.syncPending = null;
      this.syncInFlight = job;
      this.sendSync(job);
      this.updateQueueDepth();
      return;
    }
    if (!this.syncInFlight && !this.activeHighlight && this.pendingHighlight) {
      const job = this.pendingHighlight;
      this.pendingHighlight = null;
      this.activeHighlight = job;
      job.timeout = setTimeout(() => this.fail(new LanguageServiceError(`Tree-sitter worker request ${job.requestId} timed out.`, "timeout")), this.timeoutMs);
      this.post({
        type: "highlight",
        version: TREE_SITTER_WORKER_PROTOCOL_VERSION,
        generation: this.generation,
        requestId: job.requestId,
        revision: job.revision,
        lines: job.lines
      });
      this.updateQueueDepth();
    }
  }

  private sendSync(job: SyncJob): void {
    job.requestId = this.nextRequestId++;
    job.timeout = setTimeout(() => {
      if (this.syncInFlight === job) this.fail(new LanguageServiceError(`Tree-sitter worker document sync ${job.requestId} timed out.`, "timeout"));
    }, this.timeoutMs);
    this.counters.syncRequests += 1;
    if (job.kind === "open") {
      this.counters.fullSyncs += 1;
      this.post({
        type: "open",
        version: TREE_SITTER_WORKER_PROTOCOL_VERSION,
        generation: this.generation,
        requestId: job.requestId,
        revision: job.target.revision,
        text: job.target.doc.text
      });
      return;
    }
    this.counters.incrementalSyncs += 1;
    this.post({
      type: "update",
      version: TREE_SITTER_WORKER_PROTOCOL_VERSION,
      generation: this.generation,
      requestId: job.requestId,
      baseRevision: job.baseRevision,
      revision: job.target.revision,
      documentLength: job.target.doc.length,
      batches: job.batches
    });
  }

  private completeSync(payload: Extract<TreeSitterWorkerResponse, { type: "synced" }>): void {
    const job = this.syncInFlight;
    if (!job || payload.requestId !== job.requestId || payload.generation !== this.generation) return;
    if (payload.revision !== job.target.revision || payload.documentLength !== job.target.doc.length) {
      this.retryFullSync(job, "Tree-sitter worker acknowledged a different document.");
      return;
    }
    this.syncInFlight = null;
    this.workerRevision = payload.revision;
    this.counters.acknowledgedRevision = payload.revision;
    clearTimeout(job.timeout);
    for (const caller of job.callers) {
      caller.resolve();
    }
    this.updateQueueDepth();
    this.pump();
  }

  private retryFullSync(job: SyncJob, reason: string): void {
    if (job.kind === "open" || job.fallbackAttempted) {
      this.fail(new LanguageServiceError(reason, "protocol"));
      return;
    }
    clearTimeout(job.timeout);
    this.syncInFlight = null;
    job.kind = "open";
    job.baseRevision = -1;
    job.batches = [];
    job.fallbackAttempted = true;
    this.counters.fullSyncFallbacks += 1;
    this.syncPending = job;
    this.updateQueueDepth();
    this.pump();
  }

  private cancelHighlightsForDocumentSync(): void {
    if (this.pendingHighlight) {
      this.pendingHighlight.resolve([]);
      this.pendingHighlight = null;
      this.counters.cancelledRequests += 1;
    }
    this.supersedeActiveHighlight();
  }

  private supersedeActiveHighlight(): void {
    const active = this.activeHighlight;
    if (!active) return;
    clearTimeout(active.timeout);
    this.activeHighlight = null;
    active.resolve([]);
    this.counters.cancelledRequests += 1;
    this.post({
      type: "cancel",
      version: TREE_SITTER_WORKER_PROTOCOL_VERSION,
      generation: this.generation,
      requestId: active.requestId
    });
  }

  private post(message: TreeSitterWorkerMessage): void {
    try {
      this.worker.postMessage(message);
      this.counters.workerCrossings += 1;
      this.counters.workerMessageBytes += estimateTreeSitterMessageBytes(message);
      this.counters.copiedTextBytes += treeSitterCopiedTextBytes(message);
    } catch (error) {
      const failure = this.asError(error, "runtime");
      this.fail(failure);
      throw failure;
    }
  }

  private onMessage(payload: unknown): void {
    if (!isTreeSitterWorkerResponse(payload)) return this.fail(new LanguageServiceError("Malformed or unsupported Tree-sitter worker response.", "protocol"));
    this.counters.workerCrossings += 1;
    this.counters.workerMessageBytes += estimateTreeSitterMessageBytes(payload);
    if (payload.type === "ready") {
      if (this.state !== "starting") return this.fail(new LanguageServiceError("Unexpected Tree-sitter ready response.", "protocol"));
      clearTimeout(this.initTimeout);
      this.state = "ready";
      this.resolveReady();
      return;
    }
    if (payload.type === "error") return this.fail(new LanguageServiceError(payload.message, this.state === "starting" ? "init" : "runtime"));
    if (this.state !== "ready") return this.fail(new LanguageServiceError("Tree-sitter RPC response arrived before readiness.", "protocol"));
    if (payload.type === "synced") {
      this.completeSync(payload);
      return;
    }
    if (payload.type === "sync-required") {
      const job = this.syncInFlight;
      if (job && payload.requestId === job.requestId && payload.generation === this.generation) {
        this.retryFullSync(job, `Tree-sitter worker requested a full sync (${payload.reason}).`);
      }
      return;
    }
    if (payload.type === "highlights") {
      if (this.pendingSelections.has(payload.requestId)) {
        return this.fail(new LanguageServiceError("Tree-sitter worker returned a mismatched RPC response.", "protocol"));
      }
      const active = this.activeHighlight;
      if (!active || payload.requestId !== active.requestId || payload.generation !== this.generation) return;
      this.activeHighlight = null;
      clearTimeout(active.timeout);
      active.resolve(payload.spans);
      this.updateQueueDepth();
      this.pump();
      return;
    }
    if (payload.type === "indentation-result") {
      const pending = this.pendingIndentation.get(payload.requestId);
      if (!pending || payload.generation !== this.generation) return;
      this.pendingIndentation.delete(payload.requestId);
      pending.cleanup();
      pending.resolve(payload.result.revision === pending.revision ? payload.result : { revision: pending.revision, status: "stale" });
      return;
    }
    if (this.activeHighlight?.requestId === payload.requestId) {
      return this.fail(new LanguageServiceError("Tree-sitter worker returned a mismatched RPC response.", "protocol"));
    }
    const deferred = this.pendingSelections.get(payload.requestId);
    if (!deferred || payload.generation !== this.generation) return;
    this.pendingSelections.delete(payload.requestId);
    clearTimeout(deferred.timeout);
    deferred.resolve(payload.selection);
  }

  private updateQueueDepth(): void {
    const depth = Number(this.syncInFlight !== null) + Number(this.syncPending !== null);
    this.counters.queueDepth = depth;
    this.counters.maxQueueDepth = Math.max(this.counters.maxQueueDepth, depth);
  }

  private assertReady(): void {
    if (this.state !== "ready") throw this.failure ?? new LanguageServiceError("Tree-sitter worker is unavailable.", "destroyed");
  }

  private asError(error: unknown, code: LanguageServiceError["code"]): LanguageServiceError {
    return error instanceof LanguageServiceError
      ? error
      : new LanguageServiceError(error instanceof Error ? error.message : String(error), code);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    if (this.state !== "destroying" && this.state !== "destroyed") this.state = "failed";
    clearTimeout(this.initTimeout);
    this.rejectReady(error);
    for (const job of [this.syncInFlight, this.syncPending]) {
      if (!job) continue;
      clearTimeout(job.timeout);
      for (const caller of job.callers) {
        caller.reject(error);
      }
    }
    this.syncInFlight = null;
    this.syncPending = null;
    for (const highlight of [this.activeHighlight, this.pendingHighlight]) {
      if (!highlight) continue;
      clearTimeout(highlight.timeout);
      highlight.reject(error);
    }
    this.activeHighlight = null;
    this.pendingHighlight = null;
    for (const deferred of this.pendingSelections.values()) {
      clearTimeout(deferred.timeout);
      deferred.reject(error);
    }
    this.pendingSelections.clear();
    for (const deferred of this.pendingIndentation.values()) {
      deferred.cleanup();
      deferred.resolve({ revision: deferred.revision, status: "error" });
    }
    this.pendingIndentation.clear();
    this.updateQueueDepth();
    this.removeListeners();
    this.terminate();
  }

  private removeListeners(): void {
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleFailure);
    this.worker.removeEventListener("messageerror", this.handleFailure);
  }

  private terminate(): void {
    if (!this.terminated) {
      this.terminated = true;
      this.worker.terminate();
    }
  }

  destroy(): void {
    if (this.state === "destroyed" || this.state === "destroying") return;
    this.state = "destroying";
    this.fail(new LanguageServiceError("Tree-sitter worker was destroyed.", "destroyed"));
    this.state = "destroyed";
  }
}

export function createTreeSitterLanguageProvider(options: TreeSitterProviderOptions): LanguageProvider {
  return new TreeSitterLanguageProvider(options);
}

export function createTreeSitterLanguageServices(options: TreeSitterProviderOptions): EditorLanguageServices {
  const provider = new TreeSitterLanguageProvider(options);
  return {
    highlighter: provider,
    syntaxSelector: provider,
    indentation: provider,
    lifecycle: {
      get state() { return provider.status; },
      get error() { return provider.error; },
      owner: options.owner,
      whenReady: () => provider.whenReady(),
      destroy: () => provider.destroy(),
      recreate: () => createTreeSitterLanguageServices(options)
    }
  };
}
