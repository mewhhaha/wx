import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["apps/playground/tests/**/*.test.ts"]
  }
});
