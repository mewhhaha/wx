# @wx/editor-tree-sitter

Tree-sitter language-service adapter for wx editors.

This package bridges `web-tree-sitter` parsers into wx language services. The browser entry uses a module worker by default, and the package also exposes Node-oriented worker entry points for terminal or server-side integration.

## Usage

```ts
import { createTreeSitterLanguageServices } from "@wx/editor-tree-sitter";

const services = createTreeSitterLanguageServices({
  parserWasmUrl: "/tree-sitter.wasm",
  languageWasmUrl: "/tree-sitter-typescript.wasm",
  query: "(identifier) @variable"
});
```

## Exports

- `createTreeSitterLanguageProvider(...)`
- `createTreeSitterLanguageServices(...)`
- `TreeSitterLanguageProvider`
- `typescriptHighlightQuery`
- `./node` for Node host helpers
- `./node-worker` for the Node worker entry

## Development

```bash
pnpm --filter @wx/editor-tree-sitter build
```
