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
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(async () => await page.locator(".whx-is-selected").count()).toBeGreaterThan(1);
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(async () => await page.locator(".whx-is-selected").count()).toBeGreaterThan(0);

  await expect(page.locator(".whx-role-keyword").first()).toBeVisible();
  await expect(page.locator("[data-whx-editor-content='1']").first()).toContainText("ixmport");

  await page.keyboard.press(":");
  await expect(page.locator("[data-whx-editor-command-prompt='true']").first()).toContainText(":");
  await page.keyboard.type("wq");
  await expect(page.locator("[data-whx-editor-command-text='true']").first()).toContainText("wq");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-whx-editor-command-prompt='true']")).toHaveCount(0);
});
