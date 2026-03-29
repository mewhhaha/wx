import type { TextChange, TextDocument } from "@whx/editor-core";
import type { EditorViewport, HighlightSpan, LanguageProvider } from "@whx/editor-language";

import type { TreeSitterWorkerResponse } from "./messages";
export { typescriptHighlightQuery } from "./highlightQuery";

export interface TreeSitterProviderOptions {
  parserWasmUrl: string;
  languageWasmUrl: string;
  query: string;
  createWorker?: () => Worker;
}

interface DeferredHighlights {
  revision: number;
  resolve: (spans: HighlightSpan[]) => void;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL("./treeSitter.worker.js", import.meta.url), { type: "module" });
}

export class TreeSitterLanguageProvider implements LanguageProvider {
  private readonly worker: Worker;
  private readonly pending = new Map<number, DeferredHighlights>();
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;

  constructor(options: TreeSitterProviderOptions) {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
    this.worker = (options.createWorker ?? defaultWorkerFactory)();
    this.worker.addEventListener("message", (event: MessageEvent<TreeSitterWorkerResponse>) => {
      const payload = event.data;

      if (payload.type === "ready") {
        this.resolveReady();
        return;
      }

      if (payload.type === "highlights") {
        const pending = this.pending.get(payload.revision);

        if (pending) {
          pending.resolve(payload.spans);
          this.pending.delete(payload.revision);
        }
      }
    });

    this.worker.postMessage({
      type: "init",
      parserWasmUrl: options.parserWasmUrl,
      languageWasmUrl: options.languageWasmUrl,
      query: options.query
    });
  }

  async open(document: { revision: number; doc: TextDocument }): Promise<void> {
    await this.ready;
    this.worker.postMessage({
      type: "open",
      revision: document.revision,
      text: document.doc.text
    });
  }

  async update(document: { revision: number; doc: TextDocument }, _changes: readonly TextChange[]): Promise<void> {
    await this.ready;
    this.worker.postMessage({
      type: "update",
      revision: document.revision,
      text: document.doc.text
    });
  }

  async getHighlightRanges(viewport: EditorViewport, revision: number): Promise<HighlightSpan[]> {
    await this.ready;
    return await new Promise<HighlightSpan[]>((resolve) => {
      this.pending.set(revision, { revision, resolve });
      this.worker.postMessage({
        type: "highlight",
        revision,
        viewport
      });
    });
  }

  destroy(): void {
    this.pending.clear();
    this.worker.terminate();
  }
}

export function createTreeSitterLanguageProvider(options: TreeSitterProviderOptions): LanguageProvider {
  return new TreeSitterLanguageProvider(options);
}
