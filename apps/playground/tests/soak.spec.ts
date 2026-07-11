import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "./browser-test";

interface SoakBudget {
  version: number;
  durationSeconds: number;
  keyToPaintP95Ms: number;
  maxLongTaskMs: number;
  maxHeapGrowthBytes: number;
  maxDomNodes: number;
  maxMaterializedVisualRows: number;
  cursorOnlyKeyToPaintMaxRatio: number;
  cursorOnlyKeyToPaintMaxDeltaMs: number;
  maxWorkerBurstRequests: number;
  minWorkerBurstMessageBytes: number;
  maxWorkerBurstMessageBytes: number;
  maxActiveWorkersAfterDestroy: number;
  maxActiveObserversAfterDestroy: number;
  maxActiveAnimationFramesAfterDestroy: number;
  maxActiveListenersDeltaAfterDestroy: number;
}

interface SoakSummary {
  seed: number;
  durationMs: number;
  actions: number;
  recentActions: readonly RecordedSoakAction[];
  withoutLanguage: {
    keyToPaintP95Ms: number;
    maxDomNodes: number;
    maxMaterializedVisualRows: number;
  };
  keyToPaint: { p50: number; p95: number; max: number };
  longTasks: { supported: boolean; count: number; maxMs: number };
  heap: { before: number | null; after: number | null; growth: number | null };
  maxDomNodes: number;
  maxMaterializedVisualRows: number;
  workerMessageBytes: number;
  latestRevision: number;
  languageRevision: number;
  burstLanguageWork: LanguageWorkSummary;
  finalLanguageWork: LanguageWorkSummary;
  cursorOnly: {
    lines1000: CursorOnlyMeasurement;
    lines20000: CursorOnlyMeasurement;
    p95Ratio: number;
    p95DeltaMs: number;
  };
  workerBurst: WorkerBurstSummary;
  denseDiagnostics: number;
  selectionCount: number;
  controllerOwnedLanguageRecreations: number;
  lifecycleSignals: { blur: number; focus: number };
  maxResidualEditorRootsAfterDestroy: number;
  collectability: CollectabilitySummary;
  workloads: readonly string[];
  resourcesBefore: ResourceCounts;
  resourcesAfter: ResourceCounts;
  resourceSamples: readonly ResourceSample[];
}

interface LanguageWorkSummary {
  requested: number;
  completed: number;
  inFlight: number;
  queued: number;
  maxQueueDepth: number;
  latestRequestedRevision: number;
  latestCompletedRevision: number;
  coalesced: number;
}

interface ResourceCounts {
  workers: number;
  observers: number;
  observerTypes: ObserverTypeCounts;
  observerSupport: ObserverTypeSupport;
  animationFrames: number;
  listeners: number;
  workerMessageBytes: number;
}

interface ResourceSample extends ResourceCounts {
  label: string;
  residualLightDomRoots: number;
}

interface ObserverTypeCounts {
  resize: number;
  mutation: number;
  intersection: number;
}

interface ObserverTypeSupport {
  resize: boolean;
  mutation: boolean;
  intersection: boolean;
}

interface CursorOnlyMeasurement {
  keyToPaintP95Ms: number;
  maxMaterializedVisualRows: number;
  samples: number;
}

interface RecordedSoakAction {
  index: number;
  kind: string;
  payload: Record<string, string | number | boolean>;
  rngStateAfter: number;
  status: "pending" | "completed";
}

interface SoakCheckpoint {
  seed: number;
  durationSeconds: number;
  phase: string;
  actionIndex: number;
  actionsCompleted: number;
  actionCount: number;
  rngState: number;
  recentActions: readonly RecordedSoakAction[];
}

interface WorkerBurstSummary {
  requests: number;
  responses: number;
  maxPending: number;
  messageBytes: number;
  responseOrder: readonly number[];
  intentionallyReorderedRequestIds: readonly number[];
  outOfOrder: boolean;
  terminated: boolean;
  pendingAfterDestroy: number;
  latestSentRevision: number;
  acknowledgedRevision: number;
  staleResponsesDropped: number;
  documentRevision: number;
  languageRevision: number;
}

interface CollectabilitySample {
  label: string;
  tracked: number;
  retainedAfterForcedGc: number;
}

interface CollectabilitySummary {
  weakRefSupported: boolean;
  forcedGcSupported: boolean;
  trackedDirectEditorRoots: number;
  trackedShadowRoots: number;
  trackedControlRoots: number;
  retainedDirectEditorRoots: number;
  retainedShadowRoots: number;
  retainedControlRoots: number;
  retainedAfterFinalGc: number;
  samples: readonly CollectabilitySample[];
}

declare global {
  interface Window {
    __wxSoakResources?: ResourceCounts;
    __wxSoakCheckpoint?: SoakCheckpoint;
    __wxReportSoakCheckpoint?: (checkpoint: SoakCheckpoint) => Promise<void>;
    __wxSoakCollectabilityRefs?: {
      directEditorRoots: WeakRef<object>[];
      shadowRoots: WeakRef<object>[];
      controlRoots: WeakRef<object>[];
    };
    gc?: () => void;
  }
}

const budget = JSON.parse(
  await readFile(resolve(process.cwd(), "benchmarks/budgets/web-soak-v1.json"), "utf8")
) as SoakBudget;
const durationSeconds = Number(process.env.WX_SOAK_SECONDS ?? budget.durationSeconds);
const seed = Number(process.env.WX_SOAK_SEED ?? 0x5eedc0de) >>> 0;
const moduleUrl = (path: string) => `/@fs/${resolve(process.cwd(), path)}`;

function installResourceInstrumentation(): () => void {
  return () => {
    const resources: ResourceCounts = {
      workers: 0,
      observers: 0,
      observerTypes: { resize: 0, mutation: 0, intersection: 0 },
      observerSupport: {
        resize: typeof window.ResizeObserver !== "undefined",
        mutation: typeof window.MutationObserver !== "undefined",
        intersection: typeof window.IntersectionObserver !== "undefined"
      },
      animationFrames: 0,
      listeners: 0,
      workerMessageBytes: 0
    };
    window.__wxSoakResources = resources;

    const NativeWorker = window.Worker;
    window.Worker = class TrackedWorker extends NativeWorker {
      private terminated = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        resources.workers += 1;
      }
      override postMessage(message: any, transfer?: Transferable[]): void;
      override postMessage(message: any, options?: StructuredSerializeOptions): void;
      override postMessage(message: any, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
        try { resources.workerMessageBytes += new TextEncoder().encode(JSON.stringify(message)).byteLength; } catch { /* opaque payload */ }
        if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
      }
      override terminate(): void {
        if (!this.terminated) {
          this.terminated = true;
          resources.workers = Math.max(0, resources.workers - 1);
        }
        super.terminate();
      }
    } as typeof Worker;

    const activateObserver = (type: keyof ObserverTypeCounts) => {
      resources.observers += 1;
      resources.observerTypes[type] += 1;
    };
    const deactivateObserver = (type: keyof ObserverTypeCounts) => {
      resources.observers = Math.max(0, resources.observers - 1);
      resources.observerTypes[type] = Math.max(0, resources.observerTypes[type] - 1);
    };

    if (resources.observerSupport.resize) {
      const NativeResizeObserver = window.ResizeObserver;
      window.ResizeObserver = class TrackedResizeObserver extends NativeResizeObserver {
        private readonly targets = new Set<Element>();
        constructor(callback: ResizeObserverCallback) {
          super(callback);
        }
        override observe(target: Element, options?: ResizeObserverOptions): void {
          if (!this.targets.has(target) && this.targets.size === 0) activateObserver("resize");
          this.targets.add(target);
          super.observe(target, options);
        }
        override unobserve(target: Element): void {
          const removed = this.targets.delete(target);
          if (removed && this.targets.size === 0) deactivateObserver("resize");
          super.unobserve(target);
        }
        override disconnect(): void {
          if (this.targets.size > 0) deactivateObserver("resize");
          this.targets.clear();
          super.disconnect();
        }
      };
    }

    if (resources.observerSupport.mutation) {
      const NativeMutationObserver = window.MutationObserver;
      window.MutationObserver = class TrackedMutationObserver extends NativeMutationObserver {
        private active = false;
        override observe(target: Node, options?: MutationObserverInit): void {
          if (!this.active) activateObserver("mutation");
          this.active = true;
          super.observe(target, options);
        }
        override disconnect(): void {
          if (this.active) deactivateObserver("mutation");
          this.active = false;
          super.disconnect();
        }
      };
    }

    if (resources.observerSupport.intersection) {
      const NativeIntersectionObserver = window.IntersectionObserver;
      window.IntersectionObserver = class TrackedIntersectionObserver extends NativeIntersectionObserver {
        private readonly targets = new Set<Element>();
        override observe(target: Element): void {
          if (!this.targets.has(target) && this.targets.size === 0) activateObserver("intersection");
          this.targets.add(target);
          super.observe(target);
        }
        override unobserve(target: Element): void {
          const removed = this.targets.delete(target);
          if (removed && this.targets.size === 0) deactivateObserver("intersection");
          super.unobserve(target);
        }
        override disconnect(): void {
          if (this.targets.size > 0) deactivateObserver("intersection");
          this.targets.clear();
          super.disconnect();
        }
      };
    }

    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const frames = new Set<number>();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const id = nativeRequestAnimationFrame((time) => {
        if (frames.delete(id)) resources.animationFrames = Math.max(0, resources.animationFrames - 1);
        callback(time);
      });
      frames.add(id);
      resources.animationFrames += 1;
      return id;
    };
    window.cancelAnimationFrame = (id: number) => {
      if (frames.delete(id)) resources.animationFrames = Math.max(0, resources.animationFrames - 1);
      nativeCancelAnimationFrame(id);
    };

    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativeRemove = EventTarget.prototype.removeEventListener;
    interface ListenerRegistration {
      wrapped: EventListenerOrEventListenerObject;
      signal?: AbortSignal;
      abort?: EventListener;
    }
    const registrations = new WeakMap<EventTarget, Map<EventListenerOrEventListenerObject, Map<string, ListenerRegistration>>>();
    const keyFor = (type: string, options?: boolean | AddEventListenerOptions) =>
      `${type}:${typeof options === "boolean" ? options : !!options?.capture}`;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (!listener) return nativeAdd.call(this, type, listener, options);
      const signal = typeof options === "object" ? options?.signal : undefined;
      if (signal?.aborted) return nativeAdd.call(this, type, listener, options);
      const listeners = registrations.get(this) ?? new Map();
      registrations.set(this, listeners);
      const byKey = listeners.get(listener) ?? new Map();
      listeners.set(listener, byKey);
      const key = keyFor(type, options);
      if (byKey.has(key)) return;
      let registration: ListenerRegistration;
      const cleanupEmptyRegistrationMaps = () => {
        if (byKey.size === 0) listeners.delete(listener);
        if (listeners.size === 0) registrations.delete(this);
      };
      const release = () => {
        if (!byKey.delete(key)) return;
        resources.listeners = Math.max(0, resources.listeners - 1);
        if (registration.signal && registration.abort) {
          nativeRemove.call(registration.signal, "abort", registration.abort, false);
        }
        cleanupEmptyRegistrationMaps();
      };
      let wrapped: EventListenerOrEventListenerObject = listener;
      if (typeof options === "object" && options?.once) {
        wrapped = (event: Event) => {
          release();
          if (typeof listener === "function") listener.call(this, event);
          else listener.handleEvent(event);
        };
      }
      registration = { wrapped, ...(signal ? { signal } : {}) };
      byKey.set(key, registration);
      resources.listeners += 1;
      try {
        nativeAdd.call(this, type, wrapped, options);
        if (signal) {
          registration.abort = release;
          nativeAdd.call(signal, "abort", registration.abort, { once: true });
        }
      } catch (error) {
        release();
        nativeRemove.call(this, type, wrapped, options);
        throw error;
      }
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if (!listener) return nativeRemove.call(this, type, listener, options);
      const listeners = registrations.get(this);
      const byKey = listeners?.get(listener);
      const key = keyFor(type, options);
      const registration = byKey?.get(key);
      const wrapped = registration?.wrapped ?? listener;
      if (registration && byKey?.delete(key)) {
        resources.listeners = Math.max(0, resources.listeners - 1);
        if (registration.signal && registration.abort) {
          nativeRemove.call(registration.signal, "abort", registration.abort, false);
        }
        if (byKey.size === 0) listeners?.delete(listener);
        if (listeners?.size === 0) registrations.delete(this);
      }
      nativeRemove.call(this, type, wrapped, options);
    };
  };
}

test("seeded 20,000-line editor and lifecycle soak stays within versioned budgets", async ({ page }, testInfo) => {
  const initialCheckpoint: SoakCheckpoint = {
    seed,
    durationSeconds,
    phase: "before-navigation",
    actionIndex: -1,
    actionsCompleted: 0,
    actionCount: Math.max(1, Math.floor((durationSeconds * 1_000) / 12)),
    rngState: seed,
    recentActions: []
  };
  let latestCheckpoint = initialCheckpoint;
  try {
    await page.exposeFunction("__wxReportSoakCheckpoint", (checkpoint: SoakCheckpoint) => {
      latestCheckpoint = checkpoint;
    });
    await page.addInitScript((checkpoint: SoakCheckpoint) => {
      window.__wxSoakCheckpoint = checkpoint;
    }, initialCheckpoint);
    await page.addInitScript(installResourceInstrumentation());
    await page.goto("./?soak=1");
    await expect(page.locator("#app")).toHaveAttribute("data-wx-soak-host", "ready");

    const summary = await page.evaluate(async ({
    controllerUrl,
    domUrl,
    treeUrl,
    elementUrl,
    parserWasmUrl,
    languageWasmUrl,
    seed,
    durationMs
  }): Promise<SoakSummary> => {
    const { createEditorController } = await import(controllerUrl) as typeof import("@mewhhaha/wx-controller");
    const { createEditor } = await import(domUrl) as typeof import("@mewhhaha/wx-dom");
    const { createTreeSitterLanguageServices, typescriptHighlightQuery } = await import(treeUrl) as typeof import("@wx/editor-tree-sitter");
    const { defineWxEditorElement } = await import(elementUrl) as typeof import("@mewhhaha/wx-element");
    const resources = window.__wxSoakResources!;
    const copyResources = (): ResourceCounts => ({
      ...resources,
      observerTypes: { ...resources.observerTypes },
      observerSupport: { ...resources.observerSupport }
    });
    const resourceSamples: ResourceSample[] = [];
    const sampleResources = (label: string) => resourceSamples.push({
      label,
      ...copyResources(),
      residualLightDomRoots: document.querySelectorAll("[data-wx-editor='root']").length
    });
    const frame = () => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    const forceGcAndYield = async () => {
      if (typeof window.gc !== "function") throw new Error("Scheduled Chromium did not expose window.gc");
      await new Promise<void>((resolveTask) => setTimeout(resolveTask, 0));
      for (let pass = 0; pass < 4; pass += 1) {
        window.gc();
        await new Promise<void>((resolveTask) => setTimeout(resolveTask, 0));
      }
    };
    const percentile = (values: readonly number[], p: number) => {
      const sorted = [...values].sort((left, right) => left - right);
      if (sorted.length === 0) return 0;
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
    };
    let randomState = seed >>> 0;
    const random = () => {
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      return randomState >>> 0;
    };
    const scheduledActionCount = Math.max(1, Math.floor(durationMs / 12));
    const scheduledActions = Array.from({ length: scheduledActionCount }, (_, index): RecordedSoakAction => {
      const choice = random() % 12;
      const payloadRoll = random();
      const base = { index, rngStateAfter: randomState >>> 0, status: "pending" as const };
      if (choice < 4) return { ...base, kind: "key", payload: { key: ["j", "k", "h", "l"][choice]! } };
      if (choice === 4) return { ...base, kind: "insert", payload: { character: String.fromCharCode(97 + (payloadRoll % 26)) } };
      if (choice === 5) return { ...base, kind: "key", payload: { key: "u" } };
      if (choice === 6) return { ...base, kind: "key", payload: { key: "U" } };
      if (choice === 7) return { ...base, kind: "search", payload: { query: "value", direction: "forward" } };
      if (choice === 8) return { ...base, kind: "completion-pair", payload: { requests: 2 } };
      if (choice === 9) return { ...base, kind: "hover", payload: { target: "primary-head" } };
      if (choice === 10) return {
        ...base,
        kind: "split-cycle",
        payload: { orientation: payloadRoll % 2 ? "vertical" : "horizontal" }
      };
      return { ...base, kind: "save", payload: { host: "no-op" } };
    });
    const recentActions: RecordedSoakAction[] = [];
    let reportInFlight: Promise<void> | null = null;
    let queuedReport: SoakCheckpoint | null = null;
    const pumpCheckpointReport = () => {
      if (reportInFlight || !queuedReport || !window.__wxReportSoakCheckpoint) return;
      const report = queuedReport;
      queuedReport = null;
      reportInFlight = window.__wxReportSoakCheckpoint(report)
        .catch(() => { /* the in-page checkpoint remains authoritative while the page is alive */ })
        .finally(() => {
          reportInFlight = null;
          pumpCheckpointReport();
        });
    };
    const flushCheckpointReports = async () => {
      while (reportInFlight || queuedReport) {
        pumpCheckpointReport();
        if (reportInFlight) await reportInFlight;
      }
    };
    const checkpoint = (phase: string, actionIndex: number, actionsCompleted: number, rngState: number) => {
      const next: SoakCheckpoint = {
        seed,
        durationSeconds: durationMs / 1_000,
        phase,
        actionIndex,
        actionsCompleted,
        actionCount: scheduledActionCount,
        rngState,
        recentActions
      };
      window.__wxSoakCheckpoint = next;
      const periodicSustainedReport =
        phase === "sustained-action-complete" &&
        (actionsCompleted === scheduledActionCount || actionsCompleted % 25 === 0);
      if (!phase.startsWith("sustained-action") || periodicSustainedReport) {
        queuedReport = {
          ...next,
          recentActions: recentActions.map((action) => ({ ...action, payload: { ...action.payload } }))
        };
        pumpCheckpointReport();
      }
    };
    checkpoint("setup", -1, 0, randomState);
    const source = Array.from({ length: 20_000 }, (_, index) =>
      index % 997 === 0
        ? `const long${index} = "${"wrapped-😀-segment ".repeat(300)}";`
        : `const value${index} = ${index};`
    ).join("\n");
    const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const longTaskSupported =
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;
    if (!longTaskSupported) throw new Error("Scheduled Chromium does not support long-task telemetry");
    const longTaskDurations: number[] = [];
    const longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTaskDurations.push(entry.duration);
    });

    const listenerProbeBaseline = resources.listeners;
    const listenerProbeTarget = new EventTarget();
    const listenerProbeState = { calls: 0 };
    const listenerProbeCalls = () => listenerProbeState.calls;
    const signalController = new AbortController();
    listenerProbeTarget.addEventListener(
      "wx-signal-probe",
      () => { listenerProbeState.calls += 1; },
      { signal: signalController.signal }
    );
    if (resources.listeners !== listenerProbeBaseline + 1) {
      throw new Error("Listener instrumentation did not count an AbortSignal registration");
    }
    signalController.abort();
    listenerProbeTarget.dispatchEvent(new Event("wx-signal-probe"));
    if (resources.listeners !== listenerProbeBaseline || listenerProbeCalls() !== 0) {
      throw new Error("Listener instrumentation did not release an aborted registration");
    }
    listenerProbeTarget.addEventListener(
      "wx-once-probe",
      () => { listenerProbeState.calls += 1; },
      { once: true }
    );
    listenerProbeTarget.dispatchEvent(new Event("wx-once-probe"));
    listenerProbeTarget.dispatchEvent(new Event("wx-once-probe"));
    if (resources.listeners !== listenerProbeBaseline || listenerProbeCalls() !== 1) {
      throw new Error("Listener instrumentation did not release a once registration exactly once");
    }
    const alreadyAbortedController = new AbortController();
    alreadyAbortedController.abort();
    listenerProbeTarget.addEventListener(
      "wx-already-aborted-probe",
      () => { listenerProbeState.calls += 1; },
      { signal: alreadyAbortedController.signal }
    );
    listenerProbeTarget.dispatchEvent(new Event("wx-already-aborted-probe"));
    if (resources.listeners !== listenerProbeBaseline || listenerProbeCalls() !== 1) {
      throw new Error("Listener instrumentation counted an already-aborted registration");
    }

    const baselineMount = document.createElement("div");
    baselineMount.style.cssText = "position:fixed;inset:0;width:900px;height:600px";
    document.body.append(baselineMount);
    const resourcesBefore = copyResources();
    sampleResources("baseline");

    const plainController = createEditorController({ value: source });
    const plainEditor = createEditor(baselineMount, { controller: plainController, softWrap: true });
    plainEditor.focus();
    await frame();
    const plainLatencies: number[] = [];
    let plainMaxDomNodes = 0;
    let plainMaxRows = 0;
    for (let index = 0; index < 100; index += 1) {
      const actionStarted = performance.now();
      await plainController.handleKeyInput({ key: "j" });
      await frame();
      plainLatencies.push(performance.now() - actionStarted);
      plainMaxDomNodes = Math.max(plainMaxDomNodes, baselineMount.querySelectorAll("*").length);
      plainMaxRows = Math.max(plainMaxRows, plainController.getPresentationState().viewport.visualRows.length);
    }
    plainEditor.destroy();
    plainController.destroy();
    baselineMount.replaceChildren();
    await frame();

    // Cursor-only evidence combines the structural row bound with warmed
    // controller-to-paint samples at two document sizes.
    const measureCursorOnly = async (lineCount: number): Promise<CursorOnlyMeasurement> => {
      const cursorController = createEditorController({
        value: Array.from({ length: lineCount }, (_, index) => `value ${index}`).join("\n")
      });
      const cursorMount = document.createElement("div");
      cursorMount.style.cssText = "width:900px;height:600px";
      document.body.append(cursorMount);
      const cursorEditor = createEditor(cursorMount, { controller: cursorController, softWrap: true });
      let rows = 0;
      for (let index = 0; index < 25; index += 1) {
        await cursorController.handleKeyInput({ key: "j" });
        await frame();
      }
      const cursorLatencies: number[] = [];
      for (let index = 0; index < 120; index += 1) {
        const actionStarted = performance.now();
        await cursorController.handleKeyInput({ key: "j" });
        await frame();
        cursorLatencies.push(performance.now() - actionStarted);
        rows = Math.max(rows, cursorController.getPresentationState().viewport.visualRows.length);
      }
      cursorEditor.destroy();
      cursorController.destroy();
      cursorMount.remove();
      await frame();
      return {
        keyToPaintP95Ms: percentile(cursorLatencies, 0.95),
        maxMaterializedVisualRows: rows,
        samples: cursorLatencies.length
      };
    };
    const cursorOnlyLines1000 = await measureCursorOnly(1_000);
    const cursorOnlyLines20000 = await measureCursorOnly(20_000);
    const cursorOnly = {
      lines1000: cursorOnlyLines1000,
      lines20000: cursorOnlyLines20000,
      p95Ratio: cursorOnlyLines20000.keyToPaintP95Ms / Math.max(1, cursorOnlyLines1000.keyToPaintP95Ms),
      p95DeltaMs: cursorOnlyLines20000.keyToPaintP95Ms - cursorOnlyLines1000.keyToPaintP95Ms
    };

    const selectionController = createEditorController({
      value: Array.from({ length: 1_200 }, () => "value").join("\n")
    });
    selectionController.setSearchState({ query: "value", direction: "forward" });
    selectionController.selectAllOccurrences();
    const selectionCount = selectionController.getState().selection.ranges.length;
    selectionController.collapseSelections();
    selectionController.destroy();

    let controllerOwnedLanguageRecreations = 0;
    const recreateController = createEditorController({ value: "recreate" });
    recreateController.setLanguageServices({
      lifecycle: {
        state: "failed",
        owner: "controller",
        destroy() {},
        recreate: async () => {
          controllerOwnedLanguageRecreations += 1;
          return { lifecycle: { state: "ready", owner: "controller", destroy() {} } };
        }
      }
    });
    await Promise.resolve();
    await Promise.resolve();
    await recreateController.retryLanguageServices();
    recreateController.destroy();

    const workerSource = `
      let held = null;
      self.onmessage = ({ data }) => {
        if (data.kind === "release-held-update") {
          if (held) {
            const next = held;
            held = null;
            setTimeout(() => self.postMessage({ requestId: next.requestId, revision: next.revision }), 10);
          }
          return;
        }
        if (data.hold) {
          held = data;
          return;
        }
        setTimeout(() => self.postMessage({ requestId: data.requestId, revision: data.revision }), data.delayMs);
      };
    `;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const burstWorker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
    let nextWorkerRequestId = 1;
    let workerDestroyed = false;
    const workerPending = new Map<number, {
      expectedRevision: number;
      resolve: () => void;
      reject: (error: Error) => void;
    }>();
    const workerBurstMutable = {
      requests: 0,
      responses: 0,
      maxPending: 0,
      messageBytes: 0,
      responseOrder: [] as number[],
      intentionallyReorderedRequestIds: [] as number[],
      latestSentRevision: -1,
      acknowledgedRevision: -1,
      staleResponsesDropped: 0
    };
    burstWorker.onmessage = (event: MessageEvent<{ requestId: number; revision: number }>) => {
      const { requestId, revision } = event.data;
      workerBurstMutable.responses += 1;
      workerBurstMutable.responseOrder.push(requestId);
      const pending = workerPending.get(requestId);
      if (!pending) throw new Error(`Burst worker replied to unknown request ${requestId}`);
      workerPending.delete(requestId);
      if (revision !== pending.expectedRevision) {
        pending.reject(new Error(
          `Burst worker revision mismatch for ${requestId}: expected ${pending.expectedRevision}, received ${revision}`
        ));
        return;
      }
      if (revision < workerBurstMutable.acknowledgedRevision) {
        workerBurstMutable.staleResponsesDropped += 1;
      } else {
        workerBurstMutable.acknowledgedRevision = revision;
      }
      pending.resolve();
    };
    const sendWorkerRequest = (
      kind: string,
      revision: number,
      payload: unknown,
      delayMs: number,
      hold = false
    ) => {
      const requestId = nextWorkerRequestId++;
      const message = { requestId, kind, revision, delayMs, hold, payload };
      workerBurstMutable.requests += 1;
      workerBurstMutable.messageBytes += new TextEncoder().encode(JSON.stringify(message)).byteLength;
      workerBurstMutable.latestSentRevision = Math.max(workerBurstMutable.latestSentRevision, revision);
      const promise = new Promise<void>((resolveRequest, rejectRequest) => {
        workerPending.set(requestId, {
          expectedRevision: revision,
          resolve: resolveRequest,
          reject: rejectRequest
        });
        workerBurstMutable.maxPending = Math.max(workerBurstMutable.maxPending, workerPending.size);
        burstWorker.postMessage(message);
      });
      return { requestId, promise };
    };
    const releaseHeldWorkerUpdate = () => {
      const message = { kind: "release-held-update" };
      workerBurstMutable.messageBytes += new TextEncoder().encode(JSON.stringify(message)).byteLength;
      burstWorker.postMessage(message);
    };
    let holdNextWorkerUpdate = true;
    const workerHighlighter = {
      async open(document: { revision: number; doc: { length: number } }) {
        await sendWorkerRequest("open", document.revision, { documentLength: document.doc.length }, 1).promise;
      },
      async update(
        document: { revision: number },
        changes: readonly { from: number; to: number; insert: string }[]
      ) {
        const hold = holdNextWorkerUpdate;
        holdNextWorkerUpdate = false;
        await sendWorkerRequest("update", document.revision, {
          changes: changes.map(({ from, to, insert }) => ({ from, to, insert }))
        }, 1, hold).promise;
      },
      async updateBatches(updates: readonly {
        document: { revision: number };
        changes: readonly { from: number; to: number; insert: string }[];
      }[]) {
        const midpoint = Math.max(1, Math.floor(updates.length / 2));
        const serializeUpdates = (batch: typeof updates) => batch.map(({ document, changes }) => ({
          revision: document.revision,
          changes: changes.map(({ from, to, insert }) => ({ from, to, insert }))
        }));
        const first = sendWorkerRequest(
          "update-batch-first",
          updates[midpoint - 1]?.document.revision ?? 0,
          { updates: serializeUpdates(updates.slice(0, midpoint)) },
          25
        );
        const second = sendWorkerRequest(
          "update-batch-second",
          updates.at(-1)?.document.revision ?? 0,
          { updates: serializeUpdates(updates.slice(midpoint)) },
          1
        );
        workerBurstMutable.intentionallyReorderedRequestIds = [first.requestId, second.requestId];
        await Promise.all([first.promise, second.promise]);
      },
      async getHighlights() { return []; }
    };
    const workerLanguageServices = {
      highlighter: workerHighlighter,
      lifecycle: {
        state: "ready" as const,
        owner: "view" as const,
        destroy() {
          if (workerDestroyed) return;
          workerDestroyed = true;
          burstWorker.terminate();
          for (const pending of workerPending.values()) pending.reject(new Error("Burst worker destroyed"));
          workerPending.clear();
        }
      }
    };

    const tree = createTreeSitterLanguageServices({
      parserWasmUrl,
      languageWasmUrl,
      query: typescriptHighlightQuery,
      owner: "view",
      timeoutMs: 20_000
    });
    let completionGeneration = 0;
    const delayedLanguage = {
      completion: {
        async complete() {
          const generation = ++completionGeneration;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, generation % 2 ? 12 : 1));
          return [{ label: `completion-${generation}` }];
        }
      },
      hover: {
        async hover() {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, completionGeneration % 8));
          return { content: "soak hover" };
        }
      }
    };
    const controller = createEditorController({ value: source });
    controller.setHostServices({
      async writeFile() {},
      async getLineChanges() { return []; }
    });
    const editor = createEditor(baselineMount, {
      controller,
      languageServices: [tree, delayedLanguage],
      softWrap: true
    });
    editor.focus();
    await tree.lifecycle?.whenReady?.();
    await controller.refreshLanguage({ forceDocumentSync: true, refreshDiagnostics: false, refreshLineChanges: false });
    await frame();

    // Dense diagnostics exercise layout/render decoration paths independently
    // from Tree-sitter's normal diagnostic volume.
    const denseDiagnosticsServices = {
      diagnostics: {
        async diagnostics() {
          return Array.from({ length: 1_200 }, (_, index) => ({
            from: index * 20,
            to: index * 20 + 5,
            severity: index % 2 ? "warning" as const : "error" as const,
            message: `soak diagnostic ${index}`
          }));
        }
      }
    };
    await editor.setLanguageServices([tree, delayedLanguage, denseDiagnosticsServices]);
    await controller.refreshLanguage({ refreshHighlights: false, refreshLineChanges: false });
    for (let index = 0; index < 20 && controller.getPresentationState().language.diagnostics.length < 1_200; index += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
    const denseDiagnostics = controller.getPresentationState().language.diagnostics.length;

    let lifecycleFocus = 0;
    let lifecycleBlur = 0;
    const focusTarget = baselineMount.querySelector<HTMLElement>("[data-wx-editor='input']")!;
    const lifecycleBackgroundTarget = document.createElement("button");
    document.body.append(lifecycleBackgroundTarget);
    const onLifecycleFocus = () => { lifecycleFocus += 1; };
    const onLifecycleBlur = () => { lifecycleBlur += 1; };
    focusTarget.addEventListener("focus", onLifecycleFocus);
    focusTarget.addEventListener("blur", onLifecycleBlur);
    focusTarget.focus();
    lifecycleBackgroundTarget.focus();
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    focusTarget.focus();
    lifecycleBackgroundTarget.remove();
    focusTarget.removeEventListener("focus", onLifecycleFocus);
    focusTarget.removeEventListener("blur", onLifecycleBlur);
    baselineMount.style.width = "720px";
    window.dispatchEvent(new Event("resize"));
    await frame();
    await frame();

    // Setup intentionally includes broad structural work (diagnostic creation
    // and many selections); measure long tasks for the sustained workload.
    longTaskDurations.length = 0;
    await forceGcAndYield();
    const beforeHeap = heap();
    try {
      longTaskObserver.observe({ type: "longtask", buffered: false });
    } catch (error) {
      throw new Error(`Long-task telemetry registration failed: ${String(error)}`);
    }
    const latencies: number[] = [];
    let maxDomNodes = 0;
    let maxMaterializedVisualRows = 0;
    let actions = 0;
    const started = performance.now();
    const waitForLanguageConvergence = async (label: string): Promise<LanguageWorkSummary> => {
      const deadline = performance.now() + 20_000;
      for (;;) {
        const work = controller.getPresentationState().language.work.document;
        if (
          work.inFlight === 0 &&
          work.queued === 0 &&
          work.latestCompletedRevision === work.latestRequestedRevision
        ) return { ...work };
        if (performance.now() >= deadline) {
          throw new Error(`${label} language work did not converge: ${JSON.stringify(work)}`);
        }
        await frame();
      }
    };

    let burstLanguageWork: LanguageWorkSummary | null = null;
    let workerBurstDocumentRevision = -1;
    let workerBurstLanguageRevision = -1;
    await editor.setLanguageServices([
      workerLanguageServices,
      tree,
      delayedLanguage,
      denseDiagnosticsServices
    ]);
    try {
      await waitForLanguageConvergence("worker service startup");
      // Browser key events arrive as separate tasks. Keep the 1,000-input pressure
      // while yielding between bounded groups so the harness does not manufacture
      // one enormous main-thread task that no real input source can produce.
      await controller.handleKeyInput({ key: "i" });
      for (let offset = 0; offset < 1_000; offset += 50) {
        const burstChunk: RecordedSoakAction = {
          index: -20 + (offset / 50),
          kind: "worker-burst-chunk",
          payload: { fromInput: offset, toInput: offset + 49, character: "x", chunkSize: 50 },
          rngStateAfter: randomState,
          status: "pending"
        };
        recentActions.push(burstChunk);
        checkpoint(`worker-burst-${offset + 50}`, burstChunk.index, 0, randomState);
        await Promise.all(Array.from({ length: 50 }, () => controller.handleTextInput("x")));
        await new Promise<void>((resolveTask) => setTimeout(resolveTask, 0));
        burstChunk.status = "completed";
        checkpoint(`worker-burst-${offset + 50}-complete`, burstChunk.index, 0, randomState);
      }
      const workerStartDeadline = performance.now() + 5_000;
      while (workerBurstMutable.requests < 2 && performance.now() < workerStartDeadline) {
        await new Promise<void>((resolveTask) => setTimeout(resolveTask, 0));
      }
      if (workerBurstMutable.requests < 2) throw new Error("Worker-backed update did not start during burst.");
      releaseHeldWorkerUpdate();
      await controller.handleKeyInput({ key: "Escape" });
      burstLanguageWork = await waitForLanguageConvergence("worker-backed 1,000-input burst");
      // Editor-state revision also includes the Escape mode/selection change;
      // the scheduler's target is the independent document revision contract.
      workerBurstDocumentRevision = burstLanguageWork.latestRequestedRevision;
      workerBurstLanguageRevision = controller.getPresentationState().language.languageRevision;
    } finally {
      await editor.setLanguageServices([tree, delayedLanguage, denseDiagnosticsServices]);
    }
    if (!burstLanguageWork) throw new Error("Worker-backed burst did not produce convergence evidence.");
    const [reorderedFirst, reorderedSecond] = workerBurstMutable.intentionallyReorderedRequestIds;
    const firstResponseIndex = workerBurstMutable.responseOrder.indexOf(reorderedFirst ?? -1);
    const secondResponseIndex = workerBurstMutable.responseOrder.indexOf(reorderedSecond ?? -1);
    const workerBurst: WorkerBurstSummary = {
      ...workerBurstMutable,
      responseOrder: [...workerBurstMutable.responseOrder],
      intentionallyReorderedRequestIds: [...workerBurstMutable.intentionallyReorderedRequestIds],
      outOfOrder:
        firstResponseIndex >= 0 &&
        secondResponseIndex >= 0 &&
        secondResponseIndex < firstResponseIndex,
      terminated: workerDestroyed,
      pendingAfterDestroy: workerPending.size,
      documentRevision: workerBurstDocumentRevision,
      languageRevision: workerBurstLanguageRevision
    };
    await waitForLanguageConvergence("Tree-sitter restoration after worker burst");

    const sustainedStarted = performance.now();
    for (const scheduled of scheduledActions) {
      const recorded: RecordedSoakAction = {
        ...scheduled,
        payload: { ...scheduled.payload },
        status: "pending"
      };
      recentActions.push(recorded);
      if (recentActions.length > 200) recentActions.shift();
      checkpoint("sustained-action", scheduled.index, actions, scheduled.rngStateAfter);

      const actionStarted = performance.now();
      if (scheduled.kind === "key") {
        await controller.handleKeyInput({ key: String(scheduled.payload.key) });
        await frame();
        latencies.push(performance.now() - actionStarted);
      } else if (scheduled.kind === "insert") {
        await controller.handleKeyInput({ key: "i" });
        await controller.handleTextInput(String(scheduled.payload.character));
        await controller.handleKeyInput({ key: "Escape" });
      } else if (scheduled.kind === "search") {
        controller.setSearchState({
          query: String(scheduled.payload.query),
          direction: String(scheduled.payload.direction) as "forward" | "backward"
        });
        controller.repeatSearch(false);
      } else if (scheduled.kind === "completion-pair") {
        await Promise.all([controller.requestCompletion(), controller.requestCompletion()]);
        controller.dismissCompletion();
      } else if (scheduled.kind === "hover") {
        await controller.requestHoverAt(controller.getState().selection.ranges[0]?.head ?? 0);
        controller.clearHover();
      } else if (scheduled.kind === "split-cycle") {
        controller.splitPane(String(scheduled.payload.orientation) as "vertical" | "horizontal");
        await frame();
        controller.closePane();
      } else {
        await controller.saveDocument();
      }
      recorded.status = "completed";
      actions = scheduled.index + 1;
      checkpoint("sustained-action-complete", scheduled.index, actions, scheduled.rngStateAfter);
      maxDomNodes = Math.max(maxDomNodes, baselineMount.querySelectorAll("*").length);
      maxMaterializedVisualRows = Math.max(
        maxMaterializedVisualRows,
        controller.getPresentationState().viewport.visualRows.length
      );
      const targetTime = sustainedStarted + ((scheduled.index + 1) * 12);
      const pacingDelay = targetTime - performance.now();
      if (pacingDelay > 0) {
        await new Promise<void>((resolvePacing) => setTimeout(resolvePacing, pacingDelay));
      }
    }

    const finalLanguageWork = await waitForLanguageConvergence("sustained workload");
    const latestRevision = controller.getState().revision;
    const languageRevision = controller.getPresentationState().language.languageRevision;
    for (const entry of longTaskObserver.takeRecords()) longTaskDurations.push(entry.duration);
    longTaskObserver.disconnect();
    await forceGcAndYield();
    const afterHeap = heap();
    editor.destroy();
    controller.destroy();
    baselineMount.remove();
    sampleResources("after-sustained-destroy");

    // Repeated create/destroy cycles isolate listeners, every supported observer
    // class, RAFs, workers, synchronous residual DOM, and GC collectability.
    const customElementTag = "wx-editor-soak-lifecycle";
    defineWxEditorElement(customElementTag);
    let maxResidualEditorRootsAfterDestroy = 0;
    const directEditorRootRefs: WeakRef<object>[] = [];
    const shadowRootRefs: WeakRef<object>[] = [];
    const controlRootRefs: WeakRef<object>[] = [];
    window.__wxSoakCollectabilityRefs = {
      directEditorRoots: directEditorRootRefs,
      shadowRoots: shadowRootRefs,
      controlRoots: controlRootRefs
    };
    const collectabilitySamples: CollectabilitySample[] = [];
    const recordCollectabilityCheckpoint = (label: string) => {
      const sample = {
        label,
        tracked: directEditorRootRefs.length + shadowRootRefs.length,
        // Filled after this remote-evaluation job ends and standalone GC jobs run.
        retainedAfterForcedGc: -1
      };
      collectabilitySamples.push(sample);
      checkpoint(`collectability-${label}`, actions - 1, actions, scheduledActions.at(-1)?.rngStateAfter ?? seed);
    };
    const createAndDestroyDirectEditor = (cycle: number) => {
      const mount = document.createElement("div");
      mount.style.cssText = "width:480px;height:240px";
      document.body.append(mount);
      const handle = createEditor(mount, { value: source.slice(0, 40_000), softWrap: cycle % 2 === 0 });
      const root = mount.querySelector<HTMLElement>("[data-wx-editor='root']");
      if (!root) throw new Error(`Direct editor cycle ${cycle} did not create a root.`);
      directEditorRootRefs.push(new WeakRef(root));
      handle.destroy();
      maxResidualEditorRootsAfterDestroy = Math.max(
        maxResidualEditorRootsAfterDestroy,
        mount.querySelectorAll("[data-wx-editor='root']").length
      );
      mount.remove();
    };
    const connectAndDisconnectCustomElement = (cycle: number) => {
      const element = document.createElement(customElementTag);
      document.body.append(element);
      const shadowRoot = element.shadowRoot;
      if (!shadowRoot) throw new Error(`Custom element cycle ${cycle} did not create a shadow root.`);
      shadowRootRefs.push(new WeakRef(shadowRoot));
      element.remove();
      maxResidualEditorRootsAfterDestroy = Math.max(
        maxResidualEditorRootsAfterDestroy,
        shadowRoot.querySelectorAll("[data-wx-editor='root']").length
      );
    };
    const runLifecycleCycleInFreshTask = (cycle: number) => new Promise<void>((resolveCycle, rejectCycle) => {
      setTimeout(() => {
        try {
          // WeakRef targets created by the original remote-evaluation job are
          // kept alive by V8 until that job ends. A fresh browser task makes
          // later forced-GC samples evidence of editor retention instead.
          createAndDestroyDirectEditor(cycle);
          connectAndDisconnectCustomElement(cycle);
          const control = document.createElement("div");
          document.body.append(control);
          controlRootRefs.push(new WeakRef(control));
          control.remove();
          resolveCycle();
        } catch (error) {
          rejectCycle(error);
        }
      }, 0);
    });
    let retainedAfterFinalGc = -1;
    try {
      for (let cycle = 0; cycle < 25; cycle += 1) {
        await runLifecycleCycleInFreshTask(cycle);
        if ((cycle + 1) % 5 === 0) {
          await frame();
          recordCollectabilityCheckpoint(`lifecycle-cycle-${cycle + 1}`);
          sampleResources(`lifecycle-cycle-${cycle + 1}`);
        }
      }
    } finally {
      await frame();
      recordCollectabilityCheckpoint("final");
    }
    await new Promise((resolveTimers) => setTimeout(resolveTimers, 25));
    const resourcesAfter = copyResources();
    sampleResources("after-lifecycle-cycles");
    checkpoint("complete", actions - 1, actions, scheduledActions.at(-1)?.rngStateAfter ?? seed);
    await flushCheckpointReports();
    return {
      seed,
      durationMs: performance.now() - started,
      actions,
      recentActions,
      withoutLanguage: {
        keyToPaintP95Ms: percentile(plainLatencies, 0.95),
        maxDomNodes: plainMaxDomNodes,
        maxMaterializedVisualRows: plainMaxRows
      },
      keyToPaint: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: Math.max(0, ...latencies) },
      longTasks: { supported: longTaskSupported, count: longTaskDurations.length, maxMs: Math.max(0, ...longTaskDurations) },
      heap: { before: beforeHeap, after: afterHeap, growth: beforeHeap === null || afterHeap === null ? null : Math.max(0, afterHeap - beforeHeap) },
      maxDomNodes,
      maxMaterializedVisualRows,
      workerMessageBytes: resources.workerMessageBytes,
      latestRevision,
      languageRevision,
      burstLanguageWork,
      finalLanguageWork,
      cursorOnly,
      workerBurst,
      denseDiagnostics,
      selectionCount,
      controllerOwnedLanguageRecreations,
      lifecycleSignals: { blur: lifecycleBlur, focus: lifecycleFocus },
      maxResidualEditorRootsAfterDestroy,
      collectability: {
        weakRefSupported: typeof WeakRef !== "undefined",
        forcedGcSupported: typeof window.gc === "function",
        trackedDirectEditorRoots: directEditorRootRefs.length,
        trackedShadowRoots: shadowRootRefs.length,
        trackedControlRoots: controlRootRefs.length,
        retainedDirectEditorRoots: -1,
        retainedShadowRoots: -1,
        retainedControlRoots: -1,
        retainedAfterFinalGc,
        samples: collectabilitySamples
      },
      workloads: ["long-wrapped-lines", "split-panes", "resize-during-use", "many-selections", "dense-diagnostics", "custom-element-reconnect"],
      resourcesBefore,
      resourcesAfter,
      resourceSamples
    };
  }, {
    controllerUrl: moduleUrl("packages/editor-controller/src/index.ts"),
    domUrl: moduleUrl("packages/editor-view-dom/src/index.ts"),
    treeUrl: moduleUrl("packages/editor-tree-sitter/src/index.ts"),
    elementUrl: moduleUrl("packages/editor-element/src/index.ts"),
    parserWasmUrl: "/src/assets/web-tree-sitter.wasm",
    languageWasmUrl: "/src/assets/tree-sitter-typescript.wasm",
    seed,
    durationMs: durationSeconds * 1_000
  });

  // A DevTools remote-evaluation job keeps every object observed through
  // WeakRef alive until that job ends. Run collection only after the workload
  // evaluation has returned, then dereference every lifecycle cohort once.
  type PostJobCollectability = Pick<
    CollectabilitySummary,
    "retainedDirectEditorRoots" | "retainedShadowRoots" | "retainedControlRoots" | "retainedAfterFinalGc" | "samples"
  >;
  let collectability: PostJobCollectability | null = null;
  await page.waitForTimeout(0);
  for (let round = 0; round < 3; round += 1) {
    for (let pass = 0; pass < 8; pass += 1) {
      await page.evaluate(() => {
        if (typeof window.gc !== "function") throw new Error("Scheduled Chromium did not expose window.gc");
        window.gc();
      });
      await page.waitForTimeout(0);
    }
    collectability = await page.evaluate((): PostJobCollectability => {
      const references = window.__wxSoakCollectabilityRefs;
      if (!references) throw new Error("Lifecycle WeakRef cohorts were not preserved for post-job collection");
      const countRetained = (cohort: readonly WeakRef<object>[]) => cohort.reduce(
        (retained, reference) => retained + (reference.deref() ? 1 : 0),
        0
      );
      const retainedInCohort = (limit: number) =>
        countRetained(references.directEditorRoots.slice(0, limit)) +
        countRetained(references.shadowRoots.slice(0, limit));
      const samples = [5, 10, 15, 20, 25].map((limit): CollectabilitySample => ({
        label: `lifecycle-cycle-${limit}`,
        tracked: limit * 2,
        retainedAfterForcedGc: retainedInCohort(limit)
      }));
      const retainedDirectEditorRoots = countRetained(references.directEditorRoots);
      const retainedShadowRoots = countRetained(references.shadowRoots);
      const retainedControlRoots = countRetained(references.controlRoots);
      const retainedAfterFinalGc = retainedDirectEditorRoots + retainedShadowRoots;
      samples.push({ label: "final", tracked: 50, retainedAfterForcedGc: retainedAfterFinalGc });
      return {
        retainedDirectEditorRoots,
        retainedShadowRoots,
        retainedControlRoots,
        retainedAfterFinalGc,
        samples
      };
    });
    if (collectability.retainedAfterFinalGc === 0 && collectability.retainedControlRoots === 0) break;
    await page.waitForTimeout(0);
  }
  if (!collectability) throw new Error("Collectability convergence did not run");
  await page.evaluate(() => { delete window.__wxSoakCollectabilityRefs; });
  summary.collectability = { ...summary.collectability, ...collectability };

  const summaryPath = testInfo.outputPath("soak-summary.json");
  await writeFile(summaryPath, `${JSON.stringify({ budget, summary }, null, 2)}\n`);
  await testInfo.attach("soak-summary.json", { path: summaryPath, contentType: "application/json" });

  expect(summary.actions).toBe(Math.max(1, Math.floor((durationSeconds * 1_000) / 12)));
  expect(summary.latestRevision).toBeGreaterThan(0);
  for (const work of [summary.burstLanguageWork, summary.finalLanguageWork]) {
    expect(work.inFlight).toBe(0);
    expect(work.queued).toBe(0);
    expect(work.latestCompletedRevision).toBe(work.latestRequestedRevision);
    expect(work.maxQueueDepth).toBeLessThanOrEqual(2);
  }
  expect(summary.burstLanguageWork.coalesced).toBeGreaterThan(0);
  expect(summary.workerBurst.requests).toBe(summary.workerBurst.responses);
  expect(summary.workerBurst.requests).toBeLessThanOrEqual(budget.maxWorkerBurstRequests);
  expect(summary.workerBurst.maxPending).toBeLessThanOrEqual(2);
  expect(summary.workerBurst.messageBytes).toBeGreaterThanOrEqual(budget.minWorkerBurstMessageBytes);
  expect(summary.workerBurst.messageBytes).toBeLessThanOrEqual(budget.maxWorkerBurstMessageBytes);
  expect(summary.workerBurst.intentionallyReorderedRequestIds).toHaveLength(2);
  expect(summary.workerBurst.outOfOrder).toBe(true);
  expect(summary.workerBurst.staleResponsesDropped).toBeGreaterThan(0);
  expect(summary.workerBurst.acknowledgedRevision).toBe(summary.workerBurst.latestSentRevision);
  expect(summary.workerBurst.terminated).toBe(true);
  expect(summary.workerBurst.pendingAfterDestroy).toBe(0);
  expect(summary.workerBurst.latestSentRevision).toBe(summary.workerBurst.documentRevision);
  expect(summary.workerBurst.languageRevision).toBe(summary.workerBurst.documentRevision);
  expect(summary.burstLanguageWork.latestCompletedRevision).toBe(summary.workerBurst.documentRevision);
  expect(summary.cursorOnly.lines1000.samples).toBe(120);
  expect(summary.cursorOnly.lines20000.samples).toBe(120);
  expect(summary.cursorOnly.lines1000.keyToPaintP95Ms).toBeLessThanOrEqual(budget.keyToPaintP95Ms);
  expect(summary.cursorOnly.lines20000.keyToPaintP95Ms).toBeLessThanOrEqual(budget.keyToPaintP95Ms);
  expect(summary.cursorOnly.p95Ratio).toBeLessThanOrEqual(budget.cursorOnlyKeyToPaintMaxRatio);
  expect(summary.cursorOnly.p95DeltaMs).toBeLessThanOrEqual(budget.cursorOnlyKeyToPaintMaxDeltaMs);
  expect(summary.cursorOnly.lines1000.maxMaterializedVisualRows).toBeLessThanOrEqual(budget.maxMaterializedVisualRows);
  expect(summary.cursorOnly.lines20000.maxMaterializedVisualRows).toBeLessThanOrEqual(budget.maxMaterializedVisualRows);
  expect(summary.cursorOnly.lines20000.maxMaterializedVisualRows).toBeLessThanOrEqual(
    summary.cursorOnly.lines1000.maxMaterializedVisualRows + 1
  );
  expect(summary.denseDiagnostics).toBe(1_200);
  expect(summary.selectionCount).toBeGreaterThan(1_000);
  expect(summary.controllerOwnedLanguageRecreations).toBe(1);
  // These are synthetic lifecycle signals, not a browser visibility assertion;
  // real background-page coverage remains in the cross-browser DOM matrix.
  expect(summary.lifecycleSignals.focus).toBeGreaterThan(0);
  expect(summary.lifecycleSignals.blur).toBeGreaterThan(0);
  expect(summary.maxResidualEditorRootsAfterDestroy).toBe(0);
  expect(summary.collectability.weakRefSupported).toBe(true);
  expect(summary.collectability.forcedGcSupported).toBe(true);
  expect(summary.collectability.trackedDirectEditorRoots).toBe(25);
  expect(summary.collectability.trackedShadowRoots).toBe(25);
  expect(summary.collectability.trackedControlRoots).toBe(25);
  expect(summary.collectability.retainedControlRoots).toBe(0);
  expect(summary.collectability.retainedDirectEditorRoots).toBe(0);
  expect(summary.collectability.retainedShadowRoots).toBe(0);
  expect(summary.collectability.retainedAfterFinalGc).toBe(0);
  for (const sample of summary.collectability.samples) {
    expect(sample.retainedAfterForcedGc).toBe(0);
  }
  expect(summary.languageRevision).toBe(summary.finalLanguageWork.latestCompletedRevision);
  expect(summary.withoutLanguage.keyToPaintP95Ms).toBeLessThanOrEqual(budget.keyToPaintP95Ms);
  expect(summary.withoutLanguage.maxDomNodes).toBeLessThanOrEqual(budget.maxDomNodes);
  expect(summary.withoutLanguage.maxMaterializedVisualRows).toBeLessThanOrEqual(budget.maxMaterializedVisualRows);
  expect(summary.keyToPaint.p95).toBeLessThanOrEqual(budget.keyToPaintP95Ms);
  expect(summary.longTasks.supported).toBe(true);
  expect(summary.longTasks.maxMs).toBeLessThanOrEqual(budget.maxLongTaskMs);
  if (summary.heap.growth !== null) expect(summary.heap.growth).toBeLessThanOrEqual(budget.maxHeapGrowthBytes);
  expect(summary.maxDomNodes).toBeLessThanOrEqual(budget.maxDomNodes);
  expect(summary.maxMaterializedVisualRows).toBeLessThanOrEqual(budget.maxMaterializedVisualRows);
  expect(summary.resourcesAfter.workers - summary.resourcesBefore.workers).toBeLessThanOrEqual(budget.maxActiveWorkersAfterDestroy);
  expect(summary.resourcesAfter.observers - summary.resourcesBefore.observers).toBeLessThanOrEqual(budget.maxActiveObserversAfterDestroy);
  expect(summary.resourcesAfter.animationFrames - summary.resourcesBefore.animationFrames).toBeLessThanOrEqual(budget.maxActiveAnimationFramesAfterDestroy);
  expect(summary.resourcesAfter.listeners - summary.resourcesBefore.listeners).toBeLessThanOrEqual(budget.maxActiveListenersDeltaAfterDestroy);
  for (const sample of summary.resourceSamples) {
    expect(sample.workers - summary.resourcesBefore.workers).toBeLessThanOrEqual(budget.maxActiveWorkersAfterDestroy);
    expect(sample.observers - summary.resourcesBefore.observers).toBeLessThanOrEqual(budget.maxActiveObserversAfterDestroy);
    for (const observerType of ["resize", "mutation", "intersection"] as const) {
      expect(sample.observerTypes[observerType] - summary.resourcesBefore.observerTypes[observerType])
        .toBeLessThanOrEqual(budget.maxActiveObserversAfterDestroy);
      if (!sample.observerSupport[observerType]) expect(sample.observerTypes[observerType]).toBe(0);
    }
    expect(sample.animationFrames - summary.resourcesBefore.animationFrames).toBeLessThanOrEqual(budget.maxActiveAnimationFramesAfterDestroy);
    expect(sample.listeners - summary.resourcesBefore.listeners).toBeLessThanOrEqual(budget.maxActiveListenersDeltaAfterDestroy);
    expect(sample.residualLightDomRoots).toBe(0);
  }
  } catch (error) {
    try {
      const browserCheckpoint = await page.evaluate(() => window.__wxSoakCheckpoint ?? null);
      if (browserCheckpoint) latestCheckpoint = browserCheckpoint;
    } catch {
      // The page may have crashed or navigated; the exposed binding still keeps
      // the most recently reported checkpoint in the Playwright process.
    }
    const failurePath = testInfo.outputPath("soak-failure.json");
    await writeFile(failurePath, `${JSON.stringify({
      budget,
      checkpoint: latestCheckpoint,
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { name: "Error", message: String(error) }
    }, null, 2)}\n`);
    await testInfo.attach("soak-failure.json", { path: failurePath, contentType: "application/json" });
    throw error;
  }
});
