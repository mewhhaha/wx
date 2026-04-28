# @wx/playground

Browser playground for the wx editor stack and scene shader language.

The app wires the DOM editor, tree-sitter highlighting, scene language Wasm runtime, worker-backed language services, shader preview, and local development helpers into a Vite application.

## Usage

From the repository root:

```bash
pnpm dev
```

Or target the app directly:

```bash
pnpm --filter @wx/playground dev
```

## Build

```bash
pnpm --filter @wx/playground build
```

The app builds `@wx/scene-lang-wasm` before `dev` and `build` so the Wasm asset is available to Vite.
