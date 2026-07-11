import { defineConfig, devices } from "@playwright/test";

const repository = process.env.WX_E2E_REPOSITORY ?? "local/wx-e2e";
const repositoryName = repository.split("/")[1] ?? "wx-e2e";

export default defineConfig({
  testDir: "./apps/playground/tests",
  testMatch: "**/web-lifecycle-production.spec.ts",
  outputDir: "test-results/web-lifecycle-production",
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { open: "never", outputFolder: "playwright-report-web-lifecycle-production" }]
      ]
    : "line",
  use: {
    baseURL: `http://127.0.0.1:41877/${repositoryName}/`,
    extraHTTPHeaders: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache"
    },
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium-web-lifecycle-production",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command:
      "pnpm --filter @wx/scene-lang-wasm build && " +
      "pnpm --filter @wx/playground exec vite build && " +
      "pnpm --filter @wx/playground exec vite preview --host 127.0.0.1 --port 41877 --strictPort",
    cwd: ".",
    env: {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: repository
    },
    port: 41877,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
