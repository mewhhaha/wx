import { describe, expect, it } from "vitest";

import type { HighlightSpan, LanguageProvider } from "@whx/editor-language";

import { createEditor } from "./index";

function createStubLanguage(highlights: HighlightSpan[] = []): LanguageProvider {
  return {
    async open() {},
    async update() {},
    async getHighlightRanges() {
      return highlights;
    }
  };
}

describe("createEditor", () => {
  it("renders rows and gutters", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "one\ntwo" });

    expect(container.querySelectorAll("[data-whx-editor-row]").length).toBe(2);
    expect(container.querySelector('[data-whx-editor-gutter="2"]')?.textContent).toBe("2");
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.textContent).toBe("o");
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.getAttribute("data-whx-editor-cursor-kind")).toBe("block");
    expect(container.querySelector("[data-whx-editor-status-mode='true']")?.textContent).toBe("NOR");
  });

  it("moves the cursor with hjkl and arrow keys", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "one\ntwo" });
    const input = container.querySelector("[data-whx-editor='input'], [data-whx-editor='root']") as HTMLElement | null;
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));

    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 1,
      column: 1
    });
    expect(input).not.toBeNull();
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.textContent).toBe("w");
    expect(container.querySelector("[data-whx-editor-status-meta='true']")?.textContent).toContain("2:2");
  });

  it("supports insert mode typing and escape", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: "abc",
      language: createStubLanguage([{ from: 0, to: 3, role: "string" }])
    });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.getAttribute("data-whx-editor-cursor-kind")).toBe("line");
    expect(container.querySelector("[data-whx-editor-status-mode='true']")?.textContent).toBe("INS");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(editor.getState().doc.text).toBe("xabc");
    expect(editor.getState().mode).toBe("normal");
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.getAttribute("data-whx-editor-cursor-kind")).toBe("block");
    expect(container.querySelector("[data-whx-editor-status-mode='true']")?.textContent).toBe("NOR");
  });

  it("keeps the original glyph selected after a then escape", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.getAttribute("data-whx-editor-cursor-kind")).toBe("line");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(editor.getState().mode).toBe("normal");
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.textContent).toBe("b");
  });

  it("routes a, v, e, and b through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha beta gamma" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    expect(container.querySelectorAll(".whx-token--selected").length).toBeGreaterThan(0);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-status-mode='true']")?.textContent).toBe("VIS");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-content='1']")?.textContent).toContain("alpha beta");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-status-mode='true']")?.textContent).toBe("VIS");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-status-mode='true']")?.textContent).toBe("INS");
  });

  it("opens the bottom-row command runner with : and dismisses it with Escape or Enter", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-command-prompt='true']")?.textContent).toBe(":");
    expect(container.querySelector("[data-whx-editor-command-text='true']")?.textContent).toBe("");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-command-text='true']")?.textContent).toBe("wq");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-command-prompt='true']")).toBeNull();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(container.querySelector("[data-whx-editor-command-prompt='true']")).toBeNull();
  });
});
