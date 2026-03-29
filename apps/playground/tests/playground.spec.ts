import { test, expect } from "@playwright/test";

test("renders, moves, types, and highlights", async ({ page }) => {
  await page.goto("/");

  const editor = page.locator("[data-whx-editor='root']").first();
  const cursor = page.locator("[data-whx-editor-cursor='true']").first();

  await expect(editor).toBeVisible();
  await expect(page.locator("[data-whx-editor-gutter='1']").first()).toContainText("1");
  await expect(cursor).toBeVisible();
  await expect(page.locator("[data-whx-editor-status-mode='true']").first()).toContainText("NOR");
  await expect(page.locator("[data-whx-editor-status-file='true']").first()).toContainText("examples/chat-worker/src/worker.ts");

  await editor.click();
  await page.keyboard.press("l");
  await page.keyboard.press("i");
  await expect(page.locator("[data-whx-editor-status-mode='true']").first()).toContainText("INS");
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");
  await page.keyboard.press("j");

  await expect(page.locator(".whx-token[data-role='keyword']").first()).toBeVisible();
  await expect(page.locator("[data-whx-editor-content='1']").first()).toContainText("ixmport");
});
