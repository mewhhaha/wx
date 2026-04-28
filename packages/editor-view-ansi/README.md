# @wx/editor-view-ansi

ANSI terminal renderer for wx editors.

Use this package to render wx editor state into terminal frames, create an ANSI mirror from a controller, or run a terminal editor with Node host services. It also provides the `wx` binary from the built package.

## Usage

```ts
import { createAnsiEditorMirror } from "@wx/editor-view-ansi";

const mirror = createAnsiEditorMirror({
  controller,
  cols: 80,
  rows: 24,
  write(text) {
    process.stdout.write(text);
  }
});

mirror.mount();
```

## Exports

- `renderEditorAnsiFrame(...)`
- `createAnsiEditorMirror(...)`
- `createAnsiEditorTerminal(...)`
- `createNodeHostServices(...)`
- `parseAnsiInput(...)`
- `runAnsiMirrorDemo(...)`

## Development

```bash
pnpm --filter @wx/editor-view-ansi build
pnpm --filter @wx/editor-view-ansi demo
```
