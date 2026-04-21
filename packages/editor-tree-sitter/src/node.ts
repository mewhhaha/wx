import { Worker as NodeWorker } from "node:worker_threads";

import type { EditorLanguageServices } from "@mewhhaha/wx-language";

import {
  createTreeSitterLanguageServices,
  type TreeSitterProviderOptions,
  type TreeSitterWorkerHost
} from "./provider";

export interface NodeTreeSitterProviderOptions extends Omit<TreeSitterProviderOptions, "createWorker"> {
  workerModuleUrl?: string | URL;
}

export function createNodeTreeSitterWorkerHost(moduleUrl: string | URL = new URL("./nodeWorker.js", import.meta.url)): TreeSitterWorkerHost {
  const worker = new NodeWorker(moduleUrl);
  const listeners = new Map<(event: MessageEvent) => void, (data: unknown) => void>();

  return {
    addEventListener(type, listener) {
      if (type !== "message") {
        return;
      }

      const wrapped = (data: unknown) => listener({ data } as MessageEvent);
      listeners.set(listener, wrapped);
      worker.on("message", wrapped);
    },
    removeEventListener(type, listener) {
      if (type !== "message") {
        return;
      }

      const wrapped = listeners.get(listener);
      if (!wrapped) {
        return;
      }

      listeners.delete(listener);
      worker.off("message", wrapped);
    },
    postMessage(message) {
      worker.postMessage(message);
    },
    terminate() {
      listeners.clear();
      void worker.terminate();
    }
  };
}

export function createNodeTreeSitterLanguageServices(options: NodeTreeSitterProviderOptions): EditorLanguageServices {
  return createTreeSitterLanguageServices({
    ...options,
    createWorker: () => createNodeTreeSitterWorkerHost(options.workerModuleUrl)
  });
}
