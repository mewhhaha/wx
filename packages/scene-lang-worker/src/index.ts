import type { TextChange, TextDocument } from "@mewhhaha/wx-core";
import type {
  CodeActionContext,
  CommentToggler,
  EditorCodeAction,
  EditorDiagnostic,
  EditorHover,
  EditorLanguageServices,
  EditorLineRange,
  Formatter,
  HighlightSpan,
  Highlighter,
  HoverSource
} from "@mewhhaha/wx-language";

import { createWgslCommentToggler } from "./commentToggler";

type SceneWorkerResponse =
  | { type: "ready" }
  | { type: "diagnostics"; requestId: number; diagnostics: EditorDiagnostic[] }
  | { type: "hover"; requestId: number; hover: EditorHover | null }
  | { type: "format"; requestId: number; text: string }
  | { type: "code-actions"; requestId: number; actions: EditorCodeAction[] }
  | { type: "highlights"; requestId: number; spans: HighlightSpan[] };

interface SceneWorkerBaseRequest {
  revision: number;
}

type SceneWorkerRequest =
  | { type: "init"; wasmUrl: string }
  | ({ type: "open"; text: string } & SceneWorkerBaseRequest)
  | ({ type: "update"; text: string; changes: readonly TextChange[] } & SceneWorkerBaseRequest)
  | ({ type: "diagnostics"; requestId: number } & SceneWorkerBaseRequest)
  | ({ type: "hover"; requestId: number; offset: number } & SceneWorkerBaseRequest)
  | ({ type: "format"; requestId: number; selection: { from: number; to: number } } & SceneWorkerBaseRequest)
  | ({ type: "code-actions"; requestId: number; selection: { from: number; to: number } } & SceneWorkerBaseRequest)
  | ({ type: "highlights"; requestId: number; lines: EditorLineRange } & SceneWorkerBaseRequest);

type SceneWorkerRpcRequest = Extract<SceneWorkerRequest, { requestId: number }>;
type SceneWorkerRpcRequestInput = SceneWorkerRpcRequest extends infer Request
  ? Request extends { requestId: number }
    ? Omit<Request, "requestId">
    : never
  : never;

export interface SceneLangLanguageServicesOptions {
  wasmUrl: string;
  createWorker?: () => Worker;
}

interface Deferred<T> {
  resolve: (value: T) => void;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL("./sceneLang.worker.js", import.meta.url), { type: "module" });
}

export class SceneLangWorkerServices implements Highlighter, HoverSource, Formatter {
  private readonly worker: Worker;
  private readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private readonly pending = new Map<number, Deferred<unknown>>();
  private nextRequestId = 1;

  constructor(options: SceneLangLanguageServicesOptions) {
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
    this.worker = (options.createWorker ?? defaultWorkerFactory)();
    this.worker.addEventListener("message", (event: MessageEvent<SceneWorkerResponse>) => {
      const payload = event.data;

      if (payload.type === "ready") {
        this.resolveReady();
        return;
      }

      const deferred = this.pending.get(payload.requestId);

      if (!deferred) {
        return;
      }

      if (payload.type === "diagnostics") {
        deferred.resolve(payload.diagnostics);
      } else if (payload.type === "hover") {
        deferred.resolve(payload.hover);
      } else if (payload.type === "format") {
        deferred.resolve(payload.text);
      } else if (payload.type === "code-actions") {
        deferred.resolve(payload.actions);
      } else if (payload.type === "highlights") {
        deferred.resolve(payload.spans);
      }

      this.pending.delete(payload.requestId);
    });

    this.worker.postMessage({
      type: "init",
      wasmUrl: options.wasmUrl
    } satisfies SceneWorkerRequest);
  }

  async open(document: { revision: number; doc: TextDocument }): Promise<void> {
    await this.ready;
    this.worker.postMessage({
      type: "open",
      revision: document.revision,
      text: document.doc.text
    } satisfies SceneWorkerRequest);
  }

  async update(document: { revision: number; doc: TextDocument }, changes: readonly TextChange[]): Promise<void> {
    await this.ready;
    this.worker.postMessage({
      type: "update",
      revision: document.revision,
      text: document.doc.text,
      changes
    } satisfies SceneWorkerRequest);
  }

  async getHighlights(lines: EditorLineRange, revision: number): Promise<HighlightSpan[]> {
    return await this.request<HighlightSpan[]>({ type: "highlights", revision, lines });
  }

  async diagnostics(document: { revision: number }): Promise<readonly EditorDiagnostic[]> {
    return await this.request<EditorDiagnostic[]>({ type: "diagnostics", revision: document.revision });
  }

  async hover(document: { revision: number }, offset: number): Promise<EditorHover | null> {
    return await this.request<EditorHover | null>({ type: "hover", revision: document.revision, offset });
  }

  async format(context: {
    document: { revision: number; doc: TextDocument };
    selection: { from: number; to: number };
  }): Promise<readonly TextChange[]> {
    const nextText = await this.request<string>({
      type: "format",
      revision: context.document.revision,
      selection: context.selection
    });

    if (nextText === context.document.doc.text) {
      return [];
    }

    return [
      {
        from: 0,
        to: context.document.doc.length,
        insert: nextText
      }
    ];
  }

  async getCodeActions(context: CodeActionContext): Promise<readonly EditorCodeAction[]> {
    return await this.request<EditorCodeAction[]>({
      type: "code-actions",
      revision: context.document.revision,
      selection: context.selection
    });
  }

  destroy(): void {
    this.pending.clear();
    this.worker.terminate();
  }

  private async request<T>(message: SceneWorkerRpcRequestInput): Promise<T> {
    await this.ready;
    const requestId = this.nextRequestId++;

    return await new Promise<T>((resolve) => {
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void });
      this.worker.postMessage({
        requestId,
        ...message
      } as SceneWorkerRpcRequest);
    });
  }
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
    comments
  };
}
