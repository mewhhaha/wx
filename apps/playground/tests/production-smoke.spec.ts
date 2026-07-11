import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "./browser-test";

interface WebAssetBudget {
  version: number;
  maxTotalAssetBytes: number;
  maxEntryJavaScriptBytes: number;
  maxWorkerJavaScriptBytes: number;
  maxSingleWasmBytes: number;
  maxCssBytes: number;
}

test("loads every critical production asset beneath the repository base", async ({ page, baseURL }) => {
  const expectedBase = new URL(baseURL ?? "http://127.0.0.1/").pathname;
  const criticalAssets = new Set<string>();
  const contentTypes = new Map<string, string>();

  const collectCriticalAsset = (response: { url(): string; headers(): Record<string, string> }) => {
    const url = new URL(response.url());
    if (/\.(?:css|m?js|wasm|scm)$/i.test(url.pathname) || /(?:worker|grammar|tree-sitter)/i.test(url.pathname)) {
      criticalAssets.add(url.pathname);
      const contentType = response.headers()["content-type"] ?? "";
      // A cache-served response on the second navigation can expose an empty
      // header map. Preserve the authoritative first network response.
      if (contentType || !contentTypes.has(url.pathname)) contentTypes.set(url.pathname, contentType);
    }
  };

  // Worker-owned requests are not consistently surfaced through Page events.
  // BrowserContext observes both the document and its module workers.
  page.context().on("response", collectCriticalAsset);

  await page.goto("./");

  await expect(page.locator("[data-wx-editor='root']").first()).toBeVisible();
  await expect(page.locator("[data-shader-preview='true']").first()).toBeVisible();
  await expect(page.locator("[data-feature-status='language']")).toHaveAttribute("data-feature-state", "ready");

  // The normal demo uses the scene worker. Exercise the production Tree-sitter
  // worker and grammar through the real benchmark fixture as a separate path.
  await page.goto("./?bench=1");
  await expect.poll(() => page.evaluate(() => typeof window.__wxBench?.runSuite === "function")).toBe(true);
  await page.evaluate(async () => {
    await window.__wxBench?.runSuite({ iterations: 1, lineCount: 20, suite: "smoke" });
  });

  await expect.poll(() => [...criticalAssets].some((path) => path.endsWith(".css"))).toBe(true);
  await expect.poll(() => [...criticalAssets].some((path) => /\/index-[^/]+\.js$/.test(path))).toBe(true);
  await expect.poll(() => [...criticalAssets].some((path) => /treeSitter\.worker-[^/]+\.js$/.test(path))).toBe(true);
  await expect.poll(() => [...criticalAssets].some((path) => /sceneLang\.worker-[^/]+\.js$/.test(path))).toBe(true);
  await expect.poll(() => [...criticalAssets].some((path) => /tree-sitter-typescript-[^/]+\.wasm$/.test(path))).toBe(true);
  await expect.poll(() => [...criticalAssets].some((path) => /web-tree-sitter-[^/]+\.wasm$/.test(path))).toBe(true);
  await expect.poll(() => [...criticalAssets].some((path) => /scene-lang-[^/]+\.wasm$/.test(path))).toBe(true);

  expect(criticalAssets.size).toBeGreaterThan(0);
  for (const assetPath of criticalAssets) {
    expect(assetPath, `asset escaped repository base: ${assetPath}`).toMatch(new RegExp(`^${expectedBase}`));
    const contentType = contentTypes.get(assetPath) ?? "";
    if (/\.wasm$/i.test(assetPath)) expect(contentType, assetPath).toContain("application/wasm");
    else if (/\.css$/i.test(assetPath)) expect(contentType, assetPath).toContain("text/css");
    else if (/\.m?js$/i.test(assetPath)) expect(contentType, assetPath).toMatch(/javascript/);
  }

  const budget = JSON.parse(
    await readFile(resolve(process.cwd(), "benchmarks/budgets/web-assets-v1.json"), "utf8")
  ) as WebAssetBudget;
  expect(budget.version).toBe(1);
  const assetDirectory = resolve(process.cwd(), "apps/playground/dist/assets");
  const assets = await Promise.all((await readdir(assetDirectory)).map(async (name) => ({
    name,
    bytes: (await stat(resolve(assetDirectory, name))).size
  })));
  expect(assets.reduce((sum, asset) => sum + asset.bytes, 0)).toBeLessThanOrEqual(budget.maxTotalAssetBytes);
  for (const asset of assets) {
    if (/^index-[^/]+\.js$/.test(asset.name)) expect(asset.bytes, asset.name).toBeLessThanOrEqual(budget.maxEntryJavaScriptBytes);
    if (/worker-[^/]+\.js$/i.test(asset.name)) expect(asset.bytes, asset.name).toBeLessThanOrEqual(budget.maxWorkerJavaScriptBytes);
    if (/\.wasm$/i.test(asset.name)) expect(asset.bytes, asset.name).toBeLessThanOrEqual(budget.maxSingleWasmBytes);
    if (/\.css$/i.test(asset.name)) expect(asset.bytes, asset.name).toBeLessThanOrEqual(budget.maxCssBytes);
  }
});
