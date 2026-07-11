# @wx/scene-lang-wasm

Wasm runtime wrapper for the scene shader language used by the wx playground.

The package builds and exposes `scene-lang.wasm` plus a TypeScript API for compile, diagnostics, hover, formatting, code actions, and highlighting. Callers can provide either a Wasm URL or Wasm bytes.

## Usage

```ts
import sceneLangWasmUrl from "@wx/scene-lang-wasm/scene-lang.wasm?url";
import { createSceneLangWasm } from "@wx/scene-lang-wasm";

const scene = await createSceneLangWasm({ wasmUrl: sceneLangWasmUrl });
const result = scene.compile(source);
```

## Exports

- `createSceneLangWasm(...)`
- scene language diagnostic, hover, code action, highlight, and compile result types
- `./scene-lang.wasm`

## Development

```bash
pnpm --filter @wx/scene-lang-wasm build
```
# Scene language Wasm ABI

Target profile: `core-3-browser` (standard Core WebAssembly and browser JS/Web APIs only; no proposal-only features).

Sources cross the ABI as UTF-8; editor offsets are UTF-16 and converted at the boundary. The host owns `alloc(byteLength)` input storage and always calls `dealloc(pointer, byteLength)`, including for empty input. A call must return status `0`; nonzero status is an ABI error. Results at `last_result_ptr/last_result_len` are borrowed and copied immediately: a later Wasm call or memory growth can invalidate a JS view. Fetch and compilation failures remain host errors. Wasm traps, host-call exceptions, malformed result JSON, missing/invalid exports, invalid pointers, and nonzero statuses surface as typed `SceneLangAbiError` values with codes `trap`, `host`, `protocol`, `exports`, `memory`, and `status` respectively.
