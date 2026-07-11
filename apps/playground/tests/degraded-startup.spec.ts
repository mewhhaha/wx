import { resolve } from "node:path";

import { expect, test } from "./browser-test";

const moduleUrl = (path: string) => `/@fs/${resolve(process.cwd(), path)}`;

test("editor-only fixture stays editable without scene Wasm or WebGPU preview", async ({ page }) => {
  const optionalRequests: string[] = [];
  page.on("request", (request) => {
    if (/scene-lang|webgpu/i.test(request.url())) optionalRequests.push(request.url());
  });
  await page.goto("./?fixture=editor");
  const editor = page.locator("[data-wx-editor='root']").first();
  await expect(editor).toBeVisible();
  await expect(page.locator("[data-shader-preview='true']")).toHaveCount(0);
  await editor.click();
  await page.keyboard.press("i");
  await page.keyboard.type("editable ");
  await page.keyboard.press("Escape");
  await expect(editor).toContainText("editable");
  expect(optionalRequests).toEqual([]);
});

test("failed optional language startup remains editable and exposes retry", async ({ page }) => {
  await page.goto("./?fixture=language&fail-language=1");
  const editor = page.locator("[data-wx-editor='root']").first();
  const language = page.locator("[data-feature-status='language']");
  await expect(editor).toBeVisible();
  await expect(language).toHaveAttribute("data-feature-state", "failed");
  await expect(language.getByRole("button", { name: "Retry" })).toBeVisible();
  await editor.click();
  await page.keyboard.press("i");
  await page.keyboard.type("still editable");
  await page.keyboard.press("Escape");
  await expect(editor).toContainText("still editable");
  await language.getByRole("button", { name: "Retry" }).click();
  await expect(language).toHaveAttribute("data-feature-state", "failed");
});

test.describe("expected optional asset failure", () => {
  test.use({ expectedCriticalFailurePatterns: ["scene-lang.*\\.wasm"] });

  test("a failed scene Wasm request degrades in bounded state while editing stays usable", async ({ page }) => {
    await page.addInitScript(() => {
      const ParentWorker = window.Worker;
      (window as Window & { __wxActiveWorkers?: number }).__wxActiveWorkers = 0;
      window.Worker = class CountedWorker extends ParentWorker {
        private counted = true;
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          (window as Window & { __wxActiveWorkers?: number }).__wxActiveWorkers! += 1;
        }
        override terminate(): void {
          if (this.counted) {
            this.counted = false;
            (window as Window & { __wxActiveWorkers?: number }).__wxActiveWorkers! -= 1;
          }
          super.terminate();
        }
      };
    });
    await page.route(/scene-lang.*\.wasm/i, (route) => route.abort("failed"));
    await page.goto("./");

    const editor = page.locator("[data-wx-editor='root']").first();
    const language = page.locator("[data-feature-status='language']");
    const preview = page.locator("[data-feature-status='preview']");
    await expect(editor).toBeVisible();
    await expect(language).toHaveAttribute("data-feature-state", "failed");
    await expect(preview).toHaveAttribute("data-feature-state", "failed");
    await expect.poll(() => page.evaluate(() =>
      (window as Window & { __wxActiveWorkers?: number }).__wxActiveWorkers ?? -1
    )).toBe(0);

    await editor.click();
    await page.keyboard.press("i");
    await page.keyboard.type("asset failure remains editable ");
    await page.keyboard.press("Escape");
    await expect(editor).toContainText("asset failure remains editable");

    await language.getByRole("button", { name: "Retry" }).click();
    await expect(language).toHaveAttribute("data-feature-state", "failed");
    await expect.poll(() => page.evaluate(() =>
      (window as Window & { __wxActiveWorkers?: number }).__wxActiveWorkers ?? -1
    )).toBe(0);
  });
});

test.describe("expected Tree-sitter asset failure", () => {
  test.use({ expectedCriticalFailurePatterns: ["tree-sitter-typescript.*\\.wasm"] });

  test("an aborted grammar request settles readiness, retry, editing, and worker teardown", async ({ page }) => {
    await page.addInitScript(() => {
      const ParentWorker = window.Worker;
      (window as Window & { __wxActiveWorkers?: number }).__wxActiveWorkers = 0;
      window.Worker = class CountedWorker extends ParentWorker {
        private counted = true;
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          (window as Window & { __wxActiveWorkers?: number }).__wxActiveWorkers! += 1;
        }
        override terminate(): void {
          if (this.counted) {
            this.counted = false;
            (window as Window & { __wxActiveWorkers?: number }).__wxActiveWorkers! -= 1;
          }
          super.terminate();
        }
      };
    });
    await page.route(/tree-sitter-typescript.*\.wasm/i, (route) => route.abort("failed"));
    await page.goto("./?soak=1");

    const result = await page.evaluate(async ({ controllerUrl, domUrl, treeUrl }) => {
      const { createEditorController } = await import(controllerUrl) as typeof import("@mewhhaha/wx-controller");
      const { createEditor } = await import(domUrl) as typeof import("@mewhhaha/wx-dom");
      const { createTreeSitterLanguageServices, typescriptHighlightQuery } = await import(treeUrl) as typeof import("@wx/editor-tree-sitter");
      const mount = document.createElement("div");
      mount.style.cssText = "width:640px;height:320px";
      document.body.append(mount);
      const controller = createEditorController({ value: "const value = 1;" });
      const services = createTreeSitterLanguageServices({
        parserWasmUrl: "/src/assets/web-tree-sitter.wasm",
        languageWasmUrl: "/src/assets/tree-sitter-typescript.wasm",
        query: typescriptHighlightQuery,
        owner: "view",
        timeoutMs: 1_000
      });
      const editor = createEditor(mount, { controller, languageServices: services });
      let readinessSettled = false;
      try {
        await Promise.race([
          services.lifecycle?.whenReady?.(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("readiness timeout")), 3_000))
        ]);
      } catch {
        readinessSettled = true;
      }
      await controller.handleKeyInput({ key: "i" });
      await controller.handleTextInput("editable ");
      await controller.handleKeyInput({ key: "Escape" });
      const initialServiceState = services.lifecycle?.state;
      const retryResult = await controller.retryLanguageServices();
      const retryDeadline = performance.now() + 3_000;
      while (
        controller.getPresentationState().language.serviceStatus.state === "starting" &&
        performance.now() < retryDeadline
      ) {
        await new Promise((resolveTask) => setTimeout(resolveTask, 10));
      }
      const snapshot = {
        readinessSettled,
        editable: controller.getState().doc.text.includes("editable"),
        initialServiceState,
        presentationState: controller.getPresentationState().language.serviceStatus.state,
        retryResult,
        retryServiceStates: controller.getPresentationState().language.services.map(
          (entry) => entry.lifecycle?.state ?? "none"
        )
      };
      editor.destroy();
      controller.destroy();
      mount.remove();
      await new Promise((resolveTask) => setTimeout(resolveTask, 0));
      return {
        ...snapshot,
        activeWorkers: (window as Window & { __wxActiveWorkers?: number }).__wxActiveWorkers ?? -1
      };
    }, {
      controllerUrl: moduleUrl("packages/editor-controller/src/index.ts"),
      domUrl: moduleUrl("packages/editor-view-dom/src/index.ts"),
      treeUrl: moduleUrl("packages/editor-tree-sitter/src/index.ts")
    });

    expect(result).toEqual({
      readinessSettled: true,
      editable: true,
      initialServiceState: "failed",
      presentationState: "failed",
      retryResult: true,
      retryServiceStates: ["failed"],
      activeWorkers: 0
    });
  });
});
