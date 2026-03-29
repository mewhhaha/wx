import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/playground/tests",
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4175"
  },
  webServer: {
    command: "../../node_modules/.bin/vite --host 127.0.0.1 --port 4175 --strictPort",
    cwd: "./apps/playground",
    port: 4175,
    reuseExistingServer: !process.env.CI
  }
});
