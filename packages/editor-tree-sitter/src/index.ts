import type { EditorLanguageServices, LanguageProvider } from "@wx/editor-language";

import {
  createTreeSitterLanguageProvider as createTreeSitterLanguageProviderWithHost,
  createTreeSitterLanguageServices as createTreeSitterLanguageServicesWithHost,
  type TreeSitterProviderOptions as TreeSitterProviderOptionsWithHost,
  type TreeSitterWorkerHost
} from "./provider";

export { TreeSitterLanguageProvider, type TreeSitterWorkerHost } from "./provider";
export { typescriptHighlightQuery } from "./highlightQuery";

export interface TreeSitterProviderOptions extends Omit<TreeSitterProviderOptionsWithHost, "createWorker"> {
  createWorker?: () => TreeSitterWorkerHost;
}

function defaultWorkerFactory(): TreeSitterWorkerHost {
  return new Worker(new URL("./treeSitter.worker.js", import.meta.url), { type: "module" });
}

export function createTreeSitterLanguageProvider(options: TreeSitterProviderOptions): LanguageProvider {
  return createTreeSitterLanguageProviderWithHost({
    ...options,
    createWorker: options.createWorker ?? defaultWorkerFactory
  });
}

export function createTreeSitterLanguageServices(options: TreeSitterProviderOptions): EditorLanguageServices {
  return createTreeSitterLanguageServicesWithHost({
    ...options,
    createWorker: options.createWorker ?? defaultWorkerFactory
  });
}
