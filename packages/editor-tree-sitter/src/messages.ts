import type { TextChange } from "@mewhhaha/wx-core";
import type { EditorLineRange, HighlightSpan, IndentationResult, SyntaxSelectionRange } from "@mewhhaha/wx-language";

export const TREE_SITTER_WORKER_PROTOCOL_VERSION = 3 as const;

interface Versioned { version: typeof TREE_SITTER_WORKER_PROTOCOL_VERSION; }
interface Generated { generation: number; }
interface Requested extends Generated { requestId: number; }

export interface WorkerTextChangeBatch {
  /** Revision after this batch has been applied. */
  revision: number;
  changes: readonly TextChange[];
}

export interface WorkerInitMessage extends Versioned {
  type: "init";
  parserWasmUrl: string;
  parserRuntimeUrl?: string;
  languageWasmUrl: string;
  query: string;
  indentQuery?: string;
}

export interface WorkerOpenMessage extends Versioned, Requested {
  type: "open";
  revision: number;
  text: string;
}

/** Normal document updates contain only sequential edit-sized batches. */
export interface WorkerUpdateMessage extends Versioned, Requested {
  type: "update";
  baseRevision: number;
  revision: number;
  documentLength: number;
  batches: readonly WorkerTextChangeBatch[];
}

export interface WorkerHighlightMessage extends Versioned, Requested {
  type: "highlight";
  revision: number;
  lines: EditorLineRange;
}

export interface WorkerExpandSelectionMessage extends Versioned, Requested {
  type: "expand-selection";
  revision: number;
  selection: SyntaxSelectionRange;
  activeOffset: number;
}

export interface WorkerShrinkSelectionMessage extends Versioned, Requested {
  type: "shrink-selection";
  revision: number;
  selection: SyntaxSelectionRange;
  activeOffset: number;
}
export interface WorkerIndentationMessage extends Versioned, Requested {
  type: "indentation";
  revision: number;
  offset: number;
  action: "enter" | "open-below" | "open-above";
}

export interface WorkerCancelMessage extends Versioned, Requested {
  type: "cancel";
}

export interface WorkerReadyMessage extends Versioned { type: "ready"; }
export interface WorkerSyncedMessage extends Versioned, Requested {
  type: "synced";
  revision: number;
  documentLength: number;
  mode: "open" | "incremental";
}
export interface WorkerSyncRequiredMessage extends Versioned, Requested {
  type: "sync-required";
  revision: number;
  reason: "base-revision" | "invalid-edit" | "length-mismatch";
}
export interface WorkerHighlightsMessage extends Versioned, Requested {
  type: "highlights";
  revision: number;
  spans: HighlightSpan[];
}
export interface WorkerSelectionMessage extends Versioned, Requested {
  type: "selection";
  revision: number;
  selection: SyntaxSelectionRange | null;
}
export interface WorkerIndentationResultMessage extends Versioned, Requested {
  type: "indentation-result";
  result: IndentationResult;
}
export interface WorkerErrorMessage extends Versioned { type: "error"; message: string; }

export type TreeSitterWorkerMessage =
  | WorkerInitMessage
  | WorkerOpenMessage
  | WorkerUpdateMessage
  | WorkerHighlightMessage
  | WorkerExpandSelectionMessage
  | WorkerShrinkSelectionMessage
  | WorkerIndentationMessage
  | WorkerCancelMessage;

export type TreeSitterWorkerResponse =
  | WorkerReadyMessage
  | WorkerSyncedMessage
  | WorkerSyncRequiredMessage
  | WorkerHighlightsMessage
  | WorkerSelectionMessage
  | WorkerIndentationResultMessage
  | WorkerErrorMessage;

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const selection = (value: unknown): boolean => record(value) && integer(value.from) && integer(value.to);
const textChange = (value: unknown): boolean => record(value) && integer(value.from) && integer(value.to) && value.to >= value.from && typeof value.insert === "string";
const batch = (value: unknown): boolean => record(value) && integer(value.revision) && Array.isArray(value.changes) && value.changes.every(textChange);
const requested = (value: Record<string, unknown>): boolean => integer(value.requestId) && integer(value.generation);
const highlightRoles = new Set(["text", "comment", "function", "gutter", "keyword", "number", "operator", "punctuation", "selection", "string", "type", "cursor"]);
const highlight = (value: unknown): boolean => record(value) && integer(value.from) && integer(value.to) && typeof value.role === "string" && highlightRoles.has(value.role);

/** Validate untrusted worker payloads before they cross the protocol boundary. */
export function isTreeSitterWorkerMessage(value: unknown): value is TreeSitterWorkerMessage {
  if (!record(value) || value.version !== TREE_SITTER_WORKER_PROTOCOL_VERSION || typeof value.type !== "string") return false;
  if (value.type === "init") return typeof value.parserWasmUrl === "string" && (value.parserRuntimeUrl === undefined || typeof value.parserRuntimeUrl === "string") && typeof value.languageWasmUrl === "string" && typeof value.query === "string" && (value.indentQuery === undefined || typeof value.indentQuery === "string");
  if (!requested(value)) return false;
  switch (value.type) {
    case "open": return integer(value.revision) && typeof value.text === "string";
    case "update": return integer(value.baseRevision) && integer(value.revision) && integer(value.documentLength) && Array.isArray(value.batches) && value.batches.length > 0 && value.batches.every(batch);
    case "highlight": return integer(value.revision) && record(value.lines) && integer(value.lines.fromLine) && integer(value.lines.toLine);
    case "expand-selection": case "shrink-selection": return integer(value.revision) && selection(value.selection) && integer(value.activeOffset);
    case "indentation": return integer(value.revision) && integer(value.offset) && (value.action === "enter" || value.action === "open-below" || value.action === "open-above");
    case "cancel": return true;
    default: return false;
  }
}

export function isTreeSitterWorkerResponse(value: unknown): value is TreeSitterWorkerResponse {
  if (!record(value) || value.version !== TREE_SITTER_WORKER_PROTOCOL_VERSION || typeof value.type !== "string") return false;
  if (value.type === "ready") return true;
  if (value.type === "error") return typeof value.message === "string";
  if (!requested(value)) return false;
  switch (value.type) {
    case "synced": return integer(value.revision) && integer(value.documentLength) && (value.mode === "open" || value.mode === "incremental");
    case "sync-required": return integer(value.revision) && (value.reason === "base-revision" || value.reason === "invalid-edit" || value.reason === "length-mismatch");
    case "highlights": return integer(value.revision) && Array.isArray(value.spans) && value.spans.every(highlight);
    case "selection": return integer(value.revision) && (value.selection === null || selection(value.selection));
    case "indentation-result": return record(value.result) && integer(value.result.revision) && (value.result.status === "ok" || value.result.status === "stale" || value.result.status === "incomplete" || value.result.status === "error") && (value.result.indent === undefined || integer(value.result.indent)) && (value.result.outdent === undefined || integer(value.result.outdent)) && (value.result.alignColumn === undefined || integer(value.result.alignColumn));
    default: return false;
  }
}

const encoder = new TextEncoder();

/** Cheap structured-clone byte estimate that never serializes the full document. */
export function estimateTreeSitterMessageBytes(value: unknown): number {
  const stack: unknown[] = [value];
  let bytes = 0;

  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === "string") bytes += encoder.encode(next).length;
    else if (typeof next === "number") bytes += 8;
    else if (typeof next === "boolean") bytes += 1;
    else if (Array.isArray(next)) stack.push(...next);
    else if (record(next)) {
      for (const [key, entry] of Object.entries(next)) {
        bytes += encoder.encode(key).length;
        stack.push(entry);
      }
    }
  }

  return bytes;
}

export function treeSitterCopiedTextBytes(value: unknown): number {
  if (!record(value) || typeof value.type !== "string") return 0;
  if (value.type === "open" && typeof value.text === "string") return encoder.encode(value.text).length;
  if (value.type === "update" && Array.isArray(value.batches)) {
    let bytes = 0;
    for (const entry of value.batches) {
      if (!record(entry) || !Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        if (record(change) && typeof change.insert === "string") bytes += encoder.encode(change.insert).length;
      }
    }
    return bytes;
  }
  return 0;
}
