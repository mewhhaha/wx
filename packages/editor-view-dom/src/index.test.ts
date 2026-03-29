import { describe, expect, it } from "vitest";

import { getSelectionOffsets } from "@whx/editor-core";
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

  it("preserves unaffected row DOM identity during movement", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n") });
    const rowsRoot = container.querySelector("[data-whx-editor='rows']");
    const farRowBefore = container.querySelector('[data-whx-editor-row="15"]');

    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));

    expect(container.querySelector("[data-whx-editor='rows']")).toBe(rowsRoot);
    expect(container.querySelector('[data-whx-editor-row="15"]')).toBe(farRowBefore);
  });

  it("moves the cursor with mouse wheel scrolling", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "one\ntwo\nthree" });
    const surface = container.querySelector("[data-whx-editor='surface']") as HTMLDivElement;

    surface.dispatchEvent(new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 1,
      column: 0
    });

    surface.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, bubbles: true, cancelable: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 0,
      column: 0
    });
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

  it("does not resync the language document for cursor-only movement", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    let openCalls = 0;
    let updateCalls = 0;
    const editor = createEditor(container, {
      value: "abc\ndef",
      language: {
        async open() {
          openCalls += 1;
        },
        async update() {
          updateCalls += 1;
        },
        async getHighlightRanges() {
          return [];
        }
      }
    });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    await Promise.resolve();
    expect(openCalls).toBe(1);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    await Promise.resolve();

    expect(updateCalls).toBe(0);
    expect(openCalls).toBe(1);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await Promise.resolve();

    expect(openCalls + updateCalls).toBeGreaterThanOrEqual(2);
    expect(editor.getState().doc.text).toBe("abc\nxdef");
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
    expect(container.querySelectorAll(".whx-is-selected").length).toBeGreaterThan(0);

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

  it("routes y and p through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(editor.getState().doc.text).toBe("abbc");
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.textContent).toBe("b");
    expect(editor.getState().mode).toBe("normal");
  });

  it("routes %, gg, ge, gh, gl, and gs through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc\ndef" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "%", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 7 });

    editor.setValue("abc\ndef");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 1 });

    editor.setValue("abc\ndef");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 1 });

    editor.setValue("abc\ndef");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 4, to: 5 });

    editor.setValue("abc\ndef");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 4, to: 5 });

    editor.setValue("abc\ndef");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 1 });

    editor.setValue("abc\ndef");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 2, to: 3 });
  });

  it("renders a visible selected cell when the newline is selected", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "abc\ndef" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));

    const firstRowSelectedTokens = [
      ...(container.querySelector('[data-whx-editor-content="1"]')?.querySelectorAll(".whx-is-selected") ?? [])
    ] as HTMLElement[];
    expect(firstRowSelectedTokens.some((token) => token.textContent === " ")).toBe(true);
  });

  it("keeps all rows mounted and repeated movement within a sane budget", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const value = Array.from({ length: 2000 }, (_, index) => `const row${index} = ${index};`).join("\n");
    const renderStartedAt = performance.now();
    const editor = createEditor(container, { value });
    const renderElapsed = performance.now() - renderStartedAt;
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;
    const farRowBefore = container.querySelector('[data-whx-editor-row="1500"]');

    const movementStartedAt = performance.now();

    for (let index = 0; index < 50; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    const movementElapsed = performance.now() - movementStartedAt;

    expect(editor.getState().doc.lineCount).toBe(2000);
    expect(container.querySelectorAll("[data-whx-editor-row]").length).toBe(2000);
    expect(container.querySelector('[data-whx-editor-row="1500"]')).toBe(farRowBefore);
    expect(renderElapsed).toBeLessThan(4000);
    expect(movementElapsed).toBeLessThan(1000);
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

  it("routes Alt+ArrowUp and Alt+ArrowDown through tree-sitter-aware syntax selection", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: "const value = greet(user);",
      language: {
        async open() {},
        async update() {},
        async getHighlightRanges() {
          return [];
        },
        async expandSelection() {
          return { from: 14, to: 25 };
        },
        async shrinkSelection(selection) {
          return selection.to - selection.from > 5 ? { from: 14, to: 19 } : { from: 14, to: 15 };
        }
      }
    });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
    await Promise.resolve();
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 14, to: 25 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    await Promise.resolve();
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 14, to: 19 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    await Promise.resolve();
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 14, to: 15 });
  });
});
