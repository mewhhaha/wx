import { expect, test } from "./browser-test";

test("Pages base-path first load bypasses caches without requiring the WebGPU surface", async ({ page, baseURL }) => {
  const expectedBase = new URL(baseURL ?? "http://127.0.0.1/").pathname;
  const criticalRequests: Array<{ pathname: string; cacheControl: string; pragma: string }> = [];

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (!/\.(?:css|m?js|wasm|scm)$/i.test(pathname) && !/(?:worker|grammar|tree-sitter)/i.test(pathname)) return;
    const headers = request.headers();
    criticalRequests.push({
      pathname,
      cacheControl: headers["cache-control"] ?? "",
      pragma: headers.pragma ?? ""
    });
  });

  const response = await page.goto("./?fixture=editor");

  expect(response).not.toBeNull();
  expect(response!.request().headers()["cache-control"]).toContain("no-cache");
  await expect(page.locator("[data-wx-editor='root']").first()).toBeVisible();
  await expect(page.locator("[data-shader-preview='true']")).toHaveCount(0);
  expect(criticalRequests.length).toBeGreaterThan(0);
  for (const request of criticalRequests) {
    expect(
      request.pathname.startsWith(expectedBase),
      `asset escaped repository base: ${request.pathname}`
    ).toBe(true);
    expect(request.cacheControl).toContain("no-cache");
    expect(request.pragma).toBe("no-cache");
  }
});
