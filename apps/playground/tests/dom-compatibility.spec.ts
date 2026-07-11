import { resolve } from "node:path";

import { expect, test } from "./browser-test";

const workspaceModuleUrl = (relativePath: string) => `/@fs/${resolve(process.cwd(), relativePath)}`;
const domModuleUrl = workspaceModuleUrl("packages/editor-view-dom/src/index.ts");
const elementModuleUrl = workspaceModuleUrl("packages/editor-element/src/index.ts");
const controllerModuleUrl = workspaceModuleUrl("packages/editor-controller/src/index.ts");

test.beforeEach(async ({ page }) => {
  // The editor-only fixture must not even probe WebGPU. Throwing on access makes
  // that independence observable on machines that happen to expose it.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      get() {
        throw new Error("The DOM compatibility fixture accessed WebGPU.");
      }
    });
  });
});

test("DOM compatibility: editing, motion, history, paste, search, completion, buffers, and focus", async ({ page }) => {
  await page.goto(`./?fixture=editor&src=${encodeURIComponent("alpha fragment omega")}`);
  const root = page.locator("[data-wx-editor='root']").first();
  const input = page.locator("[data-wx-editor='input']").first();
  const statusMeta = page.locator("[data-wx-editor-status-meta='true']").first();
  const statusFile = page.locator("[data-wx-editor-status-file='true']").first();

  await expect(page.locator("[data-shader-preview='true']")).toHaveCount(0);
  await root.click();
  const initialPosition = await statusMeta.textContent();
  await page.keyboard.press("l");
  await expect.poll(() => statusMeta.textContent()).not.toBe(initialPosition);

  await page.keyboard.press("i");
  await page.keyboard.type("compat ");
  await input.evaluate((node) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "paste" } });
    node.dispatchEvent(event);
  });
  await page.keyboard.press("Escape");
  await expect(root).toContainText("compat paste");

  await page.keyboard.press("u");
  await expect(root).not.toContainText("compat paste");
  await input.evaluate((node) => {
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "U", shiftKey: true, bubbles: true }));
  });
  await expect(root).toContainText("compat paste");

  await page.keyboard.press("/");
  await page.keyboard.type("fragment");
  await page.keyboard.press("Enter");
  await expect(root.locator(".wx-search-current").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press(":");
  await page.keyboard.type("theme");
  await expect(page.locator(".wx-editor__command-completion").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press(":");
  await page.keyboard.type("new");
  await page.keyboard.press("Enter");
  await expect(statusFile).toContainText("[scratch 2]");
  await page.keyboard.press("i");
  await page.keyboard.type("second buffer");
  await page.keyboard.press("Escape");
  await expect(root).toContainText("second buffer");

  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(statusFile).toContainText("examples/demo.wgsl");
  await expect(root).toContainText("compat paste");
  await page.keyboard.press("g");
  await page.keyboard.press("n");
  await expect(statusFile).toContainText("[scratch 2]");
  await expect(root).toContainText("second buffer");

  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "compat-focus-target";
    button.textContent = "focus target";
    document.body.append(button);
  });
  await page.locator("#compat-focus-target").focus();
  await expect(input).not.toBeFocused();
  await input.focus();
  await expect(input).toBeFocused();
});

test("DOM compatibility: composition fallback and final input commit each composition once", async ({ page }) => {
  await page.goto("./?fixture=editor&src=");
  const root = page.locator("[data-wx-editor='root']").first();
  const input = page.locator("[data-wx-editor='input']").first();
  await root.click();
  await page.keyboard.press("i");
  await input.evaluate(async (node) => {
    const compose = (text: string) => {
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      node.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: text }));
      node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
    };

    compose("漢");
    node.dispatchEvent(new InputEvent("input", { bubbles: true, data: "漢", inputType: "insertText" }));

    compose("語");
    await new Promise<void>((resolveInput) => {
      setTimeout(() => {
        node.dispatchEvent(new InputEvent("input", { bubbles: true, data: "語", inputType: "insertText" }));
        resolveInput();
      }, 0);
    });

    compose("文");
    await new Promise((resolveFallback) => setTimeout(resolveFallback, 20));
  });

  const rowText = await root.locator("[data-wx-editor-row]").first().textContent();
  expect(rowText).toContain("漢語文");
  for (const text of ["漢", "語", "文"]) {
    expect((rowText ?? "").split(text)).toHaveLength(2);
  }
});

test("DOM compatibility: resize, zoom, DPR, soft wrap, long lines, wheel, and reveal preserve viewport invariants", async ({ page }) => {
  await page.goto("./?fixture=editor");
  await page.evaluate(async ({ moduleUrl }) => {
    const { createEditor } = await import(moduleUrl) as typeof import("@mewhhaha/wx-dom");
    const mount = document.createElement("div");
    mount.id = "compat-viewport-mount";
    mount.style.cssText = "position:fixed;inset:0 auto auto 0;width:640px;height:360px;z-index:1000;background:#111";
    document.body.append(mount);
    const longLine = `long ${"segment ".repeat(1_000)}`;
    const value = [longLine, ...Array.from({ length: 19_999 }, (_, index) => `line ${index + 2}`)].join("\n");
    const editor = createEditor(mount, { value, softWrap: true });
    editor.focus();
    (window as Window & { __wxCompatViewportEditor?: ReturnType<typeof createEditor> }).__wxCompatViewportEditor = editor;
  }, { moduleUrl: domModuleUrl });

  const mount = page.locator("#compat-viewport-mount");
  const root = mount.locator("[data-wx-editor='root']");
  const surface = mount.locator("[data-wx-editor='surface']");
  const cursor = mount.locator("[data-wx-editor-cursor='true']");
  const rows = mount.locator("[data-wx-editor-row]");

  await expect.poll(() => rows.count()).toBeGreaterThan(1);
  await expect.poll(() => mount.locator("[data-wx-editor-row='1']").count()).toBeGreaterThan(1);
  expect(await rows.count()).toBeLessThan(150);

  const beforeWheel = await cursor.boundingBox();
  await surface.dispatchEvent("wheel", { deltaY: 144 });
  await expect.poll(async () => {
    const afterWheel = await cursor.boundingBox();
    if (!beforeWheel || !afterWheel) return false;
    return Math.abs(afterWheel.x - beforeWheel.x) > 1 || Math.abs(afterWheel.y - beforeWheel.y) > 1;
  }).toBe(true);

  await mount.evaluate((node) => { node.style.width = "420px"; });
  await page.evaluate(async () => {
    document.body.style.zoom = "125%";
    window.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())));
  });
  expect(await rows.count()).toBeLessThan(150);
  const overflow = await root.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => devicePixelRatio)).toBeGreaterThan(0);

  await page.keyboard.press("g");
  await page.keyboard.press("e");
  await expect(mount.locator("[data-wx-editor-row='20000']")).toBeVisible();
  await expect(cursor).toBeVisible();
  expect(await rows.count()).toBeLessThan(150);

  const [cursorBox, surfaceBox] = await Promise.all([cursor.boundingBox(), surface.boundingBox()]);
  expect(cursorBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  expect(cursorBox!.y).toBeGreaterThanOrEqual(surfaceBox!.y - 1);
  expect(cursorBox!.y + cursorBox!.height).toBeLessThanOrEqual(surfaceBox!.y + surfaceBox!.height + 1);

  await page.evaluate(() => {
    const scope = window as Window & { __wxCompatViewportEditor?: { destroy(): void } };
    scope.__wxCompatViewportEditor?.destroy();
    delete scope.__wxCompatViewportEditor;
    document.querySelector("#compat-viewport-mount")?.remove();
    document.body.style.zoom = "";
  });
});

test("DOM compatibility: custom elements and handles isolate ownership, reconnect, updates, and ARIA IDs", async ({ page }) => {
  await page.goto("./?fixture=editor");
  const result = await page.evaluate(async ({ customElementUrl, controllerUrl, domUrl }) => {
    const elementModule = await import(customElementUrl) as typeof import("@mewhhaha/wx-element");
    const { createEditorController } = await import(controllerUrl) as typeof import("@mewhhaha/wx-controller");
    const { createEditor } = await import(domUrl) as typeof import("@mewhhaha/wx-dom");
    const tagName = "wx-editor-p1-03-browser";
    elementModule.defineWxEditorElement(tagName);

    const directIds = new Set<string>();
    let directRootsAfterDestroy = 0;
    for (let index = 0; index < 12; index += 1) {
      const container = document.createElement("div");
      document.body.append(container);
      const handle = createEditor(container, { value: `direct ${index}` });
      const input = container.querySelector<HTMLTextAreaElement>("[data-wx-editor='input']")!;
      directIds.add(input.getAttribute("aria-describedby") ?? "");
      handle.destroy();
      handle.destroy();
      directRootsAfterDestroy += container.querySelectorAll("[data-wx-editor='root']").length;
      container.remove();
    }

    const first = document.createElement(tagName) as InstanceType<typeof elementModule.WxEditorElement>;
    const second = document.createElement(tagName) as InstanceType<typeof elementModule.WxEditorElement>;
    first.value = "one";
    second.value = "two";
    document.body.append(first, second);
    const firstInput = first.shadowRoot!.querySelector<HTMLTextAreaElement>("[data-wx-editor='input']")!;
    const secondInput = second.shadowRoot!.querySelector<HTMLTextAreaElement>("[data-wx-editor='input']")!;
    const describedIds = [firstInput, secondInput].map((input) => input.getAttribute("aria-describedby"));
    const updateDocuments: string[] = [];
    let lastUpdateDocument = first.value;
    first.addEventListener("wx-update", (event) => {
      const text = (event as CustomEvent<import("@mewhhaha/wx-controller").EditorUpdate>).detail.nextState.doc.text;
      if (lastUpdateDocument !== text) {
        updateDocuments.push(text);
        lastUpdateDocument = text;
      }
    });
    firstInput.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    firstInput.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: "x", inputType: "insertText" }));
    firstInput.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: "y", inputType: "insertText" }));
    await Promise.resolve();
    const internalValues = [first.value, second.value];
    const ownedController = first.controller;
    first.remove();
    const disconnectedEventCount = updateDocuments.length;
    ownedController?.execute((_state, dispatch) => { dispatch({ mode: "insert" }); return true; });
    document.body.append(first);
    const ownedReconnect = {
      value: first.value,
      replacedController: first.controller !== ownedController,
      noDisconnectedUpdate: updateDocuments.length === disconnectedEventCount
    };

    const sharedController = createEditorController({ value: "shared" });
    const external = document.createElement(tagName) as InstanceType<typeof elementModule.WxEditorElement>;
    external.controller = sharedController;
    const externalEvents: string[] = [];
    external.addEventListener("wx-update", () => externalEvents.push(external.value));
    document.body.append(external);
    external.remove();
    const externalEventCount = externalEvents.length;
    sharedController.execute((_state, dispatch) => { dispatch({ mode: "insert" }); return true; });
    external.value = "offline assignment";
    document.body.append(external);
    const externalReconnect = {
      value: external.value,
      controllerValue: sharedController.getState().doc.text,
      sameController: external.controller === sharedController,
      noDisconnectedUpdate: externalEvents.length === externalEventCount
    };

    let viewDestroyCalls = 0;
    let externalDestroyCalls = 0;
    const serviceContainer = document.createElement("div");
    const serviceHandle = createEditor(serviceContainer, {
      languageServices: [
        { lifecycle: { state: "ready", owner: "view", destroy: () => { viewDestroyCalls += 1; } } },
        { lifecycle: { state: "ready", owner: "external", destroy: () => { externalDestroyCalls += 1; } } }
      ]
    });
    serviceHandle.destroy();
    serviceHandle.destroy();

    first.remove();
    second.remove();
    external.remove();
    sharedController.destroy();
    return {
      directIdCount: directIds.size,
      directRootsAfterDestroy,
      describedIds,
      internalValues,
      updateDocuments,
      ownedReconnect,
      externalReconnect,
      viewDestroyCalls,
      externalDestroyCalls
    };
  }, { customElementUrl: elementModuleUrl, controllerUrl: controllerModuleUrl, domUrl: domModuleUrl });

  expect(result.directIdCount).toBe(12);
  expect(result.directRootsAfterDestroy).toBe(0);
  expect(new Set(result.describedIds).size).toBe(2);
  expect(result.internalValues).toEqual(["xyone", "two"]);
  expect(result.updateDocuments).toEqual(["xone", "xyone"]);
  expect(result.ownedReconnect).toEqual({
    value: "xyone",
    replacedController: true,
    noDisconnectedUpdate: true
  });
  expect(result.externalReconnect).toEqual({
    value: "offline assignment",
    controllerValue: "offline assignment",
    sameController: true,
    noDisconnectedUpdate: true
  });
  expect(result.viewDestroyCalls).toBe(1);
  expect(result.externalDestroyCalls).toBe(0);
});

test("DOM compatibility: delayed, failed, duplicated, and out-of-order worker service responses stay contained", async ({ page }) => {
  await page.goto("./?fixture=editor");
  const result = await page.evaluate(async ({ moduleUrl }) => {
    const { createEditor } = await import(moduleUrl) as typeof import("@mewhhaha/wx-dom");
    const workerSource = `
      self.onmessage = ({ data }) => {
        const respond = (payload) => self.postMessage({ id: data.id, ...payload });
        if (data.id === 1) setTimeout(() => { respond({ items: [{ label: "stale" }] }); respond({ items: [{ label: "stale duplicate" }] }); }, 40);
        if (data.id === 2) setTimeout(() => { respond({ items: [{ label: "fresh" }] }); respond({ items: [{ label: "fresh duplicate" }] }); }, 5);
        if (data.id === 3) setTimeout(() => { respond({ error: "service failed" }); respond({ error: "duplicate failure" }); }, 5);
      };
    `;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    const worker = new Worker(workerUrl);
    let nextRequestId = 0;
    const pending = new Map<number, {
      resolve(items: readonly import("@mewhhaha/wx-language").EditorCompletionItem[]): void;
      reject(error: Error): void;
    }>();
    worker.addEventListener("message", (event: MessageEvent<{ id: number; items?: readonly import("@mewhhaha/wx-language").EditorCompletionItem[]; error?: string }>) => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data.items ?? []);
    });

    const mount = document.createElement("div");
    document.body.append(mount);
    const editor = createEditor(mount, {
      value: "completion",
      languageServices: {
        completion: {
          complete() {
            const id = ++nextRequestId;
            worker.postMessage({ id });
            return new Promise((resolveRequest, rejectRequest) => {
              pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
            });
          }
        }
      }
    });

    const delayed = editor.controller.requestCompletion();
    const newer = editor.controller.requestCompletion();
    const requestResults = await Promise.all([delayed, newer]);
    await new Promise((resolveDuplicates) => setTimeout(resolveDuplicates, 30));
    const freshItems = editor.controller.getPresentationState().ui.completion.items.map((item) => item.label);
    const freshPopup = mount.querySelector(".wx-editor__command-completion")?.textContent ?? "";
    const failureResult = await editor.controller.requestCompletion();
    const failureState = editor.controller.getPresentationState().ui.completion;
    const bottomMessage = editor.controller.getPresentationState().ui.bottomMessage?.text ?? "";

    worker.terminate();
    URL.revokeObjectURL(workerUrl);
    editor.destroy();
    mount.remove();
    return {
      requestResults,
      freshItems,
      freshPopup,
      failureResult,
      failureError: failureState.error,
      bottomMessage,
      pendingRequests: pending.size
    };
  }, { moduleUrl: domModuleUrl });

  expect(result.requestResults).toEqual([false, true]);
  expect(result.freshItems).toEqual(["fresh"]);
  expect(result.freshPopup).toContain("fresh");
  expect(result.failureResult).toBe(false);
  expect(result.failureError).toBe("No completions");
  expect(result.bottomMessage).toContain("No completions");
  expect(result.pendingRequests).toBe(0);
});

test("DOM compatibility: hidden-tab signals, focus loss, and background return preserve input", async ({ page, context }) => {
  await page.goto(`./?fixture=editor&src=${encodeURIComponent("background")}`);
  const root = page.locator("[data-wx-editor='root']").first();
  const input = page.locator("[data-wx-editor='input']").first();
  await page.evaluate(() => {
    (window as Window & { __wxVisibilityStates?: string[] }).__wxVisibilityStates = [document.visibilityState];
    document.addEventListener("visibilitychange", () => {
      (window as Window & { __wxVisibilityStates?: string[] }).__wxVisibilityStates?.push(document.visibilityState);
    });
    const button = document.createElement("button");
    button.id = "background-focus-target";
    button.textContent = "background focus target";
    document.body.append(button);
  });

  await root.click();
  await page.keyboard.press("i");
  await page.keyboard.type("before ");
  await page.keyboard.press("Escape");
  await page.locator("#background-focus-target").focus();
  await expect(input).not.toBeFocused();

  const backgroundPage = await context.newPage();
  await backgroundPage.goto("data:text/html,<title>background tab</title><p>background</p>");
  await backgroundPage.bringToFront();
  const observedRealHidden = await page.evaluate(() => document.visibilityState === "hidden");
  if (!observedRealHidden) {
    // Headless engines can keep every renderer visible even after
    // bringToFront(). Exercise the same browser lifecycle signal explicitly so
    // state restoration remains covered on those runners.
    await page.evaluate(() => {
      const scope = window as Window & { __wxTestVisibilityState?: DocumentVisibilityState };
      scope.__wxTestVisibilityState = "hidden";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => scope.__wxTestVisibilityState
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => scope.__wxTestVisibilityState === "hidden"
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
    });
  }
  await page.bringToFront();
  await page.evaluate(() => {
    const scope = window as Window & { __wxTestVisibilityState?: DocumentVisibilityState };
    if (scope.__wxTestVisibilityState) {
      scope.__wxTestVisibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    }
  });
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe("visible");
  await backgroundPage.close();

  await root.click();
  await page.keyboard.press("i");
  await page.keyboard.type("after ");
  await page.keyboard.press("Escape");
  await expect(root).toContainText("before after background");
  const visibilityStates = await page.evaluate(
    () => (window as Window & { __wxVisibilityStates?: string[] }).__wxVisibilityStates ?? []
  );
  expect(visibilityStates).toContain("hidden");
  expect(visibilityStates.at(-1)).toBe("visible");
});
