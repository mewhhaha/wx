import type { TextChange, TextDocument } from "@whx/editor-core";
import type { EditorViewport, HighlightSpan, LanguageProvider, SyntaxSelectionRange } from "@whx/editor-language";

import type { TreeSitterWorkerResponse } from "./messages";
export { typescriptHighlightQuery } from "./highlightQuery";

export interface TreeSitterProviderOptions {
  parserWasmUrl: string;
  languageWasmUrl: string;
  query: string;
  createWorker?: () => Worker;
}

interface DeferredHighlights {
  resolve: (spans: HighlightSpan[]) => void;
}

interface DeferredSelection {
  resolve: (selection: SyntaxSelectionRange | null) => void;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL("./treeSitter.worker.js", import.meta.url), { type: "module" });
}

export class TreeSitterLanguageProvider implements LanguageProvider {
  private readonly worker: Worker;
  private readonly pendingHighlights = new Map<number, DeferredHighlights>();
  private readonly pendingSelections = new Map<number, DeferredSelection>();
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private nextRequestId = 1;

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
        const pending = this.pendingHighlights.get(payload.requestId);

        if (pending) {
          pending.resolve(payload.spans);
          this.pendingHighlights.delete(payload.requestId);
        }
        return;
      }

      if (payload.type === "selection") {
        const pending = this.pendingSelections.get(payload.requestId);

        if (pending) {
          pending.resolve(payload.selection);
          this.pendingSelections.delete(payload.requestId);
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
    const requestId = this.nextRequestId++;
    return await new Promise<HighlightSpan[]>((resolve) => {
      this.pendingHighlights.set(requestId, { resolve });
      this.worker.postMessage({
        type: "highlight",
        revision,
        requestId,
        viewport
      });
    });
  }

  async expandSelection(
    selection: SyntaxSelectionRange,
    activeOffset: number,
    revision: number
  ): Promise<SyntaxSelectionRange | null> {
    return await this.requestSelection("expand-selection", selection, activeOffset, revision);
  }

  async shrinkSelection(
    selection: SyntaxSelectionRange,
    activeOffset: number,
    revision: number
  ): Promise<SyntaxSelectionRange | null> {
    return await this.requestSelection("shrink-selection", selection, activeOffset, revision);
  }

  private async requestSelection(
    type: "expand-selection" | "shrink-selection",
    selection: SyntaxSelectionRange,
    activeOffset: number,
    revision: number
  ): Promise<SyntaxSelectionRange | null> {
    await this.ready;
    const requestId = this.nextRequestId++;

    return await new Promise<SyntaxSelectionRange | null>((resolve) => {
      this.pendingSelections.set(requestId, { resolve });
      this.worker.postMessage({
        type,
        revision,
        requestId,
        selection,
        activeOffset
      });
    });
  }

  destroy(): void {
    this.pendingHighlights.clear();
    this.pendingSelections.clear();
    this.worker.terminate();
  }
}

export function createTreeSitterLanguageProvider(options: TreeSitterProviderOptions): LanguageProvider {
  return new TreeSitterLanguageProvider(options);
}
