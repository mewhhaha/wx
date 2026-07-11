# @wx/editor-view-ansi

ANSI terminal renderer for wx editors.

Use this package to render wx editor state into terminal frames, create an ANSI mirror from a controller, or run the optional Node compatibility terminal editor.

## Deno terminal (primary local entrypoint)

Run from source without Node or pnpm:

```bash
deno task wx -- path/to/file
# or
deno run --conditions development --allow-read --allow-write --allow-run=git packages/editor-view-ansi/src/deno-cli.ts path/to/file
```

`--allow-read` opens files and loads `.wx/config.json`; `--allow-write` saves files; and `--allow-run=git` discovers a Git project root and powers the picker. If Git is unavailable, wx safely uses the current directory and walks it instead. Plain-text editing does not start Tree-sitter, fetch assets, or require Node/pnpm.

Optional project-local syntax configuration lives in `.wx/config.json`; assets are contained under `.wx/grammars`:

```json
{
  "languages": [{
    "id": "typescript",
    "aliases": ["ts"],
    "extensions": [".ts", ".tsx"],
    "filenames": ["tsconfig.json"],
    "grammar": "typescript",
    "queryFile": "typescript.scm",
    "indentQueryFile": "typescript-indent.scm"
  }]
}
```

The same file can include a serializable controller keymap. It uses the browser host
schema (`version: 1`, optional `unbind`, and `bindings` with `keys`, `command`, and
optional `modes`/`context`/`args`); invalid commands and conflicting prefixes stop
startup with the controller's actionable keymap error. For example:

```json
{ "keymap": { "version": 1, "unbind": [{ "keys": "x", "modes": ["normal"] }], "bindings": [{ "keys": "x", "command": "mode.insert", "modes": ["normal"] }] } }
```

This expects `web-tree-sitter.wasm`, `typescript.wasm`, and the named query files in `.wx/grammars`. A configured language starts its worker only when that file type is selected; a config with no `languages` does not import or evaluate Tree-sitter. Indent queries support the `wx-indent-v1` subset: `@indent`, `@outdent`, `@align` with one `@anchor`, and `@opaque`; `@indent.always`, `@outdent.always`, `@extend`, `@extend.prevent-once`, and `@header` are unsupported.

Install and uninstall:

```bash
deno install --global --config ./deno.json --conditions development --allow-read --allow-write --allow-run=git --name wx packages/editor-view-ansi/src/deno-cli.ts
deno uninstall wx
```

The repository `deno.json` explicitly enables Deno's granular `sloppy-imports`
compatibility while the shared TypeScript sources retain extensionless relative imports for
the browser/package bundlers. `deno install` copies that configuration into the installed
launcher, so the installed command uses the same documented resolver contract.

The terminal restores raw mode, cursor visibility, and the alternate screen on normal quit, Ctrl+C, SIGINT, and SIGTERM. `SIGWINCH` resizes the active frame. Terminal crash cleanup is best-effort through the CLI error boundary; hard process termination cannot be intercepted by any terminal application.

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

`keymap` may be supplied to `createAnsiEditorMirror` or `createAnsiEditorTerminal`
only when that host creates the controller. Supplying both `controller` and `keymap`
throws, so ownership is never silently ambiguous. Pending multi-key help is derived
from the registry and shows the first six entries in registry order.

## Exports

- `renderEditorAnsiFrame(...)`
- `createAnsiEditorMirror(...)`
- `createAnsiEditorTerminal(...)`
- `createNodeHostServices(...)`
- `createDenoHostServices(...)` (Deno entry only)
- `parseAnsiInput(...)`
- `runAnsiMirrorDemo(...)`

## Development

```bash
pnpm --filter @wx/editor-view-ansi build
pnpm --filter @wx/editor-view-ansi demo
```
