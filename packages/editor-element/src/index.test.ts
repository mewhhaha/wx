import { afterEach, describe, expect, it } from "vitest";

import { createEditorController, type EditorUpdate } from "@whx/editor-controller";

import { WhxEditorElement, defineWhxEditorElement } from "./index";

const TEST_TAG = "whx-editor-test";

defineWhxEditorElement(TEST_TAG);

afterEach(() => {
  document.body.replaceChildren();
});

describe("WhxEditorElement", () => {
  it("emits update, mode, and selection events", async () => {
    const element = document.createElement(TEST_TAG) as WhxEditorElement;
    element.value = "abc";
    document.body.append(element);

    const updates: EditorUpdate[] = [];
    const modes: string[] = [];
    const selections: number[] = [];
    element.addEventListener("whx-update", (event) => {
      updates.push((event as CustomEvent<EditorUpdate>).detail);
    });
    element.addEventListener("whx-mode-change", (event) => {
      modes.push((event as CustomEvent<string>).detail);
    });
    element.addEventListener("whx-selection-change", (event) => {
      selections.push((event as CustomEvent<{ ranges: Array<{ head: number }> }>).detail.ranges[0]?.head ?? -1);
    });

    const textarea = element.shadowRoot?.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));

    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(modes).toContain("insert");
    expect(selections).toContain(1);
  });

  it("preserves externally owned controller state across reconnect", () => {
    const controller = createEditorController({ value: "abc" });
    const element = document.createElement(TEST_TAG) as WhxEditorElement;
    element.controller = controller;
    document.body.append(element);

    controller.execute((state, dispatch) => {
      dispatch({ selection: { ...state.selection, ranges: [{ ...state.selection.ranges[0]!, anchor: 1, head: 1 }] } });
      return true;
    });

    expect(element.shadowRoot?.querySelector("[data-whx-editor-cursor='true']")?.textContent).toBe("b");

    element.remove();
    document.body.append(element);

    expect(element.shadowRoot?.querySelector("[data-whx-editor-cursor='true']")?.textContent).toBe("b");
  });
});
