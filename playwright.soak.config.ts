import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/playground/tests",
  testMatch: "**/soak.spec.ts",
  outputDir: "test-results/soak",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 15 * 60_000,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report-soak" }]]
    : "line",
  use: {
    baseURL: "http://127.0.0.1:41878",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    launchOptions: { args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] }
  },
  projects: [{ name: "soak-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @wx/scene-lang-wasm build && pnpm --filter @wx/playground exec vite --host 127.0.0.1 --port 41878 --strictPort",
    cwd: ".",
    port: 41878,
    reuseExistingServer: !process.env.CI
  }
});
