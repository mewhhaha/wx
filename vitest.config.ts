import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/editor-core/vitest.config.ts",
      "packages/editor-controller/vitest.config.ts",
      "packages/editor-language/vitest.config.ts",
      "packages/editor-layout/vitest.config.ts",
      "packages/editor-view-ansi/vitest.config.ts",
      "packages/editor-theme/vitest.config.ts",
      "packages/editor-tree-sitter/vitest.config.ts",
      "packages/scene-lang-wasm/vitest.config.ts",
      "packages/scene-lang-worker/vitest.config.ts",
      "packages/editor-view-dom/vitest.config.ts",
      "packages/editor-element/vitest.config.ts",
      "apps/playground/vitest.config.ts"
    ]
  }
});
