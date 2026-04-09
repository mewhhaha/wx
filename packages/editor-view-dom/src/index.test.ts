import { describe, expect, it, vi } from "vitest";

import { createCharacterSelection, createTextDocument, getSelectionOffsets } from "@wx/editor-core";
import { createEditorController } from "@wx/editor-controller";
import type { HighlightSpan, LanguageProvider } from "@wx/editor-language";

import { createEditor } from "./index";

async function flushAsyncWork(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function keywordText(container: HTMLElement): string {
  return [...container.querySelectorAll(".wx-role-keyword")]
    .map((node) => node.textContent ?? "")
    .join("");
}

function createStubLanguage(highlights: HighlightSpan[] = []): LanguageProvider {
  return {
    async open() {},
    async update() {},
    async getHighlightRanges() {
      return highlights;
    }
  };
}

function visibleRows(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>("[data-wx-editor-row]")]
    .map((row) => Number(row.dataset.wxEditorRow))
    .filter((row) => !Number.isNaN(row));
}

describe("createEditor", () => {
  it("renders rows and gutters", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "one\ntwo" });

    expect(container.querySelectorAll("[data-wx-editor-row]").length).toBe(2);
    expect(container.querySelector('[data-wx-editor-gutter="2"]')?.textContent).toBe("2");
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("o");
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.getAttribute("data-wx-editor-cursor-kind")).toBe("block");
    expect(container.querySelector("[data-wx-editor-status-mode='true']")?.textContent).toBe("NOR");
  });

  it("moves the cursor with hjkl and arrow keys", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "one\ntwo" });
    const input = container.querySelector("[data-wx-editor='input'], [data-wx-editor='root']") as HTMLElement | null;
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));

    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 1,
      column: 1
    });
    expect(input).not.toBeNull();
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("w");
    expect(container.querySelector("[data-wx-editor-status-meta='true']")?.textContent).toContain("2:2");
  });

  it("supports count prefixes for normal mode commands", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "one\ntwo\nthree\nfour\nfive" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));

    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 3,
      column: 0
    });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));

    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 3,
      column: 2
    });
  });

  it("opens jump target mode on comma and labels matching visible cells after a target character", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha beta\ngamma delta" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ",", bubbles: true }));

    expect(container.querySelector("[data-wx-editor-flash-hint]")).toBeNull();
    expect(container.querySelector("[data-wx-editor-prefix-hint='flash-target']")?.textContent).toBe(",");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));

    expect(container.querySelectorAll("[data-wx-editor-flash-hint]")).toHaveLength(1);
    expect(container.querySelector("[data-wx-editor-prefix-hint='flash']")?.textContent).toBe(",b");
    expect(container.querySelector("[data-wx-editor-cursor='true']")).not.toBeNull();
    expect(container.querySelector(".wx-flash-target")).not.toBeNull();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));

    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 0,
      column: 6
    });
    expect(container.querySelector("[data-wx-editor-flash-hint]")).toBeNull();
  });

  it("renders distinct labels for multiple visible flash targets", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "ta ta ta ta\nta ta ta ta" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ",", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));

    const labels = [...container.querySelectorAll<HTMLElement>("[data-wx-editor-flash-hint]")]
      .map((node) => node.dataset.wxEditorFlashHint ?? node.textContent ?? "");

    expect(labels.length).toBeGreaterThan(3);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("closes visible jump labels on escape", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "alpha beta\ngamma delta" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ",", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-flash-hint]")).not.toBeNull();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-flash-hint]")).toBeNull();
  });

  it("refines duplicate jump labels by remapping only the matching subgroup", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(
      container,
      { value: Array.from({ length: 30 }, () => "a").join(" ") }
    );
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ",", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(container.querySelector("[data-wx-editor-prefix-hint='flash']")?.textContent).toBe(",a a");
    expect(container.querySelectorAll("[data-wx-editor-flash-hint]")).toHaveLength(2);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 0,
      column: 2
    });
    expect(container.querySelector("[data-wx-editor-flash-hint]")).toBeNull();
  });

  it("renders only a viewport slice for large files", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n") });

    expect(container.querySelectorAll("[data-wx-editor-row]").length).toBeLessThan(80);
    expect(container.querySelector('[data-wx-editor-row="150"]')).toBeNull();
  });

  it("moves by visual rows when soft wrap is enabled", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: "abcdefghijklmnopqrstuvwxyz",
      softWrap: true
    });
    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    Object.defineProperty(surface, "clientWidth", { value: 120, configurable: true });
    editor.mount(container);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    const movedPosition = editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0);
    expect(movedPosition.line).toBe(0);
    expect(movedPosition.column).toBeGreaterThan(0);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 0,
      column: 0
    });
  });

  it("keeps EOF filler rows after wrapped content", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "abcdefghijklmnopqrstuvwxyz", softWrap: true });
    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    Object.defineProperty(surface, "clientWidth", { value: 120, configurable: true });
    Object.defineProperty(surface, "clientHeight", { value: 240, configurable: true });
    surface.dispatchEvent(new Event("scroll"));

    expect(container.querySelector("[data-wx-editor-filler-row]")?.textContent).toContain("~");
    expect(container.querySelector("[data-wx-editor-filler-row] .wx-editor__gutter-number")?.textContent).toBe("~");
    expect(container.querySelector('[data-wx-editor-filler-row="1"] .wx-editor__gutter-number')?.textContent).toBe(" ");
  });

  it("renders indent guides in leading whitespace after skipped levels", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: "  alpha\n    beta",
      indentGuides: {
        render: true,
        character: "╎",
        skipLevels: 1
      }
    });

    expect(container.querySelector('[data-wx-editor-content="1"] .wx-indent-guide')).toBeNull();
    expect(container.querySelector('[data-wx-editor-content="2"] .wx-indent-guide')?.textContent).toBe("╎");
  });

  it("scrolls the viewport with mouse wheel input without moving the cursor", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n")
    });
    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;

    Object.defineProperty(surface, "clientHeight", { value: 80, configurable: true });
    editor.mount(container);

    surface.dispatchEvent(new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true }));
    expect(visibleRows(container)[0]).toBe(2);
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 0,
      column: 0
    });

    surface.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, bubbles: true, cancelable: true }));
    expect(visibleRows(container)[0]).toBe(1);
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 0,
      column: 0
    });
  });

  it("scrolls to keep the cursor visible during keyboard movement", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n")
    });

    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;

    Object.defineProperty(surface, "clientHeight", { value: 80, configurable: true });
    editor.mount(container);

    for (let index = 0; index < 11; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    expect(visibleRows(container)).toContain(12);
    expect(visibleRows(container)).not.toContain(1);
  });

  it("keeps three preview rows below the cursor when possible before scrolling", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n")
    });

    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    Object.defineProperty(surface, "clientHeight", { value: 240, configurable: true });
    editor.mount(container);

    for (let index = 0; index < 5; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    expect(visibleRows(container)[0]).toBe(1);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    expect(visibleRows(container)[0]).toBe(2);
  });

  it("does not keep scrolling when moving back up while the cursor is still on screen", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n")
    });

    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    Object.defineProperty(surface, "clientHeight", { value: 240, configurable: true });

    for (let index = 0; index < 8; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    const beforeMoveUp = visibleRows(container)[0];
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));

    expect(visibleRows(container)[0]).toBeLessThanOrEqual(beforeMoveUp);
  });

  it("reveals the initial cursor after mount when the selection starts below the fold", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const value = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const targetOffset = value.indexOf("line 20");
    createEditor(container, {
      controller: createEditorController({
        value,
        selection: createCharacterSelection(createTextDocument(value), Math.max(0, targetOffset))
      })
    });

    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    Object.defineProperty(surface, "clientHeight", { value: 80, configurable: true });

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(visibleRows(container)).toContain(21);
    expect(visibleRows(container)).not.toContain(1);
  });

  it("scrolls to keep the cursor visible after yank then paste", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const value = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
    const editor = createEditor(container, { value });
    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    Object.defineProperty(surface, "clientHeight", { value: 80, configurable: true });

    for (let index = 0; index < 11; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    const beforePasteTopRow = visibleRows(container)[0];

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(editor.getState().doc.text).toContain("lline 11");
    expect(container.querySelector('[data-wx-editor-row="12"]')).not.toBeNull();
    expect(visibleRows(container)[0]).toBeGreaterThanOrEqual(beforePasteTopRow);
  });

  it("supports insert mode typing and escape", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: "abc",
      language: createStubLanguage([{ from: 0, to: 3, role: "string" }])
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.getAttribute("data-wx-editor-cursor-kind")).toBe("line");
    expect(container.querySelector("[data-wx-editor-status-mode='true']")?.textContent).toBe("INS");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(editor.getState().doc.text).toBe("xabc");
    expect(editor.getState().mode).toBe("normal");
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.getAttribute("data-wx-editor-cursor-kind")).toBe("block");
    expect(container.querySelector("[data-wx-editor-status-mode='true']")?.textContent).toBe("NOR");
  });

  it("shows the line cursor when append enters insert mode at the end of a line", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(container.querySelector("[data-wx-editor-cursor='true']")?.getAttribute("data-wx-editor-cursor-kind")).toBe("line");
    expect(container.querySelector("[data-wx-editor-status-mode='true']")?.textContent).toBe("INS");
  });

  it("inserts indentation spaces in insert mode when tab is pressed", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(editor.getState().doc.text).toBe("  abc");
  });

  it("removes one soft tab of leading indentation with backspace", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    expect(editor.getState().doc.text).toBe("");
  });

  it("removes only one soft tab when multiple indentation levels are present", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));

    expect(editor.getState().doc.text).toBe("  ");
  });

  it("undos a whole insert session in one step after escape", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(editor.getState().doc.text).toBe("xyabc");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "u", bubbles: true }));
    expect(editor.getState().doc.text).toBe("abc");
  });

  it("splits insert undo history with Ctrl-s checkpoints", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(editor.getState().doc.text).toBe("xyabc");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "u", bubbles: true }));
    expect(editor.getState().doc.text).toBe("xabc");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "u", bubbles: true }));
    expect(editor.getState().doc.text).toBe("abc");
  });

  it("keeps existing highlight classes visible during undo before async refresh completes", () => {
    const container = document.createElement("div");
    document.body.append(container);

    let resolveOpen: (() => void) | null = null;
    let openCalls = 0;
    const editor = createEditor(container, {
      value: "abc",
      language: {
        async open() {
          openCalls += 1;
          if (openCalls > 1) {
            await new Promise<void>((resolve) => {
              resolveOpen = resolve;
            });
          }
        },
        async update() {},
        async getHighlightRanges() {
          return [{ from: 0, to: 3, role: "string" }];
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    return (async () => {
      await flush();

      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "u", bubbles: true }));

      expect(container.querySelector(".wx-role-string")).not.toBeNull();

      resolveOpen?.();
      await flush();
      expect(editor.getState().doc.text).toBe("abc");
    })();
  });

  it("routes o and O through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha\nbeta" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "o", bubbles: true }));
    expect(editor.getState().mode).toBe("insert");
    expect(editor.getState().doc.text).toBe("alpha\n\nbeta");
    expect(container.querySelector("[data-wx-editor-status-mode='true']")?.textContent).toBe("INS");

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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

  it("routes c through the DOM key handler and enters insert mode", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abcd" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));

    expect(editor.getState().doc.text).toBe("a");
    expect(editor.getState().mode).toBe("insert");
    expect(editor.getState().yankBuffer).toBe("bcd");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(editor.getState().doc.text).toBe("ax");
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
      ...container.querySelectorAll('[data-wx-editor-content="1"] .wx-role-keyword')
    ].map((node) => node.textContent).join("");
    expect(keywordCells.startsWith("const")).toBe(true);
  });

  it("keeps a stable placeholder cell on empty lines for cursor rendering", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "one\n\ntwo" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    expect(container.querySelector('[data-wx-editor-content="2"]')?.textContent).toBe("\u00a0");
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("\u00a0");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    expect(container.querySelector('[data-wx-editor-content="2"]')?.textContent).toContain("\u00a0");
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.getAttribute("data-wx-editor-cursor-kind")).toBe("line");

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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

  it("refreshes highlights for newly visible rows after moving the viewport", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const value = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const doc = createTextDocument(value);

    createEditor(container, {
      value,
      language: {
        async open() {},
        async update() {},
        async getHighlightRanges(viewport) {
          const spans: HighlightSpan[] = [];

          for (let line = viewport.fromLine; line <= viewport.toLine; line += 1) {
            const lineInfo = doc.lineAt(line);
            spans.push({ from: lineInfo.start, to: Math.min(lineInfo.end, lineInfo.start + 4), role: "keyword" });
          }

          return spans;
        }
      }
    });

    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    Object.defineProperty(surface, "clientHeight", { value: 80, configurable: true });

    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };

    await flush();

    for (let index = 0; index < 11; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    await flush();

    expect(container.querySelector('[data-wx-editor-row="12"]')).not.toBeNull();
    expect(container.querySelector('[data-wx-editor-row="12"] .wx-role-keyword')).not.toBeNull();
  });

  it("refreshes highlights for newly visible rows after controller viewport scrolling", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const value = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const doc = createTextDocument(value);
    const controller = createEditorController({ value });

    createEditor(container, {
      controller,
      language: {
        async open() {},
        async update() {},
        async getHighlightRanges(viewport) {
          const spans: HighlightSpan[] = [];

          for (let line = viewport.fromLine; line <= viewport.toLine; line += 1) {
            const lineInfo = doc.lineAt(line);
            spans.push({ from: lineInfo.start, to: Math.min(lineInfo.end, lineInfo.start + 4), role: "keyword" });
          }

          return spans;
        }
      }
    });

    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    Object.defineProperty(surface, "clientHeight", { value: 80, configurable: true });

    await Promise.resolve();
    await Promise.resolve();

    controller.scrollViewportBy(11);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('[data-wx-editor-row="12"] .wx-role-keyword')).not.toBeNull();
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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    await Promise.resolve();
    await Promise.resolve();
    const initialKeywordText = [...container.querySelectorAll(".wx-role-keyword")]
      .map((node) => node.textContent)
      .join("");
    expect(initialKeywordText).toContain("const");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    const keywordTextDuringUpdate = [
      ...container.querySelectorAll(".wx-role-keyword")
    ].map((node) => node.textContent).join("");
    expect(keywordTextDuringUpdate).toContain("const");

    resolveUpdate?.();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("updates visible syntax highlight classes after an async edit refresh", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    let currentText = "const value = 1;";
    createEditor(container, {
      value: currentText,
      language: {
        async open(document) {
          currentText = document.doc.text;
        },
        async update(document) {
          currentText = document.doc.text;
        },
        async getHighlightRanges() {
          const match = /\bconst\b/.exec(currentText);
          return match
            ? [{ from: match.index, to: match.index + match[0].length, role: "keyword" as const }]
            : [];
        }
      }
    });

    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    await flushAsyncWork();
    expect(keywordText(container)).toContain("const");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    await flushAsyncWork();

    expect(keywordText(container)).not.toContain("const");
    expect(container.querySelector('[data-wx-editor-content="1"]')?.textContent).toContain("xconst");
  });

  it("replaces remapped visible highlights after an async language update resolves", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    let currentText = "const value = 1;";
    let resolveUpdate: (() => void) | null = null;
    createEditor(container, {
      value: currentText,
      language: {
        async open(document) {
          currentText = document.doc.text;
        },
        async update(document) {
          currentText = document.doc.text;
          await new Promise<void>((resolve) => {
            resolveUpdate = resolve;
          });
        },
        async getHighlightRanges() {
          const match = /\bconst\b/.exec(currentText);
          return match
            ? [{ from: match.index, to: match.index + match[0].length, role: "keyword" as const }]
            : [];
        }
      }
    });

    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    await flushAsyncWork();
    expect(keywordText(container)).toContain("const");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await Promise.resolve();

    expect(keywordText(container)).toContain("const");

    resolveUpdate?.();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushAsyncWork();

    expect(keywordText(container)).not.toContain("const");
    expect(container.querySelector('[data-wx-editor-content="1"]')?.textContent).toContain("xconst");
  });

  it("keeps using a viewport slice after a newline inserted at the top", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n")
    });

    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelectorAll("[data-wx-editor-row]").length).toBeLessThan(80);
    expect(container.querySelector('[data-wx-editor-row="151"]')).toBeNull();
  });

  it("keeps the original glyph selected after a then escape", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.getAttribute("data-wx-editor-cursor-kind")).toBe("line");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(editor.getState().mode).toBe("normal");
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("b");
  });

  it("keeps Escape at the start of a line on that same line", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha\nbeta" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0)).toEqual({
      line: 1,
      column: 0
    });
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("b");
  });

  it("routes a, v, e, and b through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha beta gamma" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    expect(container.querySelectorAll(".wx-is-selected").length).toBeGreaterThan(0);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-status-mode='true']")?.textContent).toBe("VIS");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-content='1']")?.textContent).toContain("alpha beta");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-status-mode='true']")?.textContent).toBe("VIS");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-status-mode='true']")?.textContent).toBe("INS");
  });

  it("routes y and p through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(editor.getState().doc.text).toBe("abbc");
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("b");
    expect(editor.getState().mode).toBe("normal");
  });

  it("routes d through the DOM key handler", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abcd" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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
    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    Object.defineProperty(surface, "clientHeight", { value: 96, configurable: true });

    editor.focus();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).column).toBeGreaterThan(0);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).column).toBe(0);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).line).toBeGreaterThanOrEqual(2);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }));
    expect(editor.getState().doc.positionAt(editor.getState().selection.ranges[0]?.head ?? 0).line).toBeGreaterThanOrEqual(3);

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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));

    const firstRowSelectedTokens = [
      ...(container.querySelector('[data-wx-editor-content="1"]')?.querySelectorAll(".wx-is-selected") ?? [])
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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    const movementStartedAt = performance.now();

    for (let index = 0; index < 50; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    const movementElapsed = performance.now() - movementStartedAt;

    expect(editor.getState().doc.lineCount).toBe(2000);
    expect(container.querySelectorAll("[data-wx-editor-row]").length).toBeLessThan(80);
    expect(container.querySelector('[data-wx-editor-row="51"]')).not.toBeNull();
    expect(container.querySelector('[data-wx-editor-row="1500"]')).toBeNull();
    expect(renderElapsed).toBeLessThan(4000);
    expect(movementElapsed).toBeLessThan(1000);
  });

  it("rerenders the viewport slice when movement changes the anchored top row", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n")
    });

    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    Object.defineProperty(surface, "clientHeight", { value: 80, configurable: true });

    for (let index = 0; index < 100; index += 1) {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    }

    expect(container.querySelectorAll("[data-wx-editor-row]").length).toBeLessThan(80);
    expect(container.querySelector('[data-wx-editor-row="101"]')).not.toBeNull();
    expect(container.querySelector('[data-wx-editor-row="1"]')).toBeNull();
  });

  it("opens the bottom-row command runner with : and dismisses it with Escape or Enter", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-command-prompt='true']")?.textContent).toBe(":");
    expect(container.querySelector("[data-wx-editor-command-text='true']")?.textContent).toBe("");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-command-text='true']")?.textContent).toBe("wq");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-command-prompt='true']")).toBeNull();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-command-prompt='true']")).toBeNull();
  });

  it("autocompletes :t to theme and shows a command popover", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));

    expect(container.querySelector('[data-wx-editor-command-completion="theme"]')).not.toBeNull();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(container.querySelector("[data-wx-editor-command-prompt='true']")?.textContent).toBe(":");
    expect(container.querySelector("[data-wx-editor-command-text='true']")?.textContent).toBe("theme ");
    expect(container.querySelector('[data-wx-editor-command-completion="theme"]')).toBeNull();
  });

  it("cycles theme completions with Tab and Shift+Tab and applies the selected theme on Enter", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const sunriseTheme = {
      name: "sunrise",
      colors: {
        background: "#20110f"
      }
    };
    const tideTheme = {
      name: "tide",
      colors: {
        background: "#042f3a"
      }
    };

    createEditor(container, {
      value: "abc",
      theme: sunriseTheme,
      commandThemes: [sunriseTheme, tideTheme]
    });

    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    const root = container.querySelector("[data-wx-editor='root']") as HTMLDivElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(container.querySelector('[data-wx-editor-command-completion="sunrise"]')?.getAttribute("data-selected")).toBe("true");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(container.querySelector('[data-wx-editor-command-completion="wx-daybreak"]')?.getAttribute("data-selected")).toBe("true");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }));
    expect(container.querySelector('[data-wx-editor-command-completion="sunrise"]')?.getAttribute("data-selected")).toBe("true");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }));
    expect(container.querySelector('[data-wx-editor-command-completion="tide"]')?.getAttribute("data-selected")).toBe("true");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(root.style.getPropertyValue("--wx-color-background")).toBe("#042f3a");
    expect(container.querySelector("[data-wx-editor-command-prompt='true']")).toBeNull();
  });

  it("previews themes live while cycling and restores the committed theme on Escape", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const sunriseTheme = {
      name: "sunrise",
      colors: {
        background: "#20110f"
      }
    };
    const tideTheme = {
      name: "tide",
      colors: {
        background: "#042f3a"
      }
    };

    createEditor(container, {
      value: "abc",
      theme: sunriseTheme,
      commandThemes: [sunriseTheme, tideTheme]
    });

    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    const root = container.querySelector("[data-wx-editor='root']") as HTMLDivElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(root.style.getPropertyValue("--wx-color-background")).toBe("#20110f");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }));

    expect(root.style.getPropertyValue("--wx-color-background")).toBe("#042f3a");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(root.style.getPropertyValue("--wx-color-background")).toBe("#20110f");
    expect(container.querySelector("[data-wx-editor-command-prompt='true']")).toBeNull();
  });

  it("renders diagnostics in the gutter, status bar, and bottom row", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: "const bad = value;",
      languageServices: {
        diagnostics: {
          async diagnostics() {
            return [
              { from: 0, to: 5, severity: "error", message: "Bad keyword" },
              { from: 6, to: 9, severity: "warning", message: "Suspicious name" }
            ];
          }
        }
      }
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('[data-wx-editor-diagnostic-marker="error"]')).not.toBeNull();
    expect(container.querySelector('[data-wx-editor-content="1"] .wx-diagnostic-error')).not.toBeNull();
    expect(container.querySelector('[data-wx-editor-diagnostic-note="inline"]')?.textContent).toContain("Bad keyword");
    expect(container.querySelector('[data-wx-editor-diagnostic-hook="error"]')).not.toBeNull();
    expect(container.querySelector('[data-wx-editor-diagnostic-note="eol"]')?.textContent).toContain("Suspicious name");
    expect(container.querySelector('[data-wx-editor-diagnostic-note="eol"]')?.classList.contains("wx-editor__eol-diagnostic")).toBe(true);
    expect(container.querySelector(".wx-editor__diagnostic-gutter")?.textContent).toBe(" ");
    expect(container.querySelector('[data-wx-editor-row="1"]')?.nextElementSibling?.querySelector('[data-wx-editor-diagnostic-note="inline"]')).not.toBeNull();
    expect(container.querySelector("[data-wx-editor-status-meta='true']")?.textContent).toContain("E1");
    expect(container.querySelector("[data-wx-editor-status-meta='true']")?.textContent).toContain("W1");

    const token = container.querySelector('[data-wx-editor-offset="0"]') as HTMLElement;
    token.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(container.querySelector("[data-wx-editor-tooltip='true']")?.textContent).toContain("Bad keyword");
  });

  it("remaps diagnostics through local edits before async refresh completes", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    let diagnosticsCallCount = 0;

    createEditor(container, {
      value: "const bad = value;",
      languageServices: {
        diagnostics: {
          diagnostics() {
            diagnosticsCallCount += 1;

            if (diagnosticsCallCount === 1) {
              return Promise.resolve([{ from: 6, to: 9, severity: "warning" as const, message: "Suspicious name" }]);
            }

            return new Promise<readonly { from: number; to: number; severity: "warning"; message: string }[]>(
              () => {}
            );
          }
        }
      }
    });

    await Promise.resolve();
    await Promise.resolve();

    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await Promise.resolve();

    expect(container.querySelector('[data-wx-editor-content="1"] .wx-diagnostic-warning')?.textContent).toContain("bad");
    expect(container.querySelector('[data-wx-editor-diagnostic-note="inline"], [data-wx-editor-diagnostic-note="eol"]')?.textContent).toContain(
      "Suspicious name"
    );
  });

  it("runs :format through the formatter service", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: "let x=1;",
      languageServices: {
        formatter: {
          async format() {
            return [{ from: 0, to: 8, insert: "let x = 1;" }];
          }
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "o", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushAsyncWork();

    expect(editor.getState().doc.text).toBe("let x = 1;");
    expect(container.querySelector("[data-wx-editor-bottom-message='true']")?.textContent).toContain("Formatted");
  });

  it("runs :w through the host file writer", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const writes: Array<{ filePath: string; text: string }> = [];
    const didWrites: Array<{ filePath: string; text: string }> = [];

    createEditor(container, {
      value: "screen\n  size fill\n",
      filePath: "examples/editor.scene",
      host: {
        async writeFile(context) {
          writes.push(context);
        },
        didWriteFile(context) {
          didWrites.push(context);
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushAsyncWork();

    expect(writes).toEqual([{ filePath: "examples/editor.scene", text: "screen\n  size fill\n" }]);
    expect(didWrites).toEqual([{ filePath: "examples/editor.scene", text: "screen\n  size fill\n" }]);
    expect(container.querySelector("[data-wx-editor-bottom-message='true']")?.textContent).toContain("Wrote examples/editor.scene");
  });

  it("does not wait for didWriteFile hooks before reporting save success", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const writes: Array<{ filePath: string; text: string }> = [];
    let resolveDidWrite: (() => void) | null = null;

    createEditor(container, {
      value: "screen\n  size fill\n",
      filePath: "examples/editor.scene",
      host: {
        async writeFile(context) {
          writes.push(context);
        },
        async didWriteFile() {
          await new Promise<void>((resolve) => {
            resolveDidWrite = resolve;
          });
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushAsyncWork();

    expect(writes).toEqual([{ filePath: "examples/editor.scene", text: "screen\n  size fill\n" }]);
    expect(container.querySelector("[data-wx-editor-bottom-message='true']")?.textContent).toContain("Wrote examples/editor.scene");

    resolveDidWrite?.();
    await flushAsyncWork();
  });

  it("writes to an explicit output path with :w <path>", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const writes: Array<{ filePath: string; text: string }> = [];

    createEditor(container, {
      value: "screen\n  size fill\n",
      filePath: "examples/editor.scene",
      host: {
        async writeFile(context) {
          writes.push(context);
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    for (const key of "w memory/demo.scene") {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(writes).toEqual([{ filePath: "memory/demo.scene", text: "screen\n  size fill\n" }]);
    expect(container.querySelector("[data-wx-editor-status-file='true']")?.textContent).toBe("memory/demo.scene");
  });

  it("renders added, modified, and deleted gutter markers after the line number", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: "one\ntwo\nthree",
      host: {
        async getLineChanges() {
          return [
            { line: 0, kind: "added" as const },
            { line: 1, kind: "modified" as const },
            { line: 1, kind: "deleted" as const }
          ];
        }
      }
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector('[data-wx-editor-gutter="1"] [data-wx-editor-line-change="added"]')).not.toBeNull();
    expect(container.querySelector('[data-wx-editor-gutter="2"] [data-wx-editor-line-change="modified"]')).not.toBeNull();
    expect(container.querySelector('[data-wx-editor-gutter="2"] .wx-editor__gutter-change[data-deleted="true"]')).not.toBeNull();
  });

  it("runs :format through the first formatter in a service list", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: "let x=1;",
      languageServices: [
        {
          formatter: {
            async format() {
              return [{ from: 0, to: 8, insert: "let x = 1;" }];
            }
          }
        },
        {
          formatter: {
            async format() {
              return [{ from: 0, to: 8, insert: "const y = 2;" }];
            }
          }
        }
      ]
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "o", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(editor.getState().doc.text).toBe("let x = 1;");
  });

  it("shows code actions and applies the selected action", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: "const bad = value;",
      languageServices: {
        diagnostics: {
          async diagnostics() {
            return [{ from: 6, to: 9, severity: "warning", message: "Rename variable" }];
          }
        },
        codeActions: {
          async getCodeActions(context) {
            expect(context.diagnostics).toHaveLength(1);
            return [
              {
                title: "Rename to good",
                changes: [{ from: 6, to: 9, insert: "good" }]
              }
            ];
          }
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    await Promise.resolve();
    await Promise.resolve();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushAsyncWork();

    expect(container.querySelector("[data-wx-editor-code-actions='true']")?.textContent).toContain("Rename to good");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushAsyncWork();

    expect(editor.getState().doc.text).toBe("const good = value;");
    expect(container.querySelector("[data-wx-editor-bottom-message='true']")?.textContent).toContain("Applied Rename to good");
  });

  it("opens code actions from space+a", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: "const value = bad;",
      languageServices: {
        codeActions: {
          async getCodeActions() {
            return [{ title: "Replace bad", changes: [{ from: 14, to: 17, insert: "good" }] }];
          }
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    await flushAsyncWork();

    expect(container.querySelector("[data-wx-editor-prefix-hint='space']")).toBeNull();
    expect(container.querySelector("[data-wx-editor-code-actions='true']")?.textContent).toContain("Replace bad");
  });

  it("shows hover info on mousemove and space+k", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, {
      value: "const value = 1;",
      languageServices: {
        hover: {
          async hover(_document, offset) {
            return { source: "fake-lsp", content: `hover:${offset}` };
          }
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    const token = container.querySelector('[data-wx-editor-offset="0"]') as HTMLElement;

    token.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await flushAsyncWork();
    expect(container.querySelector("[data-wx-editor-tooltip='true']")?.textContent).toContain("hover:0");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-prefix-hint='space']")?.textContent).toContain("<space>");
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    await flushAsyncWork();
    expect(container.querySelector("[data-wx-editor-tooltip='true']")?.textContent).toContain("hover:0");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-tooltip='true']")).toHaveProperty("hidden", true);
  });

  it("invalidates stale hover responses after document edits", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    let resolveHover: ((value: { source: string; content: string }) => void) | null = null;

    createEditor(container, {
      value: "screen",
      languageServices: {
        hover: {
          hover() {
            return new Promise((resolve) => {
              resolveHover = resolve;
            });
          }
        }
      }
    });

    const token = container.querySelector('[data-wx-editor-offset="0"]') as HTMLElement;
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    token.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    await Promise.resolve();

    resolveHover?.({ source: "fake-lsp", content: "stale hover" });
    await Promise.resolve();
    await Promise.resolve();

    expect(container.querySelector("[data-wx-editor-tooltip='true']")).toHaveProperty("hidden", true);
    expect(container.querySelector("[data-wx-editor-tooltip='true']")?.textContent ?? "").not.toContain("stale hover");
  });

  it("renders filler rows with ~ after the end of the file", () => {
    const container = document.createElement("div");
    document.body.append(container);

    createEditor(container, { value: "one\ntwo" });
    const surface = container.querySelector("[data-wx-editor='surface']") as HTMLDivElement;
    Object.defineProperty(surface, "clientHeight", { value: 240, configurable: true });
    surface.dispatchEvent(new Event("scroll"));

    expect(container.querySelector("[data-wx-editor-filler-row]")?.textContent).toContain("~");
    expect(container.querySelector('[data-wx-editor-filler-row="1"] .wx-editor__gutter-number')?.textContent).toBe(" ");
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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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

    expect(container.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("b");
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
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

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

  it("supports / search and n/N repeat", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha beta alpha" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    for (const key of "beta") {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 6, to: 10 });
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("a");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 6, to: 10 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "N", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 6, to: 10 });
    expect(container.querySelector(".wx-search-current")).not.toBeNull();
  });

  it("previews the first / match while typing and restores on escape", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha beta alpha" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    for (const key of "beta") {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }

    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 6, to: 10 });
    expect(container.querySelector("[data-wx-editor-cursor='true']")?.textContent).toBe("a");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 1 });
  });

  it("restores the previous cursor position while typing when the / preview has no matches", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha beta alpha" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 6, to: 7 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));

    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 1 });
  });

  it("restores the previous active search when a new / query has no matches", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "alpha beta alpha" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    for (const key of "alpha") {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 5 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    for (const key of "zzz") {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 0, to: 5 });
    expect(container.querySelector("[data-wx-editor-bottom-message='true']")?.textContent).toContain("No matches for zzz");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 11, to: 16 });
  });

  it("navigates diagnostics and opens the diagnostics picker", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: "alpha\nbeta\ngamma",
      languageServices: {
        diagnostics: {
          async diagnostics() {
            return [
              { from: 0, to: 5, severity: "warning", message: "first" },
              { from: 11, to: 16, severity: "error", message: "second" }
            ];
          }
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;
    await Promise.resolve();

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "]", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 11, to: 16 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    expect(container.querySelector("[data-wx-editor-picker='true']")?.textContent).toContain("second");
  });

  it("stores jumps and navigates them with Ctrl-o/Ctrl-i", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "one\ntwo\nthree" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true, bubbles: true }));
    expect(editor.getState().selection.ranges[0]?.head).toBe(1);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true, bubbles: true }));
    expect(editor.getState().selection.ranges[0]?.head).toBe(5);
  });

  it("supports surrounds and named registers", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "(", bubbles: true }));
    expect(editor.getState().doc.text).toBe("(a)bc");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "\"", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "\"", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    expect(editor.getState().doc.text).toBe("(a)b(a)c");
  });

  it('pastes from the system clipboard with "+p and Ctrl-r +', async () => {
    const readText = vi.fn(async () => "clip");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText }
    });

    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, { value: "abc" });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "\"", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.getState().doc.text).toBe("aclipbc");

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.getState().doc.text).toBe("aclipclipbc");
    expect(readText).toHaveBeenCalledTimes(2);
  });

  it("uses comment and syntax providers when available", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const editor = createEditor(container, {
      value: "const value = test();",
      languageServices: {
        comments: {
          async toggleLineComments() {
            return [{ from: 0, to: 0, insert: "// " }];
          }
        },
        syntaxNavigation: {
          async gotoNext(context) {
            return context.kind === "f" ? { from: 14, to: 18 } : null;
          }
        },
        syntaxTextobjects: {
          async selectTextobject(_context) {
            return { from: 14, to: 18 };
          }
        }
      }
    });
    const textarea = container.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    await Promise.resolve();
    expect(editor.getState().doc.text.startsWith("// ")).toBe(true);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "]", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 14, to: 18 });

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(getSelectionOffsets(editor.getState())).toEqual({ from: 14, to: 18 });
  });
});
