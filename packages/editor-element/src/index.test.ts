import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorController, type EditorUpdate } from "@mewhhaha/wx-controller";

import { WxEditorElement, defineWxEditorElement } from "./index";

const TEST_TAG = "wx-editor-test";

defineWxEditorElement(TEST_TAG);

afterEach(() => {
  document.body.replaceChildren();
});

describe("WxEditorElement", () => {
  it("emits update, mode, and selection events", async () => {
    const element = document.createElement(TEST_TAG) as WxEditorElement;
    element.value = "abc";
    document.body.append(element);

    const updates: EditorUpdate[] = [];
    const modes: string[] = [];
    const selections: number[] = [];
    element.addEventListener("wx-update", (event) => {
      updates.push((event as CustomEvent<EditorUpdate>).detail);
    });
    element.addEventListener("wx-mode-change", (event) => {
      modes.push((event as CustomEvent<string>).detail);
    });
    element.addEventListener("wx-selection-change", (event) => {
      selections.push((event as CustomEvent<{ ranges: Array<{ head: number }> }>).detail.ranges[0]?.head ?? -1);
    });

    const textarea = element.shadowRoot?.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));

    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(modes).toContain("insert");
    expect(selections).toContain(1);
  });

  it("treats a supplied controller as the value source and preserves it across reconnect", () => {
    const controller = createEditorController({ value: "abc" });
    const element = document.createElement(TEST_TAG) as WxEditorElement;
    element.controller = controller;
    document.body.append(element);

    expect(element.value).toBe("abc");

    controller.execute((state, dispatch) => {
      dispatch({ selection: { ...state.selection, ranges: [{ ...state.selection.ranges[0]!, anchor: 1, head: 1 }] } });
      return true;
    });

    expect(element.shadowRoot?.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("b");

    element.remove();
    element.value = "offline";
    document.body.append(element);

    expect(element.value).toBe("offline");
    expect(controller.getState().doc.text).toBe("offline");
  });

  it("reflects external assignment and ordered internal edits, drops disconnected updates, and recreates owned controllers", async () => {
    const element = document.createElement(TEST_TAG) as WxEditorElement;
    element.value = "seed";
    document.body.append(element);
    const updates: EditorUpdate[] = [];
    element.addEventListener("wx-update", (event) => updates.push((event as CustomEvent<EditorUpdate>).detail));
    const textarea = element.shadowRoot?.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: "x", inputType: "insertText" }));
    textarea.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: "y", inputType: "insertText" }));
    await Promise.resolve();

    expect(element.value).toBe("xyseed");
    const changedDocuments = updates.reduce<string[]>((documents, update) => {
      const text = update.nextState.doc.text;
      if (text !== (documents.at(-1) ?? "seed")) documents.push(text);
      return documents;
    }, []);
    expect(changedDocuments).toEqual(["xseed", "xyseed"]);
    const ownedController = element.controller!;
    const updateCount = updates.length;
    element.remove();
    ownedController.execute((_state, dispatch) => { dispatch({ mode: "insert" }); return true; });
    expect(updates).toHaveLength(updateCount);

    document.body.append(element);
    expect(element.value).toBe("xyseed");
    expect(element.controller).not.toBeNull();
    expect(element.controller).not.toBe(ownedController);
  });

  it("does not destroy externally owned language services on disconnect", () => {
    const destroy = vi.fn();
    const services = {
      lifecycle: {
        state: "ready" as const,
        owner: "external" as const,
        destroy
      }
    };
    const first = document.createElement(TEST_TAG) as WxEditorElement;
    const second = document.createElement(TEST_TAG) as WxEditorElement;
    first.languageServices = services;
    second.languageServices = services;
    document.body.append(first, second);

    first.remove();
    second.remove();
    expect(destroy).not.toHaveBeenCalled();
  });
});
