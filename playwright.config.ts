import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/playground/tests",
  testMatch: "**/*.spec.ts",
  testIgnore: [
    "**/production-smoke.spec.ts",
    "**/web-lifecycle-production.spec.ts",
    "**/dom-compatibility.spec.ts",
    "**/soak.spec.ts"
  ],
  outputDir: "test-results",
  fullyParallel: false,
  // Several smoke cases exercise the dev host bridge. Serial files prevent a
  // write-triggered Vite reload in one case from invalidating another page.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { open: "never", outputFolder: "playwright-report" }]
      ]
    : "line",
  use: {
    baseURL: "http://127.0.0.1:41875",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium-smoke",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    // Build the Wasm prerequisite explicitly so the test never depends on
    // ignored output from an older checkout, then invoke Vite without an extra
    // `--` positional argument.
    command:
      "pnpm --filter @wx/scene-lang-wasm build && " +
      "pnpm --filter @wx/playground exec vite --host 127.0.0.1 --port 41875 --strictPort",
    cwd: ".",
    port: 41875,
    reuseExistingServer: !process.env.CI
  }
});
