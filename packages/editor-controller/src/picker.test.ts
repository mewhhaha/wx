import { createEditorState } from "@wx/editor-core";
import type { EditorCodeAction, EditorDiagnostic } from "@wx/editor-language";
import { describe, expect, it, vi } from "vitest";

import { createPickerRuntime } from "./picker";
import { createPresentationState } from "./presentation";
import type { EditorController } from "./types";

async function flushAsyncWork(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function createPickerHarness(options: {
  searchFiles?: (scope: "repo" | "folder", query?: string) => Promise<readonly { filePath: string; detail?: string }[]>;
  requestCodeActions?: () => Promise<readonly EditorCodeAction[]>;
  diagnostics?: readonly EditorDiagnostic[];
} = {}) {
  const state = createEditorState({ value: "alpha", selection: { anchor: 0, head: 0 } });
  const presentation = createPresentationState(state, { filePath: "src/current.ts" });
  presentation.language.diagnostics = [...(options.diagnostics ?? [])];
  presentation.language.diagnosticsByLine = new Map(
    presentation.language.diagnostics.map((entry) => [state.doc.positionAt(entry.from).line, [entry]])
  );
  const controller = {
    searchFiles: options.searchFiles ?? (async () => []),
    requestCodeActions: options.requestCodeActions ?? (async () => []),
    applyCodeAction: vi.fn(async () => true),
    openBuffer: vi.fn(async () => true),
    switchBuffer: vi.fn(() => true),
    getJumpList: vi.fn(() => [])
  } as unknown as EditorController;
  const context = {
    getState: () => state,
    getPresentation: () => presentation,
    getController: () => controller,
    getBuffers: () => [],
    setBottomMessage(message: typeof presentation.ui.bottomMessage) {
      presentation.ui.bottomMessage = message;
    },
    emitPresentationUpdate: vi.fn(),
    jumpToSelection: vi.fn(),
    restoreJump: vi.fn(() => false)
  };

  return {
    state,
    presentation,
    controller,
    context,
    runtime: createPickerRuntime(context)
  };
}

describe("picker runtime", () => {
  it("ignores stale modal search results after switching picker families", async () => {
    let resolveSearch: ((value: readonly { filePath: string }[]) => void) | null = null;
    const harness = createPickerHarness({
      diagnostics: [{ from: 0, to: 1, severity: "warning", message: "warn" }],
      searchFiles: async (_scope, query = "") => {
        if (query === "a") {
          return await new Promise<readonly { filePath: string }[]>((resolve) => {
            resolveSearch = resolve;
          });
        }

        return [{ filePath: "src/seed.ts" }];
      }
    });

    await harness.runtime.openFileSearchPicker("repo");
    await flushAsyncWork();

    const pendingSearch = harness.runtime.updatePickerQuery("a");
    harness.runtime.openDiagnosticsPicker();

    resolveSearch?.([{ filePath: "src/a.ts" }]);
    await pendingSearch;
    await flushAsyncWork();

    expect(harness.presentation.ui.picker.title).toBe("diagnostics");
    expect(harness.presentation.ui.picker.variant).toBe("bar");
    expect(harness.presentation.ui.picker.items.map((entry) => entry.label)).toEqual(["1:1 warn"]);
  });

  it("ignores stale code-action responses after picker closes", async () => {
    let resolveActions: ((value: readonly EditorCodeAction[]) => void) | null = null;
    const harness = createPickerHarness({
      requestCodeActions: async () => {
        return await new Promise<readonly EditorCodeAction[]>((resolve) => {
          resolveActions = resolve;
        });
      }
    });

    const pendingLoad = harness.runtime.loadCodeActions();
    harness.runtime.closePicker("ui.picker.close");

    resolveActions?.([{ title: "Fix issue" }]);
    await pendingLoad;
    await flushAsyncWork();

    expect(harness.presentation.ui.picker.active).toBe(false);
    expect(harness.presentation.ui.picker.title).toBe("");
    expect(harness.presentation.ui.picker.items).toEqual([]);
  });
});
