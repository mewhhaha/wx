import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./browser-test";

test("commits browser text and composition once with an accessible editor input", async ({ page }) => {
  await page.goto("./");

  const editor = page.locator("[data-wx-editor='root']").first();
  const input = page.locator("[data-wx-editor='input']").first();
  await editor.click();
  await page.keyboard.press("i");
  await expect(input).toHaveAttribute("aria-label", "Editor input, insert mode");
  await expect(input).toHaveAttribute("aria-multiline", "true");
  await expect(page.locator("[data-wx-editor-status-mode='true']").first()).toHaveAttribute("aria-live", "polite");
  const accessibility = await new AxeBuilder({ page })
    .include("[data-wx-editor='root']")
    .analyze();
  expect(
    accessibility.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.flatMap((node) => node.target)
    }))
  ).toEqual([]);

  await input.evaluate((node) => {
    node.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "λ",
      inputType: "insertText"
    }));
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    node.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "漢" }));
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "漢" }));
  });

  await expect(editor).toContainText("λ漢@fragment");
  await page.keyboard.press("Escape");
  await expect(input).toHaveAttribute("aria-label", "Editor input, normal mode");
});
