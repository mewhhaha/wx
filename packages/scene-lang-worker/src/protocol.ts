import type { TextChange } from "@mewhhaha/wx-core";
import type { EditorCodeAction, EditorDiagnostic, EditorHover, EditorLineRange, HighlightSpan } from "@mewhhaha/wx-language";

export const SCENE_WORKER_PROTOCOL_VERSION = 1 as const;

interface VersionedMessage { version: typeof SCENE_WORKER_PROTOCOL_VERSION; }
interface RevisionRequest extends VersionedMessage { revision: number; }
interface RpcRequest extends RevisionRequest { requestId: number; generation: number; }
export interface SceneWasmBoundaryDelta {
  /** Natural high-level operations crossing from the worker into the Wasm wrapper. */
  operations: number;
  /** UTF-8 source bytes encoded and copied into Wasm linear memory. */
  sourceBytesCopied: number;
}
interface RpcResponse extends VersionedMessage { requestId: number; generation: number; boundary?: SceneWasmBoundaryDelta; }

export type SceneWorkerRequest =
  | (VersionedMessage & { type: "init"; wasmUrl: string })
  | (RevisionRequest & { type: "open"; text: string })
  | (RevisionRequest & { type: "update"; text: string; changes: readonly TextChange[] })
  | (RpcRequest & { type: "diagnostics" })
  | (RpcRequest & { type: "hover"; offset: number })
  | (RpcRequest & { type: "format"; selection: { from: number; to: number } })
  | (RpcRequest & { type: "code-actions"; selection: { from: number; to: number } })
  | (RpcRequest & { type: "highlights"; lines: EditorLineRange });

export type SceneWorkerRpcRequest = Extract<SceneWorkerRequest, { requestId: number }>;
export type SceneWorkerRpcRequestInput = SceneWorkerRpcRequest extends infer Request
  ? Request extends SceneWorkerRpcRequest
    ? Omit<Request, "requestId" | "generation" | "version">
    : never
  : never;

export type SceneWorkerResponse =
  | (VersionedMessage & { type: "ready" })
  | (VersionedMessage & { type: "error"; message: string; phase: "init" | "runtime" | "protocol" })
  | (RpcResponse & { type: "diagnostics"; diagnostics: EditorDiagnostic[] })
  | (RpcResponse & { type: "hover"; hover: EditorHover | null })
  | (RpcResponse & { type: "format"; text: string })
  | (RpcResponse & { type: "code-actions"; actions: EditorCodeAction[] })
  | (RpcResponse & { type: "highlights"; spans: HighlightSpan[] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function hasRpcRequestFields(value: Record<string, unknown>): boolean {
  return isInteger(value.revision) && isInteger(value.requestId) && isInteger(value.generation);
}

function hasRpcResponseFields(value: Record<string, unknown>): boolean {
  return isInteger(value.requestId) && isInteger(value.generation) && (
    value.boundary === undefined || (
      isRecord(value.boundary) &&
      isInteger(value.boundary.operations) &&
      isInteger(value.boundary.sourceBytesCopied)
    )
  );
}

export function isSceneWorkerRequest(value: unknown): value is SceneWorkerRequest {
  if (!isRecord(value) || value.version !== SCENE_WORKER_PROTOCOL_VERSION || typeof value.type !== "string") return false;
  if (value.type === "init") return typeof value.wasmUrl === "string";
  if (value.type === "open") return isInteger(value.revision) && typeof value.text === "string";
  if (value.type === "update") return isInteger(value.revision) && typeof value.text === "string" && Array.isArray(value.changes);
  if (!hasRpcRequestFields(value)) return false;
  if (value.type === "diagnostics") return true;
  if (value.type === "hover") return isInteger(value.offset);
  if (value.type === "format" || value.type === "code-actions") {
    return isRecord(value.selection) && isInteger(value.selection.from) && isInteger(value.selection.to);
  }
  return value.type === "highlights" && isRecord(value.lines) && isInteger(value.lines.fromLine) && isInteger(value.lines.toLine);
}

export function isSceneWorkerResponse(value: unknown): value is SceneWorkerResponse {
  if (!isRecord(value) || value.version !== SCENE_WORKER_PROTOCOL_VERSION || typeof value.type !== "string") return false;
  if (value.type === "ready") return true;
  if (value.type === "error") {
    return typeof value.message === "string" && ["init", "runtime", "protocol"].includes(String(value.phase));
  }
  if (!hasRpcResponseFields(value)) return false;
  if (value.type === "diagnostics") return Array.isArray(value.diagnostics);
  if (value.type === "hover") return value.hover === null || isRecord(value.hover);
  if (value.type === "format") return typeof value.text === "string";
  if (value.type === "code-actions") return Array.isArray(value.actions);
  return value.type === "highlights" && Array.isArray(value.spans);
}
