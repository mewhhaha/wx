import { test, expect } from "@playwright/test";

test("renders, moves, types, and highlights", async ({ page }) => {
  await page.goto("/");

  const editor = page.locator("[data-wx-editor='root']").first();
  const cursor = page.locator("[data-wx-editor-cursor='true']").first();
  const preview = page.locator("[data-scene-preview='true']").first();

  await expect(editor).toBeVisible();
  await expect(page.locator("[data-wx-editor-gutter='1']").first()).toContainText("1");
  await expect(cursor).toBeVisible();
  await expect(page.locator("[data-wx-editor-status-mode='true']").first()).toContainText("NOR");
  await expect(page.locator("[data-wx-editor-status-file='true']").first()).toContainText("examples/editor.scene");
  await expect(page.locator("[data-wx-editor-status-meta='true']").first()).toContainText("E1");
  await expect(page.locator("[data-wx-editor-status-meta='true']").first()).toContainText("W1");
  await expect(page.locator("[data-wx-editor-diagnostic-marker='info']").first()).toBeVisible();
  await expect(preview).toContainText("NOR");
  await expect(preview).toContainText("return message");

  await editor.click();
  await page.keyboard.press("Space");
  await page.keyboard.press("a");
  await expect(page.locator("[data-wx-editor-code-actions='true']").first()).toContainText("Replace `guttr` with `gutter`");
  await page.keyboard.press("Escape");

  await page.getByText("screen", { exact: true }).hover();
  await expect(page.locator("[data-wx-editor-tooltip='true']").first()).toContainText("Root scene node");
  await page.keyboard.press("Escape");

  await page.keyboard.press("i");
  await expect(page.locator("[data-wx-editor-status-mode='true']").first()).toContainText("INS");
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");

  await expect(page.locator(".wx-role-keyword").first()).toBeVisible();
  await expect(editor).toContainText("xguttr");

  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await page.keyboard.press("Space");
  await expect(page.locator("[data-wx-editor-prefix-hint='space']").first()).toContainText("<space>");
  await page.keyboard.press("k");
  await expect(page.locator("[data-wx-editor-tooltip='true']").first()).toContainText("Root scene node");
  await page.keyboard.press("Escape");

  await page.keyboard.press(":");
  await expect(page.locator("[data-wx-editor-command-prompt='true']").first()).toContainText(":");
  await page.keyboard.type("format");
  await expect(page.locator("[data-wx-editor-command-text='true']").first()).toContainText("format");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-wx-editor-command-prompt='true']")).toHaveCount(0);
  await expect(preview).toContainText("Replace guttr with gutter");
});
