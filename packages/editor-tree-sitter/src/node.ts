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
  const listeners = new Map<string, Map<(event: Event) => void, (...args: unknown[]) => void>>();

  const add = (type: "message" | "error" | "messageerror", listener: (event: Event) => void) => {
    const wrapped = type === "message"
      ? (data: unknown) => listener({ type, data } as MessageEvent)
      : () => listener({ type } as Event);
    const typedListeners = listeners.get(type) ?? new Map();
    typedListeners.set(listener, wrapped);
    listeners.set(type, typedListeners);
    worker.on(type, wrapped);
  };

  const remove = (type: "message" | "error" | "messageerror", listener: (event: Event) => void) => {
    const typedListeners = listeners.get(type);
    const wrapped = typedListeners?.get(listener);
    if (!wrapped) return;
    typedListeners?.delete(listener);
    worker.off(type, wrapped);
  };

  return {
    addEventListener(type, listener) {
      add(type, listener as (event: Event) => void);
    },
    removeEventListener(type, listener) {
      remove(type, listener as (event: Event) => void);
    },
    postMessage(message) {
      worker.postMessage(message);
    },
    terminate() {
      for (const [type, typedListeners] of listeners) for (const wrapped of typedListeners.values()) worker.off(type as "message", wrapped);
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
