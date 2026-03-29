import type { HighlightSpan, SyntaxSelectionRange } from "@whx/editor-language";

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
  requestId: number;
  viewport: {
    fromLine: number;
    toLine: number;
  };
}

export interface WorkerExpandSelectionMessage {
  type: "expand-selection";
  revision: number;
  requestId: number;
  selection: SyntaxSelectionRange;
  activeOffset: number;
}

export interface WorkerShrinkSelectionMessage {
  type: "shrink-selection";
  revision: number;
  requestId: number;
  selection: SyntaxSelectionRange;
  activeOffset: number;
}

export interface WorkerReadyMessage {
  type: "ready";
}

export interface WorkerHighlightsMessage {
  type: "highlights";
  revision: number;
  requestId: number;
  spans: HighlightSpan[];
}

export interface WorkerSelectionMessage {
  type: "selection";
  revision: number;
  requestId: number;
  selection: SyntaxSelectionRange | null;
}

export interface WorkerErrorMessage {
  type: "error";
  message: string;
}

export type TreeSitterWorkerMessage =
  | WorkerInitMessage
  | WorkerOpenMessage
  | WorkerUpdateMessage
  | WorkerHighlightMessage
  | WorkerExpandSelectionMessage
  | WorkerShrinkSelectionMessage;

export type TreeSitterWorkerResponse =
  | WorkerReadyMessage
  | WorkerHighlightsMessage
  | WorkerSelectionMessage
  | WorkerErrorMessage;
