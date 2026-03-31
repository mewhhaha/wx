import { describe, expect, it } from "vitest";

import { enterInsertMode, insertText, moveRight } from "@whx/editor-core";

import { createEditorController } from "./index";

describe("editor controller", () => {
  it("emits deterministic updates for command execution", () => {
    const controller = createEditorController({ value: "abc" });
    const updates: string[] = [];

    controller.subscribe((update) => {
      if (update.docChanged) {
        updates.push("doc");
      } else if (update.selectionChanged) {
        updates.push("selection");
      } else if (update.modeChanged) {
        updates.push("mode");
      }
    });

    controller.execute(moveRight);
    controller.execute(enterInsertMode);
    controller.execute(insertText("x"));

    expect(updates).toEqual(["selection", "mode", "doc"]);
  });

  it("supports undo and redo through command context history", () => {
    const controller = createEditorController({ value: "abc", mode: "insert" });

    controller.execute(insertText("d"));
    expect(controller.getState().doc.text).toBe("dabc");

    controller.execute((_state, _dispatch, context) => context.history?.undo() ?? false);
    expect(controller.getState().doc.text).toBe("abc");

    controller.execute((_state, _dispatch, context) => context.history?.redo() ?? false);
    expect(controller.getState().doc.text).toBe("dabc");
  });

  it("clears history when state is replaced externally", () => {
    const controller = createEditorController({ value: "abc", mode: "insert" });

    controller.execute(insertText("d"));
    expect(controller.getState().doc.text).toBe("dabc");

    controller.replaceState(createEditorController({ value: "xyz" }).getState());
    controller.execute((_state, _dispatch, context) => context.history?.undo() ?? false);

    expect(controller.getState().doc.text).toBe("xyz");
  });
});
