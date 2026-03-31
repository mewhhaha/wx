import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@whx/editor-element",
    environment: "jsdom",
    include: ["src/**/*.test.ts"]
  }
});
