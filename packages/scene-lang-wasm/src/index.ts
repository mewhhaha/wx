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
  const view = new Uint8Array(memory.buffer, pointer, length);
  return new Uint8Array(view);
}

function instantiateSceneLanguage(bytes: Uint8Array): Promise<SceneLangExports> {
  return WebAssembly.instantiate(bytes, {}).then((result) => result.instance.exports as SceneLangExports);
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
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
      new Uint8Array(exports.memory.buffer, pointer, sourceBytes.length).set(sourceBytes);
      const fn = exports[name];

      if (typeof fn !== "function") {
        throw new Error(`Missing shader language export: ${String(name)}`);
      }

      const status = (fn as (...args: number[]) => number)(pointer, sourceBytes.length, ...extraArgs);

      if (status !== 0) {
        throw new Error(`Shader language Wasm call ${String(name)} failed with status ${status}.`);
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
      return parseJson<SceneDiagnostic[]>(callWithSource("scene_diagnostics_json", source));
    },
    hover(source, offset) {
      return parseJson<SceneHover | null>(callWithSource("scene_hover_json", source, [offset]));
    },
    format(source) {
      const changes = parseJson<SceneTextChange[]>(callWithSource("scene_format_json", source));
      return applyTextChanges(source, changes);
    },
    codeActions(source, selection) {
      return parseJson<SceneCodeAction[]>(
        callWithSource("scene_code_actions_json", source, [selection.from, selection.to])
      );
    },
    highlights(source, lineRange) {
      return parseJson<SceneHighlight[]>(
        callWithSource("scene_highlights_json", source, [lineRange.fromLine, lineRange.toLine])
      );
    }
  };
}

export async function createSceneLangWasm(options: SceneLangWasmOptions): Promise<SceneLangWasm> {
  const bytes = await loadWasmBytes(options);
  const exports = await instantiateSceneLanguage(bytes);
  return createSceneLangRuntime(exports);
}
