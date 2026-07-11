import type { EditorLanguageServices, LanguageProvider } from "@mewhhaha/wx-language";

import {
  createTreeSitterLanguageProvider as createTreeSitterLanguageProviderWithHost,
  createTreeSitterLanguageServices as createTreeSitterLanguageServicesWithHost,
  type TreeSitterProviderOptions as TreeSitterProviderOptionsWithHost,
  type TreeSitterWorkerHost
} from "./provider";

export {
  LanguageServiceError,
  TreeSitterLanguageProvider,
  type LanguageServiceState,
  type TreeSitterPipelineMetrics,
  type TreeSitterWorkerHost
} from "./provider";
export { typescriptHighlightQuery } from "./highlightQuery";
export {
  TREE_SITTER_INDENT_QUERY_SUBSET,
  collectIndentCaptures,
  indentQueryRange,
  queryIndentCaptures,
  resolveIndentCaptures,
  type IndentCapture,
  type IndentCaptureAnswer,
  type IndentQueryMatchLike,
  type IndentQueryNodeLike,
  type IndentQueryLike,
  type IndentQueryRange
} from "./indentQuery";
export { sceneIndentQuery, typescriptIndentQuery } from "./indentQueries";
export {
  materializeIndentationFixture,
  sceneOrWgslCaptureFixtures,
  typescriptIndentationFixtures,
  type IndentationConformanceFixture
} from "./indentFixtures";

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
