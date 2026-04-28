# @mewhhaha/wx-dom

Imperative DOM renderer for wx editors.

Use `createEditor(...)` to mount an editor into an existing element. The returned handle exposes the controller, lifecycle methods, value updates, theme updates, language services, file path updates, and subscriptions.

## Usage

```ts
import { createEditor } from "@mewhhaha/wx-dom";
import { defaultTheme } from "@mewhhaha/wx-theme";

const editor = createEditor(document.getElementById("editor")!, {
  value: "fn main() {\n  return;\n}\n",
  theme: defaultTheme,
  softWrap: true
});

editor.focus();
```

## Exports

- `createEditor(...)`
- `CreateEditorOptions`
- `EditorHandle`
- DOM host and line-change types

## Development

```bash
pnpm --filter @mewhhaha/wx-dom build
```
