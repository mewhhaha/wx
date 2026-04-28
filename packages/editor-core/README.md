# @mewhhaha/wx-core

Core editor data structures and text operations for the wx editor stack.

This package contains the editor state model, document helpers, selection commands, and search utilities used by the controller and renderers. It has no runtime dependency on the DOM.

## Usage

```ts
import { createEditorState, createTextDocument } from "@mewhhaha/wx-core";

const state = createEditorState({
  value: "const answer = 42;\n"
});

const document = createTextDocument(state.doc.text);
```

## Exports

- text document creation and offset/position helpers
- editor state creation and transaction helpers
- command primitives for selections and edits
- search match collection utilities

## Development

```bash
pnpm --filter @mewhhaha/wx-core build
```
