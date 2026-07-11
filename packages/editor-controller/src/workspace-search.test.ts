import { describe, expect, it, vi } from "vitest";
import { createEditorController } from "./index";

describe("workspace content search", () => {
  it("cancels superseded bounded queries and opens the exact UTF-16 range", async () => {
    const signals: AbortSignal[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const searchWorkspace = vi.fn(async (request: { query: string; signal?: AbortSignal }) => {
      if (request.signal) signals.push(request.signal);
      if (request.query === "a") await firstGate;
      return request.signal?.aborted ? [] : [{ filePath: "src/żółć.ts", line: 0, fromColumn: 3, toColumn: 9, preview: "😀 needle" }];
    });
    const controller = createEditorController({ value: "origin", filePath: "src/origin.ts" });
    controller.setHostServices({
      searchWorkspace,
      async readFile({ filePath }) { return { text: filePath.endsWith("żółć.ts") ? "😀 needle" : "origin" }; }
    });

    await controller.handleKeyInput({ key: "F", ctrl: true, shift: true });
    const first = controller.handleTextInput("a");
    const second = controller.handleTextInput("b");
    releaseFirst();
    await Promise.all([first, second]);
    expect(signals[0]?.aborted).toBe(true);
    expect(controller.getPresentationState().ui.picker.items).toHaveLength(1);

    await controller.handleKeyInput({ key: "Enter" });
    expect(controller.getPresentationState().filePath).toBe("src/żółć.ts");
    expect(controller.getState().selection.ranges[0]).toMatchObject({ anchor: 3, head: 8 });
    expect(controller.getJumpList().map((entry) => entry.filePath)).toEqual(["src/origin.ts"]);
    await controller.handleKeyInput({ key: "o", ctrl: true });
    expect(controller.getPresentationState().filePath).toBe("src/origin.ts");
  });

  it("encodes literal smart-case defaults and /regex/ mode", async () => {
    const searchWorkspace = vi.fn(async () => []);
    const controller = createEditorController();
    controller.setHostServices({ searchWorkspace });
    await controller.handleKeyInput({ key: "F", ctrl: true, shift: true });
    await controller.handleTextInput("word");
    expect(searchWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ query: "word", mode: "literal", case: "smart", limit: 200 }));
    await controller.handleKeyInput({ key: "Escape" });
    await controller.handleKeyInput({ key: "F", ctrl: true, shift: true });
    await controller.handleTextInput("/w.r+d/");
    expect(searchWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ query: "w.r+d", mode: "regex" }));
  });

  it.each([
    ["H", "horizontal"], ["V", "vertical"], ["B", "background"]
  ] as const)("opens a selected result with the %s picker action", async (key, disposition) => {
    const controller = createEditorController({ value: "origin", filePath: "src/origin.ts" });
    controller.setHostServices({
      async searchWorkspace() { return [{ filePath: "src/target.ts", line: 0, fromColumn: 1, toColumn: 3, preview: "abcd" }]; },
      async readFile({ filePath }) { return { text: filePath.endsWith("target.ts") ? "abcd" : "origin" }; }
    });
    await controller.handleKeyInput({ key: "F", ctrl: true, shift: true });
    await controller.handleTextInput("a");
    await controller.handleKeyInput({ key, shift: true });
    if (disposition === "background") {
      expect(controller.getPresentationState().filePath).toBe("src/origin.ts");
      expect(controller.getBuffers().some((entry) => entry.filePath === "src/target.ts")).toBe(true);
    } else {
      expect(controller.getWorkspacePresentationState().panes).toHaveLength(2);
      expect(controller.getPresentationState().filePath).toBe("src/target.ts");
      expect(controller.getState().selection.ranges[0]).toMatchObject({ anchor: 1, head: 2 });
    }
  });

  it.each(["H", "V"] as const)("does not leave a split or jump for a failed %s workspace search open", async (key) => {
    const controller = createEditorController({ value: "origin", filePath: "src/origin.ts" });
    controller.setHostServices({
      async searchWorkspace() { return [{ filePath: "src/missing.ts", line: 0, fromColumn: 0, toColumn: 1, preview: "missing" }]; },
      async readFile() { throw new Error("missing"); }
    });

    await controller.handleKeyInput({ key: "F", ctrl: true, shift: true });
    await controller.handleTextInput("missing");
    await controller.handleKeyInput({ key, shift: true });

    expect(controller.getWorkspacePresentationState().panes).toHaveLength(1);
    expect(controller.getJumpList()).toEqual([]);
    expect(controller.getPresentationState().filePath).toBe("src/origin.ts");
  });
});
