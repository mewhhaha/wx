# @wx/scene-lang-worker

Worker-backed wx language services for the scene shader language.

This package wraps `@wx/scene-lang-wasm` behind a module worker and exposes wx-compatible highlighting, diagnostics, hover, formatting, code action, and WGSL comment toggling services.

## Usage

```ts
import sceneLangWasmUrl from "@wx/scene-lang-wasm/scene-lang.wasm?url";
import { createSceneLangLanguageServices } from "@wx/scene-lang-worker";

const services = createSceneLangLanguageServices({
  wasmUrl: sceneLangWasmUrl
});
```

## Exports

- `createSceneLangLanguageServices(...)`
- `SceneLangWorkerServices`
- `SceneLangLanguageServicesOptions`

## Development

```bash
pnpm --filter @wx/scene-lang-worker build
```
