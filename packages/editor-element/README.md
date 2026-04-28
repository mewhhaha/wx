# @mewhhaha/wx-element

Custom element wrapper for the wx DOM editor.

This package defines a `<wx-editor>` element for host pages that prefer declarative markup over directly calling `createEditor(...)`.

## Usage

```ts
import { defineWxEditorElement } from "@mewhhaha/wx-element";

defineWxEditorElement();

const editor = document.querySelector("wx-editor");
if (editor) {
  editor.value = "const value = 1;\n";
}
```

```html
<wx-editor></wx-editor>
```

## Exports

- `WxEditorElement`
- `defineWxEditorElement(tagName?)`
- `wx-update`, `wx-mode-change`, and `wx-selection-change` custom events

## Development

```bash
pnpm --filter @mewhhaha/wx-element build
```
