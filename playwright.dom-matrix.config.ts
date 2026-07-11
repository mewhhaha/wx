import { defineConfig, devices } from "@playwright/test";

// This suite deliberately uses the editor-only fixture: compatibility evidence
// for the DOM editor must not depend on a GPU or WebGPU implementation.
export default defineConfig({
  testDir: "./apps/playground/tests",
  testMatch: "**/dom-compatibility.spec.ts",
  outputDir: "test-results/dom-matrix",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never", outputFolder: "playwright-report-dom-matrix" }]] : "line",
  use: {
    baseURL: "http://127.0.0.1:41876",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    { name: "dom-chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 } },
    { name: "dom-firefox", use: { ...devices["Desktop Firefox"], deviceScaleFactor: 2 } },
    { name: "dom-webkit", use: { ...devices["Desktop Safari"], deviceScaleFactor: 2 } }
  ],
  webServer: {
    command: "pnpm --filter @wx/scene-lang-wasm build && pnpm --filter @wx/playground exec vite --host 127.0.0.1 --port 41876 --strictPort",
    cwd: ".",
    port: 41876,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
