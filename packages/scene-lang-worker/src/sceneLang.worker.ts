import { createSceneLangWasm, type SceneLangWasm } from "@wx/scene-lang-wasm";

import type { TextChange } from "@wx/editor-core";

type SceneWorkerRequest =
  | { type: "init"; wasmUrl: string }
  | { type: "open"; revision: number; text: string }
  | { type: "update"; revision: number; text: string; changes: readonly TextChange[] }
  | { type: "diagnostics"; requestId: number; revision: number }
  | { type: "hover"; requestId: number; revision: number; offset: number }
  | { type: "format"; requestId: number; revision: number; selection: { from: number; to: number } }
  | { type: "code-actions"; requestId: number; revision: number; selection: { from: number; to: number } }
  | { type: "highlights"; requestId: number; revision: number; lines: { fromLine: number; toLine: number } };

let runtimePromise: Promise<SceneLangWasm> | null = null;
let currentRevision = 0;
let currentText = "";

function reply(message: unknown): void {
  self.postMessage(message);
}

function ensureRuntime(): Promise<SceneLangWasm> {
  if (!runtimePromise) {
    throw new Error("Scene language worker was used before init.");
  }

  return runtimePromise;
}

self.addEventListener("message", async (event: MessageEvent<SceneWorkerRequest>) => {
  const message = event.data;

  if (message.type === "init") {
    runtimePromise = createSceneLangWasm({ wasmUrl: message.wasmUrl });
    await runtimePromise;
    reply({ type: "ready" });
    return;
  }

  if (message.type === "open" || message.type === "update") {
    currentRevision = message.revision;
    currentText = message.text;
    return;
  }

  const runtime = await ensureRuntime();

  if (message.revision !== currentRevision) {
    if (message.type === "diagnostics") {
      reply({ type: "diagnostics", requestId: message.requestId, diagnostics: [] });
    } else if (message.type === "hover") {
      reply({ type: "hover", requestId: message.requestId, hover: null });
    } else if (message.type === "format") {
      reply({ type: "format", requestId: message.requestId, text: currentText });
    } else if (message.type === "code-actions") {
      reply({ type: "code-actions", requestId: message.requestId, actions: [] });
    } else if (message.type === "highlights") {
      reply({ type: "highlights", requestId: message.requestId, spans: [] });
    }
    return;
  }

  if (message.type === "diagnostics") {
    reply({
      type: "diagnostics",
      requestId: message.requestId,
      diagnostics: runtime.diagnostics(currentText)
    });
    return;
  }

  if (message.type === "hover") {
    reply({
      type: "hover",
      requestId: message.requestId,
      hover: runtime.hover(currentText, message.offset)
    });
    return;
  }

  if (message.type === "format") {
    reply({
      type: "format",
      requestId: message.requestId,
      text: runtime.format(currentText)
    });
    return;
  }

  if (message.type === "code-actions") {
    reply({
      type: "code-actions",
      requestId: message.requestId,
      actions: runtime.codeActions(currentText, message.selection)
    });
    return;
  }

  reply({
    type: "highlights",
    requestId: message.requestId,
    spans: runtime.highlights(currentText, message.lines)
  });
});
