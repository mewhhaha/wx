import { parentPort } from "node:worker_threads";

type MessageListener = (event: { data: unknown }) => void;

const listeners = new Set<MessageListener>();

Object.assign(globalThis, {
  self: globalThis,
  postMessage(message: unknown) {
    parentPort?.postMessage(message);
  },
  addEventListener(type: string, listener: MessageListener) {
    if (type === "message") {
      listeners.add(listener);
    }
  },
  removeEventListener(type: string, listener: MessageListener) {
    if (type === "message") {
      listeners.delete(listener);
    }
  }
});

parentPort?.on("message", (data) => {
  for (const listener of listeners) {
    listener({ data });
  }
});

await import("../../editor-tree-sitter/src/treeSitter.worker");
