import type { EditorLanguageServices } from "@mewhhaha/wx-language";

import {
  createTreeSitterLanguageServices,
  type TreeSitterProviderOptions,
  type TreeSitterWorkerHost
} from "./provider";

export interface DenoTreeSitterProviderOptions extends Omit<TreeSitterProviderOptions, "createWorker"> {
  workerModuleUrl?: string | URL;
}

/** Deno-local worker adapter; browser and Deno execute the same versioned worker protocol. */
export function createDenoTreeSitterWorkerHost(
  moduleUrl: string | URL = new URL(import.meta.url.endsWith(".ts") ? "./treeSitter.worker.ts" : "./treeSitter.worker.js", import.meta.url)
): TreeSitterWorkerHost {
  return new Worker(moduleUrl, { type: "module", name: "wx-tree-sitter" }) as unknown as TreeSitterWorkerHost;
}

export function createDenoTreeSitterLanguageServices(options: DenoTreeSitterProviderOptions): EditorLanguageServices {
  return createTreeSitterLanguageServices({
    ...options,
    createWorker: () => createDenoTreeSitterWorkerHost(options.workerModuleUrl)
  });
}
