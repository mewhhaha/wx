import { describe, expect, it } from "vitest";

import { getSelectionOffsets } from "@whx/editor-core";
import { createEditorController } from "@whx/editor-controller";
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

  it("renders only a viewport slice for large files", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n") });

    expect(container.querySelectorAll("[data-whx-editor-row]").length).toBeLessThan(80);
    expect(container.querySelector('[data-whx-editor-row="150"]')).toBeNull();
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

  it("scrolls to keep the cursor visible during keyboard movement", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n")
    });

    const surface = container.querySelector("[data-whx-editor='surface']") as HTMLDivElement;
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;
    const targetRow = container.querySelector('[data-whx-editor-row="12"]') as HTMLDivElement;

    Object.defineProperty(surface, "clientHeight", { value: 80, configurable: true });
    Object.defineProperty(targetRow, "offsetTop", { value: 220, configurable: true });
    Object.defineProperty(targetRow, "offsetHeight", { value: 24, configurable: true });

    for (let index = 0; index < 11; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    expect(surface.scrollTop).toBeGreaterThan(0);
  });

  it("scrolls to keep the cursor visible after yank then paste", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const value = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
    const editor = createEditor(container, { value });
    const surface = container.querySelector("[data-whx-editor='surface']") as HTMLDivElement;
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    Object.defineProperty(surface, "clientHeight", { value: 80, configurable: true });

    for (let index = 0; index < 11; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    expect(surface.scrollTop).toBeGreaterThan(0);
    const beforePasteScrollTop = surface.scrollTop;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(editor.getState().doc.text).toContain("lline 11");
    expect(container.querySelector('[data-whx-editor-row="12"]')).not.toBeNull();
    expect(surface.scrollTop).toBeGreaterThanOrEqual(beforePasteScrollTop);
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

  it("routes o and O through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha\nbeta" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "o", bubbles: true }));
    expect(editor.getState().mode).toBe("insert");
    expect(editor.getState().doc.text).toBe("alpha\n\nbeta");
    expect(container.querySelector("[data-whx-editor-status-mode='true']")?.textContent).toBe("INS");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 6, to: 7 });

    editor.setValue("alpha\nbeta");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "O", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(editor.getState().doc.text).toBe("alpha\nz\nbeta");
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 6, to: 7 });
  });

  it("routes u, U, and x through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha\nbeta\ngamma" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 6 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 11 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "!", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(editor.getState().doc.text).toBe("!alpha\nbeta\ngamma");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "u", bubbles: true }));
    expect(editor.getState().doc.text).toBe("alpha\nbeta\ngamma");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "U", bubbles: true }));
    expect(editor.getState().doc.text).toBe("!alpha\nbeta\ngamma");
  });

  it("applies syntax highlighting on initial open without needing an edit", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: "const value = 1;",
      language: createStubLanguage([{ from: 0, to: 5, role: "keyword" }])
    });

    await Promise.resolve();
    await Promise.resolve();

    const keywordCells = [
      ...container.querySelectorAll('[data-whx-editor-content="1"] .whx-role-keyword')
    ].map((node) => node.textContent).join("");
    expect(keywordCells.startsWith("const")).toBe(true);
  });

  it("keeps a stable placeholder cell on empty lines for cursor rendering", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "one\n\ntwo" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    expect(container.querySelector('[data-whx-editor-content="2"]')?.textContent).toBe("\u00a0");
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.textContent).toBe("\u00a0");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    expect(container.querySelector('[data-whx-editor-content="2"]')?.textContent).toContain("\u00a0");
    expect(container.querySelector("[data-whx-editor-cursor='true']")?.getAttribute("data-whx-editor-cursor-kind")).toBe("line");

    editor.focus();
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

  it("requests highlight ranges only for the affected edit window", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const requests: Array<{ fromLine: number; toLine: number }> = [];
    createEditor(container, {
      value: Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n"),
      language: {
        async open() {},
        async update() {},
        async getHighlightRanges(viewport) {
          requests.push(viewport);
          return [];
        }
      }
    });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    await Promise.resolve();
    await Promise.resolve();
    expect(requests[0]?.fromLine).toBe(0);
    expect(requests[0]?.toLine).toBeLessThan(50);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    const latestRequest = requests.at(-1);
    expect(latestRequest?.fromLine).toBe(0);
    expect(latestRequest?.toLine).toBeLessThan(50);
  });

  it("does not request a full-file highlight refresh for line-structure edits", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const requests: Array<{ fromLine: number; toLine: number }> = [];
    createEditor(container, {
      value: Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n"),
      language: {
        async open() {},
        async update() {},
        async getHighlightRanges(viewport) {
          requests.push(viewport);
          return [];
        }
      }
    });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    await Promise.resolve();
    await Promise.resolve();
    expect(requests[0]?.fromLine).toBe(0);
    expect(requests[0]?.toLine).toBeLessThan(40);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    const latestRequest = requests.at(-1);
    expect(latestRequest?.fromLine).toBe(0);
    expect(latestRequest?.toLine).toBeLessThan(50);
  });

  it("keeps existing highlights visible while a newline update is still in flight", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    let resolveUpdate: (() => void) | null = null;
    createEditor(container, {
      value: "const value = 1;",
      language: {
        async open() {},
        async update() {
          await new Promise<void>((resolve) => {
            resolveUpdate = resolve;
          });
        },
        async getHighlightRanges() {
          return [{ from: 0, to: 5, role: "keyword" }];
        }
      }
    });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    await Promise.resolve();
    await Promise.resolve();
    const initialKeywordText = [...container.querySelectorAll(".whx-role-keyword")]
      .map((node) => node.textContent)
      .join("");
    expect(initialKeywordText).toContain("const");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    const keywordTextDuringUpdate = [
      ...container.querySelectorAll(".whx-role-keyword")
    ].map((node) => node.textContent).join("");
    expect(keywordTextDuringUpdate).toContain("const");

    resolveUpdate?.();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("keeps using a viewport slice after a newline inserted at the top", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n")
    });

    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelectorAll("[data-whx-editor-row]").length).toBeLessThan(80);
    expect(container.querySelector('[data-whx-editor-row="151"]')).toBeNull();
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

  it("keeps Escape at the start of a line on that same line", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha\nbeta" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 1,
      column: 0
    });
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

  it("routes d through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abcd" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));

    expect(editor.getState().doc.text).toBe("a");
    expect(editor.getState().mode).toBe("normal");
    expect(editor.getState().yankBuffer).toBe("bcd");
  });

  it("restores deleted text with d then p through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abcd" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(editor.getState().doc.text).toBe("abcd");
  });

  it("routes ma' and mi' through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "const value = 'hello';" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    for (let index = 0; index < 15; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    }

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "'", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 14, to: 21 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "'", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 15, to: 20 });
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

  it("routes w, W, B, and E through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha += beta gamma" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 6, to: 7 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "W", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 9, to: 10 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "B", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 6, to: 7 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "E", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 7, to: 8 });
  });

  it("routes f, t, F, T and Alt-. through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc\ndef\nghe" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 5, to: 6 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ".", altKey: true, bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 10, to: 11 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "T", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 1, to: 2 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 4, to: 5 });
  });

  it("routes paragraph motions through [p and ]p", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha\nbeta\n\n\ngamma\ndelta\n\nepsilon" });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "]", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).line).toBe(4);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "[", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).line).toBe(0);
  });

  it("routes Home, End, PageDown, Ctrl-d, gt, gc, gb, and mm through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: Array.from({ length: 20 }, (_, index) => `line ${index} (value)`).join("\n")
    });
    const surface = container.querySelector("[data-whx-editor='surface']") as HTMLDivElement;
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    Object.defineProperty(surface, "clientHeight", { value: 96, configurable: true });

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).column).toBeGreaterThan(0);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).column).toBe(0);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).line).toBeGreaterThanOrEqual(3);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).line).toBeGreaterThanOrEqual(5);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).line).toBeGreaterThanOrEqual(0);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    const centerLine = editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).line;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    const bottomLine = editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).line;
    expect(bottomLine).toBeGreaterThanOrEqual(centerLine);

    editor.setValue("fn(alpha[beta])");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 14, to: 15 });
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
    expect(firstRowSelectedTokens.some((token) => token.textContent === "\u00a0")).toBe(true);
  });

  it("keeps a viewport slice mounted and repeated movement within a sane budget", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const value = Array.from({ length: 2000 }, (_, index) => `const row${index} = ${index};`).join("\n");
    const renderStartedAt = performance.now();
    const editor = createEditor(container, { value });
    const renderElapsed = performance.now() - renderStartedAt;
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    const movementStartedAt = performance.now();

    for (let index = 0; index < 50; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    const movementElapsed = performance.now() - movementStartedAt;

    expect(editor.getState().doc.lineCount).toBe(2000);
    expect(container.querySelectorAll("[data-whx-editor-row]").length).toBeLessThan(80);
    expect(container.querySelector('[data-whx-editor-row="51"]')).not.toBeNull();
    expect(container.querySelector('[data-whx-editor-row="1500"]')).toBeNull();
    expect(renderElapsed).toBeLessThan(4000);
    expect(movementElapsed).toBeLessThan(1000);
  });

  it("rerenders the viewport slice when the surface scroll position changes", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n")
    });

    const surface = container.querySelector("[data-whx-editor='surface']") as HTMLDivElement;
    surface.scrollTop = 24 * 100;
    surface.dispatchEvent(new Event("scroll"));

    expect(container.querySelectorAll("[data-whx-editor-row]").length).toBeLessThan(80);
    expect(container.querySelector('[data-whx-editor-row="101"]')).not.toBeNull();
    expect(container.querySelector('[data-whx-editor-row="1"]')).toBeNull();
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

  it("subscribes hosts to controller-backed updates without polling", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const updates: string[] = [];
    const unsubscribe = editor.subscribe((update) => {
      if (update.selectionChanged) {
        updates.push("selection");
      }
    });
    const textarea = container.querySelector("[data-whx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    unsubscribe();

    expect(updates).toEqual(["selection"]);
  });

  it("renders from an externally owned controller", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const controller = createEditorController({ value: "abc" });
    createEditor(container, { controller });

    controller.execute((state, dispatch) => {
      dispatch({ selection: { ...state.selection, ranges: [{ ...state.selection.ranges[0]!, head: 1, anchor: 1 }] } });
      return true;
    });

    expect(container.querySelector("[data-whx-editor-cursor='true']")?.textContent).toBe("b");
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
