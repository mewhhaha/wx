# @mewhhaha/wx-language

Language-service contracts for the wx editor stack.

Use this package to describe highlighting, diagnostics, hover, completion, formatting, code actions, symbols, rename, comments, textobjects, and language registry behavior without depending on a specific parser or renderer.

## Usage

```ts
import { createLanguageRegistry, type EditorLanguageServices } from "@mewhhaha/wx-language";

const services: EditorLanguageServices = {
  async diagnostics() {
    return [];
  }
};

const registry = createLanguageRegistry([
  {
    id: "typescript",
    extensions: [".ts", ".tsx"],
    services
  }
]);
```

## Exports

- `EditorLanguageServices` and related provider interfaces
- `createLanguageRegistry(...)`
- `languageProviderToServices(...)` for legacy highlighter providers
- shared types for highlights, diagnostics, code actions, hover, symbols, and formatting

## Development

```bash
pnpm --filter @mewhhaha/wx-language build
```
