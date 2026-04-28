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
