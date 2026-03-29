import type { HighlightSpan } from "@whx/editor-language";

export interface WorkerInitMessage {
  type: "init";
  parserWasmUrl: string;
  languageWasmUrl: string;
  query: string;
}

export interface WorkerOpenMessage {
  type: "open";
  revision: number;
  text: string;
}

export interface WorkerUpdateMessage {
  type: "update";
  revision: number;
  text: string;
}

export interface WorkerHighlightMessage {
  type: "highlight";
  revision: number;
  viewport: {
    fromLine: number;
    toLine: number;
  };
}

export interface WorkerReadyMessage {
  type: "ready";
}

export interface WorkerHighlightsMessage {
  type: "highlights";
  revision: number;
  spans: HighlightSpan[];
}

export interface WorkerErrorMessage {
  type: "error";
  message: string;
}

export type TreeSitterWorkerMessage =
  | WorkerInitMessage
  | WorkerOpenMessage
  | WorkerUpdateMessage
  | WorkerHighlightMessage;

export type TreeSitterWorkerResponse = WorkerReadyMessage | WorkerHighlightsMessage | WorkerErrorMessage;

