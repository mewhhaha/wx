import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@mewhhaha/wx-element",
    environment: "jsdom",
    include: ["src/**/*.test.ts"]
  }
});
