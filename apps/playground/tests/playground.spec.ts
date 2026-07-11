import { expect, test } from "./browser-test";

test("renders the shader editor and preview shell", async ({ page }) => {
  await page.goto("./");

  const editor = page.locator("[data-wx-editor='root']").first();
  const cursor = page.locator("[data-wx-editor-cursor='true']").first();
  const preview = page.locator("[data-shader-preview='true']").first();

  await expect(editor).toBeVisible();
  await expect(cursor).toBeVisible();
  const cursorRow = cursor.locator("xpath=ancestor::*[@data-wx-editor-row][1]");
  await expect(cursorRow).toBeVisible();
  await expect(cursorRow.locator(".wx-editor__gutter-number")).toHaveAttribute("data-active", "true");
  await expect(cursorRow.locator(".wx-editor__gutter-number")).toHaveText(/^\d+$/);
  await expect(page.locator("[data-wx-editor-status-mode='true']").first()).toContainText("NOR");
  await expect(page.locator("[data-wx-editor-status-file='true']").first()).toContainText("examples/demo.wgsl");
  await expect(preview).toBeVisible();

  await editor.click();

  await page.getByText("@fragment", { exact: true }).first().hover();
  await expect(page.locator("[data-wx-editor-tooltip='true']").first()).toContainText("fragment entrypoint");
  await page.keyboard.press("Escape");

  await page.keyboard.press("i");
  await expect(page.locator("[data-wx-editor-status-mode='true']").first()).toContainText("INS");
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");

  await expect(page.locator(".wx-role-keyword").first()).toBeVisible();
  await expect(editor).toContainText("x@fragment");

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

test("keeps syntax highlighting when the viewport moves and visible code updates", async ({ page }) => {
  await page.goto("./");

  const editor = page.locator("[data-wx-editor='root']").first();
  await editor.click();

  const activeRow = page.locator("[data-wx-editor-row].wx-row-active");
  await expect(activeRow).toHaveCount(1);
  const initialRow = Number(await activeRow.getAttribute("data-wx-editor-row"));
  await expect(activeRow.locator("[data-wx-editor-cursor='true']")).toBeVisible();
  await expect(page.locator(".wx-role-keyword:visible").first()).toBeVisible();

  for (let index = 0; index < 15; index += 1) {
    await page.keyboard.press("j");
  }

  await expect(activeRow).toHaveCount(1);
  await expect(activeRow.locator("[data-wx-editor-cursor='true']")).toBeVisible();
  const movedRow = Number(await activeRow.getAttribute("data-wx-editor-row"));
  expect(movedRow).toBeGreaterThan(initialRow);
  await expect(page.locator(".wx-role-keyword:visible").first()).toBeVisible();

  await page.keyboard.press("i");
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");

  await expect(activeRow).toContainText("x");
  await expect(activeRow.locator("[data-wx-editor-cursor='true']")).toBeVisible();
  await expect(page.locator(".wx-role-keyword:visible").first()).toBeVisible();
});

test("loads url-provided source before the default sample", async ({ page }) => {
  const source = "const value = 42;\n@fragment";
  await page.goto(`./?src=${encodeURIComponent(source)}`);

  const editor = page.locator("[data-wx-editor='root']").first();

  await expect(editor).toContainText("const value = 42;");
  await expect(editor).toContainText("@fragment");
});
