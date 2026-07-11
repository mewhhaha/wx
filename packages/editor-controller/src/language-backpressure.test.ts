import { describe, expect, it } from "vitest";

import type { TextChange } from "@mewhhaha/wx-core";
import type { EditorLineRange, HighlightSpan, LanguageDocumentSnapshot } from "@mewhhaha/wx-language";

import { createEditorController } from "./index";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

async function flush(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe("language pipeline backpressure", () => {
  it("coalesces a 1,000-edit burst and exposes latest-revision convergence", async () => {
    const first = deferred();
    const second = deferred();
    let updateCalls = 0;
    let batchedUpdates = 0;
    const highlighter = {
      async open() {},
      async update(_document: LanguageDocumentSnapshot, _changes: readonly TextChange[]) {
        updateCalls += 1;
        await first.promise;
      },
      async updateBatches(updates: readonly { document: LanguageDocumentSnapshot; changes: readonly TextChange[] }[]) {
        updateCalls += 1;
        batchedUpdates = updates.length;
        await second.promise;
      },
      async getHighlights(_lines: EditorLineRange, _revision: number): Promise<HighlightSpan[]> { return []; }
    };
    const controller = createEditorController({ value: "seed" });
    controller.setLanguageServices({ highlighter });
    await flush();

    for (let index = 0; index < 1_000; index += 1) {
      const from = controller.getState().doc.length;
      controller.dispatch({ changes: [{ from, to: from, insert: "x" }] });
    }
    await flush();

    expect(updateCalls).toBe(1);
    expect(controller.getPresentationState().language.work.document).toMatchObject({
      inFlight: 1,
      queued: 1,
      maxQueueDepth: 2,
      latestRequestedRevision: 1_000
    });

    first.resolve();
    await flush(16);
    expect(updateCalls).toBe(2);
    expect(batchedUpdates).toBe(999);
    second.resolve();
    await flush(16);

    expect(controller.getPresentationState().language.work.document).toMatchObject({
      inFlight: 0,
      queued: 0,
      maxQueueDepth: 2,
      latestRequestedRevision: 1_000,
      latestCompletedRevision: 1_000,
      coalesced: 998
    });
    expect(controller.getPresentationState().language.languageRevision).toBe(1_000);
    controller.destroy();
  });
});
