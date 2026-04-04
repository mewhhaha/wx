import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@wx/editor-element",
    environment: "jsdom",
    include: ["src/**/*.test.ts"]
  }
});
