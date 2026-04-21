import type { TextChange } from "@mewhhaha/wx-core";
import type { EditorLineRange, HighlightSpan, SyntaxSelectionRange } from "@mewhhaha/wx-language";

export interface WorkerInitMessage {
  type: "init";
  parserWasmUrl: string;
  parserRuntimeUrl?: string;
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
  changes: readonly TextChange[];
}

export interface WorkerHighlightMessage {
  type: "highlight";
  revision: number;
  requestId: number;
  lines: EditorLineRange;
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
