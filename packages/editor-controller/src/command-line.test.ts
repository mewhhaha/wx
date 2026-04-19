import { describe, expect, it } from "vitest";

import { getCommandCompletionItems, hasRunnableCommandLineValue } from "./command-line";

describe("command-line completion runnable gate", () => {
  it("keeps exact completed root commands in sync with the runnable check", () => {
    const items = getCommandCompletionItems(
      {
        active: true,
        prompt: ":",
        value: ""
      },
      ["ph", "mint"]
    );

    const nonExecutableRoots = new Set(["goto", "symbols", "rename"]);

    for (const item of items) {
      expect(hasRunnableCommandLineValue(item.label, ["ph", "mint"])).toBe(!nonExecutableRoots.has(item.label));
    }
  });

  it("treats completed goto and symbol subcommands as runnable", () => {
    expect(hasRunnableCommandLineValue("goto definition")).toBe(true);
    expect(hasRunnableCommandLineValue("goto references")).toBe(true);
    expect(hasRunnableCommandLineValue("symbols document")).toBe(true);
    expect(hasRunnableCommandLineValue("symbols workspace")).toBe(true);
    expect(hasRunnableCommandLineValue("rename nextName")).toBe(true);
  });
});
