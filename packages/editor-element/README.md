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

## Embedding and ownership contract

`value` is a two-way property: assignment replaces the current document and
internal edits update the value returned by the getter. Assignments made while
the element is disconnected are applied on its next connection. When a
controller is assigned, that controller is the initial value source and remains
owned by the caller; disconnecting the element never destroys it. Without a
supplied controller, each connection gets a fresh element-owned controller and
the last document value is restored.

Language-service lifetime is declared by `services.lifecycle.owner`:

- `external` (and omitted ownership) survives view and controller destruction;
- `controller` is destroyed with its owning controller;
- `view` is destroyed with the individual DOM view and must not be shared.

Use `external` for a worker or service bundle shared by multiple elements.
`wx-update` events preserve controller order and are not emitted while the
element is disconnected.

## Development

```bash
pnpm --filter @mewhhaha/wx-element build
```
