import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createTextDocument, planIndentation } from "@mewhhaha/wx-core";

import {
  createTreeSitterLanguageServices,
  materializeIndentationFixture,
  typescriptIndentationFixtures,
  typescriptIndentQuery,
  type TreeSitterWorkerHost
} from "./index";
import { typescriptHighlightQuery } from "./highlightQuery";

type WorkerListener = (event: MessageEvent<unknown>) => void;

class BrowserWorkerHarness implements TreeSitterWorkerHost {
  private readonly listeners = new Set<WorkerListener>();
  private workerListener: ((event: MessageEvent<unknown>) => void) | null = null;

  async load(): Promise<void> {
    const scope = {
      addEventListener: (_type: "message", listener: WorkerListener) => { this.workerListener = listener; },
      postMessage: (message: unknown) => {
        for (const listener of this.listeners) listener({ data: message } as MessageEvent);
      }
    };
    (globalThis as typeof globalThis & { self: typeof scope }).self = scope as typeof globalThis.self;
    await import("./treeSitter.worker");
  }

  addEventListener(type: "message" | "error" | "messageerror", listener: WorkerListener | ((event: Event) => void)): void {
    if (type === "message") this.listeners.add(listener as WorkerListener);
  }

  removeEventListener(type: "message" | "error" | "messageerror", listener: WorkerListener | ((event: Event) => void)): void {
    if (type === "message") this.listeners.delete(listener as WorkerListener);
  }

  postMessage(message: unknown): void {
    if (!this.workerListener) throw new Error("browser worker module is not loaded");
    void this.workerListener({ data: message } as MessageEvent);
  }

  terminate(): void {
    this.listeners.clear();
    this.workerListener = null;
  }
}

const root = new URL("../../../", import.meta.url);
const parserWasmUrl = new URL("node_modules/.pnpm/web-tree-sitter@0.26.8/node_modules/web-tree-sitter/web-tree-sitter.wasm", root);
const languageWasmUrl = new URL("node_modules/.pnpm/tree-sitter-typescript@0.23.2/node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm", root);

describe("browser worker indentation conformance", () => {
  it("matches shared TypeScript fixture results, text, and cursor offsets", async () => {
    const worker = new BrowserWorkerHarness();
    await worker.load();
    const services = createTreeSitterLanguageServices({
      parserWasmUrl: fileURLToPath(parserWasmUrl),
      languageWasmUrl: fileURLToPath(languageWasmUrl),
      query: typescriptHighlightQuery,
      indentQuery: typescriptIndentQuery,
      createWorker: () => worker,
      owner: "controller"
    });

    try {
      await services.lifecycle!.whenReady!();
      for (const fixture of typescriptIndentationFixtures) {
        const { text, offset } = materializeIndentationFixture(fixture);
        const doc = createTextDocument(text);
        const document = { revision: 1, doc };
        await services.highlighter!.open!(document);
        const result = await services.indentation!.getIndentation({ document, offset, action: fixture.action });
        expect(result, fixture.name).toEqual(fixture.expected.result);
        const plan = planIndentation(doc, [{ from: offset }], fixture.action, undefined, [result]);
        expect(doc.applyChanges(plan.changes).text, fixture.name).toBe(fixture.expected.text);
        expect(plan.insertionOffsets[0], fixture.name).toBe(fixture.expected.cursor);
      }
    } finally {
      services.lifecycle!.destroy!();
    }
  });
});
