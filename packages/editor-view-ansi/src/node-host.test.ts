import { describe, expect, it } from "vitest";

import { createNodeTerminalWrite, type NodeTerminalWritable } from "./node-host";

class FakeWritable implements NodeTerminalWritable {
  readonly writes: string[] = [];
  private readonly listeners = new Map<"drain" | "error", Set<(...args: never[]) => void>>();
  private callback: ((error?: Error | null) => void) | null = null;
  nextWriteResult = true;

  write(text: string, callback: (error?: Error | null) => void): boolean {
    this.writes.push(text);
    this.callback = callback;
    return this.nextWriteResult;
  }
  once(event: "drain", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "drain" | "error", listener: (...args: never[]) => void): unknown {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
  off(event: "drain" | "error", listener: (...args: never[]) => void) {
    this.listeners.get(event)?.delete(listener);
  }
  complete(error?: Error) {
    this.callback?.(error);
  }
  emitDrain() {
    for (const listener of this.listeners.get("drain") ?? []) listener();
  }
  emitError(error: Error) {
    for (const listener of this.listeners.get("error") ?? []) listener(error);
  }
}

describe("Node terminal writer", () => {
  it("waits for both the write callback and drain after backpressure", async () => {
    const output = new FakeWritable();
    output.nextWriteResult = false;
    let settled = false;
    const pending = createNodeTerminalWrite(output)("frame").then(() => { settled = true; });

    output.emitDrain();
    await pending;
    expect(settled).toBe(true);
    expect(output.writes).toEqual(["frame"]);
  });

  it("rejects a failed write without waiting for drain", async () => {
    const output = new FakeWritable();
    output.nextWriteResult = false;
    const pending = createNodeTerminalWrite(output)("frame");
    const failure = new Error("closed");
    output.emitError(failure);
    await expect(pending).rejects.toBe(failure);
  });
});
