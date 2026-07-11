import { createSceneLangWasm, type SceneLangWasm } from "@wx/scene-lang-wasm";
import { isSceneWorkerRequest, SCENE_WORKER_PROTOCOL_VERSION, type SceneWorkerRequest, type SceneWorkerResponse } from "./protocol";

let runtimePromise: Promise<SceneLangWasm> | null = null;
let currentRevision = 0;
let currentText = "";
const encoder = new TextEncoder();
function reply(message: SceneWorkerResponse): void { self.postMessage(message); }
function error(message: string, phase: "init" | "runtime" | "protocol"): void { reply({ type: "error", version: SCENE_WORKER_PROTOCOL_VERSION, message, phase }); }
function fallback(message: Exclude<SceneWorkerRequest, { type: "init" | "open" | "update" }>): void {
  const base = { version: SCENE_WORKER_PROTOCOL_VERSION, requestId: message.requestId, generation: message.generation, boundary: { operations: 0, sourceBytesCopied: 0 } } as const;
  if (message.type === "diagnostics") reply({ ...base, type: "diagnostics", diagnostics: [] });
  else if (message.type === "hover") reply({ ...base, type: "hover", hover: null });
  else if (message.type === "format") reply({ ...base, type: "format", text: currentText });
  else if (message.type === "code-actions") reply({ ...base, type: "code-actions", actions: [] });
  else reply({ ...base, type: "highlights", spans: [] });
}
self.addEventListener("message", async (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isSceneWorkerRequest(message)) { error("Unsupported Scene language worker protocol.", "protocol"); return; }
  if (message.type === "init") { try { runtimePromise = createSceneLangWasm({ wasmUrl: message.wasmUrl }); await runtimePromise; reply({ type: "ready", version: SCENE_WORKER_PROTOCOL_VERSION }); } catch (cause) { error(cause instanceof Error ? cause.message : String(cause), "init"); } return; }
  if (message.type === "open" || message.type === "update") { currentRevision = message.revision; currentText = message.text; return; }
  try {
    if (!runtimePromise) throw new Error("Scene language worker was used before init.");
    const runtime = await runtimePromise;
    if (message.revision !== currentRevision) { fallback(message); return; }
    const base = {
      version: SCENE_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      generation: message.generation,
      boundary: { operations: 1, sourceBytesCopied: encoder.encode(currentText).byteLength }
    } as const;
    if (message.type === "diagnostics") reply({ ...base, type: "diagnostics", diagnostics: runtime.diagnostics(currentText) });
    else if (message.type === "hover") reply({ ...base, type: "hover", hover: runtime.hover(currentText, message.offset) });
    else if (message.type === "format") reply({ ...base, type: "format", text: runtime.format(currentText) });
    else if (message.type === "code-actions") reply({ ...base, type: "code-actions", actions: runtime.codeActions(currentText, message.selection) });
    else reply({ ...base, type: "highlights", spans: runtime.highlights(currentText, message.lines) });
  } catch (cause) { error(cause instanceof Error ? cause.message : String(cause), "runtime"); }
});
