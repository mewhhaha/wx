# @mewhhaha/wx-layout

Presentation layout helpers for wx editor renderers.

This package turns editor state, controller presentation state, highlights, diagnostics, selections, search matches, and viewport information into row-oriented layout data that DOM and terminal renderers can consume.

## Usage

```ts
import { buildEditorLayout } from "@mewhhaha/wx-layout";

const layout = buildEditorLayout({
  state,
  presentation,
  hoverAnchor: { col: 0, row: 0 },
  indentGuides: {
    render: true,
    character: "|",
    skipLevels: 0,
    indentWidth: 2
  }
});
```

## Exports

- `buildEditorLayout(...)` and `buildEditorWorkspaceLayout(...)`
- visual row and viewport helpers
- token roles shared by renderers
- file picker presentation helpers

## Development

```bash
pnpm --filter @mewhhaha/wx-layout build
```
