const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type SceneSeverity = "error" | "warning" | "info" | "hint";
export type SceneHighlightRole =
  | "keyword"
  | "string"
  | "number"
  | "type"
  | "function"
  | "operator"
  | "punctuation"
  | "text"
  | "comment";

export interface SceneTextChange {
  from: number;
  to: number;
  insert: string;
}

export interface SceneDiagnostic {
  from: number;
  to: number;
  severity: SceneSeverity;
  message: string;
  source?: string;
  code?: string;
}

export interface SceneHover {
  content: string;
  source?: string;
}

export interface SceneCodeAction {
  title: string;
  changes: SceneTextChange[];
}

export interface SceneHighlight {
  from: number;
  to: number;
  role: SceneHighlightRole;
}

export interface SceneLineRange {
  fromLine: number;
  toLine: number;
}

export interface ShaderCompileResult {
  ok: boolean;
  wgsl: string | null;
  usesTime: boolean;
  usesResolution: boolean;
  usesNoise: boolean;
  error?: string;
}

export interface SceneLangWasmOptions {
  wasmUrl?: string;
  wasmBytes?: ArrayBuffer | Uint8Array;
}

interface SceneLangExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  scene_compile(pointer: number, length: number): number;
  scene_diagnostics_json(pointer: number, length: number): number;
  scene_hover_json(pointer: number, length: number, offset: number): number;
  scene_format_json(pointer: number, length: number): number;
  scene_code_actions_json(pointer: number, length: number, from: number, to: number): number;
  scene_highlights_json(pointer: number, length: number, fromLine: number, toLine: number): number;
  last_result_ptr(): number;
  last_result_len(): number;
}

export class SceneLangAbiError extends Error {
  constructor(message: string, readonly code: "exports" | "status" | "protocol" | "memory" | "trap" | "host") { super(message); this.name = "SceneLangAbiError"; }
}

export interface SceneLangWasm {
  compile(source: string): ShaderCompileResult;
  diagnostics(source: string): SceneDiagnostic[];
  hover(source: string, offset: number): SceneHover | null;
  format(source: string): string;
  codeActions(source: string, selection: { from: number; to: number }): SceneCodeAction[];
  highlights(source: string, lineRange: SceneLineRange): SceneHighlight[];
}

function normalizeBytes(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

async function loadWasmBytes(options: SceneLangWasmOptions): Promise<Uint8Array> {
  if (options.wasmBytes) {
    return normalizeBytes(options.wasmBytes);
  }

  if (!options.wasmUrl) {
    throw new Error("Shader language Wasm requires either `wasmUrl` or `wasmBytes`.");
  }

  const response = await fetch(options.wasmUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch shader language Wasm: ${response.status} ${response.statusText}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function readBytesFromMemory(memory: WebAssembly.Memory, pointer: number, length: number): Uint8Array {
  if (!Number.isSafeInteger(pointer) || !Number.isSafeInteger(length) || pointer < 0 || length < 0 || pointer + length > memory.buffer.byteLength) throw new SceneLangAbiError("Shader language Wasm returned an out-of-bounds result.", "memory");
  const view = new Uint8Array(memory.buffer, pointer, length);
  return new Uint8Array(view);
}

function instantiateSceneLanguage(bytes: Uint8Array): Promise<SceneLangExports> {
  const moduleBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return WebAssembly.compile(moduleBytes)
    .then((module) => WebAssembly.instantiate(module, {}))
    .then((instance) => validateExports(instance.exports));
}

function validateExports(value: WebAssembly.Exports): SceneLangExports {
  const names = ["memory", "alloc", "dealloc", "scene_compile", "scene_diagnostics_json", "scene_hover_json", "scene_format_json", "scene_code_actions_json", "scene_highlights_json", "last_result_ptr", "last_result_len"] as const;
  for (const name of names) {
    if (!(name in value) || (name === "memory" ? !(value[name] instanceof WebAssembly.Memory) : typeof value[name] !== "function")) {
      throw new SceneLangAbiError(`Missing or invalid shader language export: ${name}`, "exports");
    }
  }
  return value as SceneLangExports;
}

function parseJson<T>(bytes: Uint8Array): T {
  try {
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch (cause) {
    throw new SceneLangAbiError(
      `Shader language Wasm returned malformed JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      "protocol"
    );
  }
}

function clampUtf16Offset(source: string, offset: number): number {
  return Math.max(0, Math.min(offset, source.length));
}

function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

function utf16OffsetToUtf8ByteOffset(source: string, offset: number): number {
  const safeOffset = clampUtf16Offset(source, offset);
  let utf16Offset = 0;
  let byteOffset = 0;

  for (const character of source) {
    const nextUtf16Offset = utf16Offset + character.length;

    if (nextUtf16Offset > safeOffset) {
      break;
    }

    byteOffset += utf8ByteLength(character);
    utf16Offset = nextUtf16Offset;
  }

  return byteOffset;
}

function utf8ByteOffsetToUtf16Offset(source: string, offset: number): number {
  const safeOffset = Math.max(0, offset);
  let utf16Offset = 0;
  let byteOffset = 0;

  for (const character of source) {
    const nextByteOffset = byteOffset + utf8ByteLength(character);

    if (nextByteOffset > safeOffset) {
      break;
    }

    byteOffset = nextByteOffset;
    utf16Offset += character.length;
  }

  return utf16Offset;
}

function convertRangeToUtf16<T extends { from: number; to: number }>(source: string, value: T): T {
  return {
    ...value,
    from: utf8ByteOffsetToUtf16Offset(source, value.from),
    to: utf8ByteOffsetToUtf16Offset(source, value.to)
  };
}

function convertChangesToUtf16(source: string, changes: SceneTextChange[]): SceneTextChange[] {
  return changes.map((change) => convertRangeToUtf16(source, change));
}

function convertActionsToUtf16(source: string, actions: SceneCodeAction[]): SceneCodeAction[] {
  return actions.map((action) => ({
    ...action,
    changes: convertChangesToUtf16(source, action.changes)
  }));
}

function applyTextChanges(source: string, changes: SceneTextChange[]): string {
  if (changes.length === 0) {
    return source;
  }

  if (changes.length === 1 && changes[0]?.from === 0 && changes[0]?.to === source.length) {
    return changes[0].insert;
  }

  let cursor = 0;
  let nextText = "";

  for (const change of [...changes].sort((left, right) => left.from - right.from)) {
    nextText += source.slice(cursor, change.from);
    nextText += change.insert;
    cursor = change.to;
  }

  nextText += source.slice(cursor);
  return nextText;
}

function createSceneLangRuntime(exports: SceneLangExports): SceneLangWasm {
  const callWithSource = (name: keyof SceneLangExports, source: string, extraArgs: number[] = []): Uint8Array => {
    const sourceBytes = encoder.encode(source);
    const pointer = exports.alloc(sourceBytes.length);

    try {
      if (!Number.isSafeInteger(pointer) || pointer < 0 || pointer + sourceBytes.length > exports.memory.buffer.byteLength) throw new SceneLangAbiError("Shader language Wasm returned an invalid allocation.", "memory");
      new Uint8Array(exports.memory.buffer, pointer, sourceBytes.length).set(sourceBytes);
      const fn = exports[name];

      if (typeof fn !== "function") {
        throw new SceneLangAbiError(`Missing shader language export: ${String(name)}`, "exports");
      }

      let status: number;
      try {
        status = (fn as (...args: number[]) => number)(pointer, sourceBytes.length, ...extraArgs);
      } catch (cause) {
        if (cause instanceof SceneLangAbiError) throw cause;
        if (cause instanceof WebAssembly.RuntimeError) {
          throw new SceneLangAbiError(`Shader language Wasm trapped: ${cause.message}`, "trap");
        }
        throw new SceneLangAbiError(
          `Shader language Wasm host call failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          "host"
        );
      }

      if (status !== 0) {
        throw new SceneLangAbiError(`Shader language Wasm call ${String(name)} failed with status ${status}.`, "status");
      }

      return readBytesFromMemory(exports.memory, exports.last_result_ptr(), exports.last_result_len());
    } finally {
      exports.dealloc(pointer, sourceBytes.length);
    }
  };

  return {
    compile(source) {
      return parseJson<ShaderCompileResult>(callWithSource("scene_compile", source));
    },
    diagnostics(source) {
      return parseJson<SceneDiagnostic[]>(callWithSource("scene_diagnostics_json", source)).map((diagnostic) =>
        convertRangeToUtf16(source, diagnostic)
      );
    },
    hover(source, offset) {
      return parseJson<SceneHover | null>(
        callWithSource("scene_hover_json", source, [utf16OffsetToUtf8ByteOffset(source, offset)])
      );
    },
    format(source) {
      const changes = convertChangesToUtf16(source, parseJson<SceneTextChange[]>(callWithSource("scene_format_json", source)));
      return applyTextChanges(source, changes);
    },
    codeActions(source, selection) {
      return convertActionsToUtf16(
        source,
        parseJson<SceneCodeAction[]>(
          callWithSource("scene_code_actions_json", source, [
            utf16OffsetToUtf8ByteOffset(source, selection.from),
            utf16OffsetToUtf8ByteOffset(source, selection.to)
          ])
        )
      );
    },
    highlights(source, lineRange) {
      return parseJson<SceneHighlight[]>(
        callWithSource("scene_highlights_json", source, [lineRange.fromLine, lineRange.toLine])
      ).map((highlight) =>
        convertRangeToUtf16(source, highlight)
      );
    }
  };
}

export async function createSceneLangWasm(options: SceneLangWasmOptions): Promise<SceneLangWasm> {
  const bytes = await loadWasmBytes(options);
  const exports = await instantiateSceneLanguage(bytes);
  return createSceneLangRuntime(exports);
}

export const __internal = {
  applyTextChanges,
  convertActionsToUtf16,
  convertChangesToUtf16,
  convertRangeToUtf16,
  utf16OffsetToUtf8ByteOffset,
  utf8ByteOffsetToUtf16Offset,
  validateExports,
  createSceneLangRuntime
};
