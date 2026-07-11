# @mewhhaha/wx-dom

`createEditor(container, { keymap })` accepts the controller's serializable keymap v1
schema when the DOM host creates the controller. Supplying both a prebuilt `controller`
and `keymap` throws; configure the prebuilt controller directly. Pending key-sequence
help is registry-derived and displays the first six entries in registry order.

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

`destroy()` is idempotent. A controller passed through `options.controller`
remains caller-owned; a controller created by `createEditor` is destroyed with
the handle. Language-service lifecycle ownership follows
`services.lifecycle.owner`: `view` is handle-owned, `controller` is
controller-owned, and `external` (or omitted ownership) is never destroyed by
the DOM view. Shared service bundles should therefore use `external`.

## Exports

- `createEditor(...)`
- `CreateEditorOptions`
- `EditorHandle`
- DOM host and line-change types

## Development

```bash
pnpm --filter @mewhhaha/wx-dom build
```
