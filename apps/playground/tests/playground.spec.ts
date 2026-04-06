import { expect, test } from "@playwright/test";

test("renders the shader editor and preview shell", async ({ page }) => {
  await page.goto("/");

  const editor = page.locator("[data-wx-editor='root']").first();
  const cursor = page.locator("[data-wx-editor-cursor='true']").first();
  const preview = page.locator("[data-shader-preview='true']").first();

  await expect(editor).toBeVisible();
  await expect(page.locator("[data-wx-editor-gutter='1']").first()).toContainText("1");
  await expect(cursor).toBeVisible();
  await expect(page.locator("[data-wx-editor-status-mode='true']").first()).toContainText("NOR");
  await expect(page.locator("[data-wx-editor-status-file='true']").first()).toContainText("examples/demo.shader");
  await expect(page.locator("[data-wx-editor-status-meta='true']").first()).toContainText("E1");
  await expect(page.locator("[data-wx-editor-status-meta='true']").first()).toContainText("W1");
  await expect(preview).toBeVisible();

  await editor.click();
  await page.keyboard.press("Space");
  await page.keyboard.press("a");
  await expect(page.locator("[data-wx-editor-code-actions='true']").first()).toContainText("Replace `clor` with `color`");
  await page.keyboard.press("Escape");

  await page.getByText("shader", { exact: true }).hover();
  await expect(page.locator("[data-wx-editor-tooltip='true']").first()).toContainText("Root shader node");
  await page.keyboard.press("Escape");

  await page.keyboard.press("i");
  await expect(page.locator("[data-wx-editor-status-mode='true']").first()).toContainText("INS");
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");

  await expect(page.locator(".wx-role-keyword").first()).toBeVisible();
  await expect(editor).toContainText("xclor");

  await page.keyboard.press(":");
  await expect(page.locator("[data-wx-editor-command-prompt='true']").first()).toContainText(":");
  await page.keyboard.type("format");
  await expect(page.locator("[data-wx-editor-command-text='true']").first()).toContainText("format");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-wx-editor-command-prompt='true']")).toHaveCount(0);

  await expect(
    page.locator("[data-shader-preview-error='true'], [data-shader-preview-canvas='true']").first()
  ).toBeVisible();
});
