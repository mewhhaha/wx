import { describe, expect, it } from "vitest";

import { createTextDocument } from "@wx/editor-core";
import type { HighlightSpan } from "@wx/editor-language";

import { createTreeSitterLanguageServices, type TreeSitterWorkerHost } from "./index";
import { typescriptHighlightQuery } from "./highlightQuery";
import { createNodeTreeSitterLanguageServices } from "./node";

class FakeWorkerHost implements TreeSitterWorkerHost {
  readonly messages: unknown[] = [];
  terminated = false;
  private listener: ((event: MessageEvent) => void) | null = null;

  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listener = listener;
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  emit(data: unknown): void {
    this.listener?.({ data } as MessageEvent);
  }

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

    worker.emit({ type: "ready" });
    await services.highlighter?.open({
      revision: 1,
      doc: createTextDocument("const value = 1;")
    });

    const highlightsPromise = services.highlighter!.getHighlights({ fromLine: 0, toLine: 0 }, 1);
    await Promise.resolve();
    const highlightRequest = worker.messages.at(-1) as { type: string; requestId: number };
    const spans: HighlightSpan[] = [{ from: 0, to: 5, role: "keyword" }];
    worker.emit({
      type: "highlights",
      revision: 1,
      requestId: highlightRequest.requestId,
      spans
    });

    expect(worker.messages[0]).toEqual({
      type: "init",
      parserWasmUrl: "/parser.wasm",
      parserRuntimeUrl: "/runtime.js",
      languageWasmUrl: "/language.wasm",
      query: "(identifier) @type"
    });
    expect(worker.messages[1]).toMatchObject({ type: "open", revision: 1, text: "const value = 1;" });
    expect(await highlightsPromise).toEqual(spans);

    services.highlighter?.destroy?.();
    expect(worker.terminated).toBe(true);
  });

  it("exports a Node host helper without changing the browser helper", () => {
    expect(createTreeSitterLanguageServices).toBeTypeOf("function");
    expect(createNodeTreeSitterLanguageServices).toBeTypeOf("function");
  });
});
