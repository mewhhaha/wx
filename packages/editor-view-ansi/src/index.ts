import { createNodeHostServices } from "./node-host";
import { createAnsiEditorTerminal as createPortableAnsiEditorTerminal } from "./terminal";
import type { AnsiEditorTerminal, CreateAnsiEditorTerminalOptions } from "./terminal-types";

export type { EditorController } from "@mewhhaha/wx-controller";
export type {
  AnsiEditorMirror,
  AnsiEditorTerminal,
  AnsiFrameCursor,
  AnsiFramePatch,
  AnsiFramePatchKind,
  AnsiFrameSnapshot,
  AnsiTerminalInput,
  AnsiTerminalMetrics,
  AnsiTerminalOutput,
  CreateAnsiEditorMirrorOptions,
  CreateAnsiEditorTerminalOptions,
  RenderEditorAnsiFrameInput
} from "./terminal-types";

export { createAnsiFramePatch, serializeAnsiFrameSnapshot } from "./damage";
export { createEditorAnsiFrameSnapshot, createEditorAnsiWorkspaceFrameSnapshot, renderEditorAnsiFrame } from "./frame";
export { createNodeHostServices, createNodeTerminalWrite } from "./node-host";
export { createAnsiEditorMirror, parseAnsiInput } from "./terminal";
export { runAnsiMirrorDemo } from "./demo-runtime";

/** Node package entrypoint retaining the historical default filesystem host. */
export function createAnsiEditorTerminal(options: CreateAnsiEditorTerminalOptions): AnsiEditorTerminal {
  if (options.host !== undefined || options.controller !== undefined) {
    return createPortableAnsiEditorTerminal(options);
  }
  return createPortableAnsiEditorTerminal({ ...options, host: createNodeHostServices() });
}
