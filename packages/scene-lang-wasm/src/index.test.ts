import { describe, expect, it } from "vitest";

import { __internal } from "./index";

function fakeExports(handler: (name: string, memory: WebAssembly.Memory, ...args: number[]) => number | void = () => {}) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const allocations: number[] = [];
  let resultPointer = 256;
  let resultLength = 0;
  const writeResult = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    new Uint8Array(memory.buffer, resultPointer, bytes.length).set(bytes);
    resultLength = bytes.length;
  };
  const call = (name: string, ...args: number[]) => {
    const result = handler(name, memory, ...args);
    if (typeof result === "number") return result;
    writeResult(name === "scene_compile" ? '{"ok":true,"wgsl":null,"usesTime":false,"usesResolution":false,"usesNoise":false}' : "[]");
    return 0;
  };
  return {
    memory,
    allocations,
    alloc(length: number) { allocations.push(length); return 64; },
    dealloc(_pointer: number, length: number) { allocations.push(-length); },
    scene_compile: (...args: number[]) => call("scene_compile", ...args),
    scene_diagnostics_json: (...args: number[]) => call("scene_diagnostics_json", ...args),
    scene_hover_json: (...args: number[]) => call("scene_hover_json", ...args),
    scene_format_json: (...args: number[]) => call("scene_format_json", ...args),
    scene_code_actions_json: (...args: number[]) => call("scene_code_actions_json", ...args),
    scene_highlights_json: (...args: number[]) => call("scene_highlights_json", ...args),
    last_result_ptr: () => resultPointer,
    last_result_len: () => resultLength,
    writeResult,
    setResultBounds(pointer: number, length: number) { resultPointer = pointer; resultLength = length; }
  };
}

describe("scene language wasm offset conversions", () => {
  it("maps public UTF-16 offsets to wasm UTF-8 byte offsets", () => {
    const source = "let café = 😀;";

    expect(__internal.utf16OffsetToUtf8ByteOffset(source, source.indexOf("c"))).toBe(4);
    expect(__internal.utf16OffsetToUtf8ByteOffset(source, source.indexOf("😀"))).toBe(12);
    expect(__internal.utf16OffsetToUtf8ByteOffset(source, source.indexOf(";"))).toBe(16);
  });

  it("maps wasm byte ranges back to public UTF-16 ranges", () => {
    const source = "let café = 😀;";

    expect(__internal.convertRangeToUtf16(source, { from: 4, to: 9, role: "text" })).toEqual({
      from: 4,
      to: 8,
      role: "text"
    });
    expect(__internal.convertRangeToUtf16(source, { from: 12, to: 16, role: "text" })).toEqual({
      from: 11,
      to: 13,
      role: "text"
    });
  });

  it("converts action changes before applying them to JS strings", () => {
    const source = "let café = 😀;";
    const actions = __internal.convertActionsToUtf16(source, [
      {
        title: "replace emoji",
        changes: [{ from: 12, to: 16, insert: "ok" }]
      }
    ]);

    expect(actions).toEqual([
      {
        title: "replace emoji",
        changes: [{ from: 11, to: 13, insert: "ok" }]
      }
    ]);
    expect(__internal.applyTextChanges(source, actions[0]!.changes)).toBe("let café = ok;");
  });
});

describe("scene language wasm ABI execution", () => {
  it("copies results after memory growth and always deallocates empty input", () => {
    const fake = fakeExports((_name, memory) => { memory.grow(1); });
    const runtime = __internal.createSceneLangRuntime(fake as never);

    expect(runtime.compile("").ok).toBe(true);
    expect(fake.allocations[0]).toBe(0);
    expect(fake.allocations[1]).toBe(-0);
  });

  it("maps malformed JSON to a protocol error", () => {
    let fake: ReturnType<typeof fakeExports>;
    fake = fakeExports((_name, memory) => {
      new Uint8Array(memory.buffer, 256, 8).set(new TextEncoder().encode("not json"));
      fake.setResultBounds(256, 8);
      return 0;
    });
    const runtime = __internal.createSceneLangRuntime(fake as never);

    expect(() => runtime.diagnostics("x")).toThrowError(expect.objectContaining({ code: "protocol" }));
    expect(fake.allocations).toEqual([1, -1]);
  });

  it("keeps status, trap, and host failures distinct and deallocates each", () => {
    const status = fakeExports(() => 7);
    const trap = fakeExports(() => { throw new WebAssembly.RuntimeError("unreachable"); });
    const host = fakeExports(() => { throw new Error("host failure"); });

    expect(() => __internal.createSceneLangRuntime(status as never).compile("x")).toThrowError(expect.objectContaining({ code: "status" }));
    expect(() => __internal.createSceneLangRuntime(trap as never).compile("x")).toThrowError(expect.objectContaining({ code: "trap" }));
    expect(() => __internal.createSceneLangRuntime(host as never).compile("x")).toThrowError(expect.objectContaining({ code: "host" }));
    expect(status.allocations).toEqual([1, -1]);
    expect(trap.allocations).toEqual([1, -1]);
    expect(host.allocations).toEqual([1, -1]);
  });

  it("rejects missing exports and invalid result bounds", () => {
    expect(() => __internal.validateExports({} as WebAssembly.Exports)).toThrowError(expect.objectContaining({ code: "exports" }));
    const invalid = fakeExports();
    (invalid as { memory: unknown }).memory = {};
    expect(() => __internal.validateExports(invalid as never)).toThrowError(expect.objectContaining({ code: "exports" }));

    let fake: ReturnType<typeof fakeExports>;
    fake = fakeExports(() => {
      fake.setResultBounds(fake.memory.buffer.byteLength - 1, 2);
      return 0;
    });
    expect(() => __internal.createSceneLangRuntime(fake as never).compile("x")).toThrowError(expect.objectContaining({ code: "memory" }));
    expect(fake.allocations).toEqual([1, -1]);
  });

  it("preserves UTF-8 ABI offsets for non-ASCII source", () => {
    const seen: number[] = [];
    let fake: ReturnType<typeof fakeExports>;
    fake = fakeExports((name, memory, _pointer, _length, offset) => {
      if (name === "scene_hover_json") {
        seen.push(offset!);
        new Uint8Array(memory.buffer, 256, 4).set(new TextEncoder().encode("null"));
        fake.setResultBounds(256, 4);
      }
      return 0;
    });
    const runtime = __internal.createSceneLangRuntime(fake as never);
    expect(runtime.hover("let café = 😀;", 11)).toBeNull();
    expect(seen).toEqual([12]);
  });
});
