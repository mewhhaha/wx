# wx

`wx` is a browser editor stack with a DOM renderer, controller-owned editor session, theming, and pluggable language services.

This repo currently uses workspace-private packages, so the examples below assume you are consuming `wx` from this monorepo or from a local workspace that can resolve the `@mewhhaha/wx-*` packages. The plain HTML examples are "no React" examples, not copy-paste CDN snippets.

## JSR Publish Status

Base editor packages now have package-local `deno.json` publish config for JSR:

- `@mewhhaha/wx-core`
- `@mewhhaha/wx-language`
- `@mewhhaha/wx-layout`
- `@mewhhaha/wx-theme`
- `@mewhhaha/wx-controller`
- `@mewhhaha/wx-dom`
- `@mewhhaha/wx-element`

Run dry-run validation with:

```bash
pnpm run jsr:check:editor
```

Assumptions in current config:

- JSR scope: `@mewhhaha`
- Current publish target for bumped editor packages: `0.1.2`
- License: `MIT`

If any of those should differ, update package-local `deno.json` files before first publish.

## Packages

- `@mewhhaha/wx-dom`
  Imperative DOM editor setup with `createEditor(...)`.
- `@mewhhaha/wx-element`
  A custom element wrapper for declarative host pages.
- `@mewhhaha/wx-controller`
  Editor session, viewport, search, registers, jumps, and language orchestration.
- `@mewhhaha/wx-language`
  Highlighting, diagnostics, hover, formatting, code actions, comments, and syntax helpers.
- `@mewhhaha/wx-theme`
  Theme shape and CSS variable generation.

## Quick Start

If you are working in this repo:

```bash
pnpm install
pnpm build
```

For the fastest local CI-style sanity pass:

```bash
pnpm run verify:workspace
```

For the playground:

```bash
pnpm dev
```

## CI Notes

- CI installs with `pnpm install --frozen-lockfile`, so package manifest changes must be accompanied by a matching `pnpm-lock.yaml` update.
- `pnpm run verify:workspace` is the quickest local check for the same build-and-unit-test path used by workspace verification.

## Plain DOM Setup

Use `createEditor(...)` when you want the lowest-level integration surface.

```ts
import { createEditor } from "@mewhhaha/wx-dom";
import { defaultTheme } from "@mewhhaha/wx-theme";

const mount = document.getElementById("editor");

if (!mount) {
  throw new Error("Missing #editor mount");
}

const editor = createEditor(mount, {
  value: [
    "fn main() {",
    "  let answer = 42;",
    "}"
  ].join("\n"),
  theme: defaultTheme,
  softWrap: true
});

editor.focus();
```

Suggested host markup:

```html
<div id="editor" style="height: 480px; border: 1px solid #30363d;"></div>
```

Notes:

- `createEditor(...)` mounts immediately into the container you pass in.
- Call `editor.destroy()` when the host page tears down the mount.
- Call `editor.setValue(...)`, `editor.setTheme(...)`, `editor.setLanguageServices(...)`, `editor.resetLanguageServices()`, `editor.setLanguageRegistry(...)`, or `editor.setFilePath(...)` later.

## Declarative Language Config

Use `createLanguageRegistry([...])` for Helix-style file matching without a separate config file.

```ts
import { createEditor } from "@mewhhaha/wx-dom";
import { createLanguageRegistry } from "@mewhhaha/wx-language";

const languageRegistry = createLanguageRegistry([
  {
    id: "typescript",
    extensions: [".ts", ".tsx"],
    services: createTypeScriptServices()
  },
  {
    id: "scene",
    extensions: [".scene"],
    services: createSceneLanguageServices()
  },
  {
    id: "dockerfile",
    filenames: ["Dockerfile"],
    services: createDockerfileServices()
  }
]);

createEditor(document.getElementById("editor")!, {
  filePath: "src/main.ts",
  languageRegistry
});
```

Resolution order:

- exact basename from `filenames`
- longest matching suffix from `extensions`
- fallback `matchDocumentKind(filePath)`

Precedence:

- registry auto-resolution runs only when no manual override is active
- `editor.setLanguage(...)` and `editor.setLanguageServices(...)` switch to manual mode
- `editor.resetLanguageServices()` returns to registry-driven auto mode

## Plain HTML With a Small Module Entry

If you want a non-React page, pair a simple HTML file with a small module script.

`index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>wx embed</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
      }

      #editor {
        height: 100vh;
      }
    </style>
  </head>
  <body>
    <div id="editor"></div>
    <script type="module" src="/main.ts"></script>
  </body>
</html>
```

`main.ts`

```ts
import { createEditor } from "@mewhhaha/wx-dom";

const mount = document.getElementById("editor");

if (!mount) {
  throw new Error("Missing #editor mount");
}

createEditor(mount, {
  value: "const message = 'hello';\nconsole.log(message);\n"
});
```

## Custom Element Setup

Use the element wrapper when you want a declarative host surface.

```ts
import { defineWxEditorElement } from "@mewhhaha/wx-element";

defineWxEditorElement();
```

Then in your page:

```html
<wx-editor id="editor"></wx-editor>
```

And configure it:

```ts
const element = document.getElementById("editor");

if (!(element instanceof HTMLElement) || !("value" in element)) {
  throw new Error("Missing wx-editor");
}

(element as HTMLUnknownElement & { value: string }).value = "alpha\nbeta\ngamma\n";
```

If you want stronger typing in app code:

```ts
import { WxEditorElement } from "@mewhhaha/wx-element";

const element = document.querySelector("wx-editor");

if (!(element instanceof WxEditorElement)) {
  throw new Error("Missing wx-editor");
}

element.value = "one\ntwo\nthree\n";
```

## React Setup

Use a ref plus `useEffect`, and destroy the editor on unmount.

```tsx
import { useEffect, useRef } from "react";
import { createEditor, type EditorHandle } from "@mewhhaha/wx-dom";
import { defaultTheme } from "@mewhhaha/wx-theme";

export function WxEditor() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }

    const editor = createEditor(mountRef.current, {
      value: "let value = 42;\n",
      theme: defaultTheme,
      softWrap: true
    });

    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  return <div ref={mountRef} style={{ height: 480 }} />;
}
```

If props change later:

```tsx
useEffect(() => {
  void editorRef.current?.setValue(value);
}, [value]);

useEffect(() => {
  editorRef.current?.setTheme(theme);
}, [theme]);
```

## Language Services

Pass `languageServices` when you want syntax highlighting and editor intelligence.

```ts
import type { EditorLanguageServices } from "@mewhhaha/wx-language";

const languageServices: EditorLanguageServices = {
  highlighter: {
    async open() {},
    async update() {},
    async getHighlights(lines, revision) {
      return [];
    }
  },
  diagnostics: {
    async diagnostics(document) {
      return [];
    }
  },
  hover: {
    async hover(document, offset) {
      return null;
    }
  },
  formatter: {
    async format(context) {
      return [];
    }
  }
};

createEditor(mount, {
  value: "const value = 1;\n",
  languageServices
});
```

You can also pass an older `LanguageProvider`, and `wx` will adapt it through `languageProviderToServices(...)`, but new integrations should prefer `EditorLanguageServices`.

## Saving and Diff Gutters

If you want `:w`, git-style line change markers, or post-save hooks, pass `host`.

```ts
createEditor(mount, {
  filePath: "src/demo.ts",
  value: "export const answer = 42;\n",
  host: {
    async writeFile({ filePath, text }) {
      console.log("write", filePath, text);
    },
    async getLineChanges({ filePath, text }) {
      return [
        { line: 0, kind: "modified" },
        { line: 4, kind: "added" }
      ];
    },
    didWriteFile({ filePath }) {
      console.log("saved", filePath);
    }
  }
});
```

`host` responsibilities:

- `writeFile(...)`
  Called by `:w`.
- `getLineChanges(...)`
  Used for diff gutter markers.
- `didWriteFile(...)`
  Optional post-save hook.

## Themes

Themes are plain objects:

```ts
import type { ThemeSpec } from "@mewhhaha/wx-theme";

const graphite: ThemeSpec = {
  name: "graphite",
  colors: {
    background: "#131416",
    text: "#f2efe6",
    keyword: "#8ccf7e",
    string: "#93c5fd",
    cursor: "#f2efe6",
    cursorText: "#131416"
  }
};
```

Pass a theme directly:

```ts
createEditor(mount, {
  value: "fn main() {}\n",
  theme: graphite
});
```

To let the built-in `:theme` command cycle through multiple themes:

```ts
createEditor(mount, {
  value: "fn main() {}\n",
  theme: graphite,
  commandThemes: [graphite]
});
```

The playground has working examples in:

- `apps/playground/src/main.ts`
- `apps/playground/src/phTheme.ts`

## Useful Instance Methods

`createEditor(...)` returns an `EditorHandle` with:

- `focus()`
- `destroy()`
- `format()`
- `getCodeActions()`
- `applyCodeAction(action)`
- `getState()`
- `subscribe(listener)`
- `setFilePath(filePath)`
- `setLanguageServices(languageServices)`
- `setLanguageRegistry(languageRegistry)`
- `resetLanguageServices()`
- `setLanguage(languageProvider)`
- `setTheme(theme)`
- `setValue(value)`

## Minimal React Wrapper With Controlled Updates

If you want a slightly more complete pattern:

```tsx
import { useEffect, useRef } from "react";
import { createEditor, type EditorHandle } from "@mewhhaha/wx-dom";
import type { EditorLanguageServiceInput } from "@mewhhaha/wx-language";
import type { ThemeSpec } from "@mewhhaha/wx-theme";

interface WxEditorProps {
  value: string;
  theme: ThemeSpec;
  languageServices?: EditorLanguageServiceInput | null;
}

export function WxEditor({ value, theme, languageServices = null }: WxEditorProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }

    const editor = createEditor(mountRef.current, {
      value,
      theme,
      languageServices
    });

    editorRef.current = editor;
    return () => editor.destroy();
  }, []);

  useEffect(() => {
    void editorRef.current?.setValue(value);
  }, [value]);

  useEffect(() => {
    editorRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    void editorRef.current?.setLanguageServices(languageServices ?? null);
  }, [languageServices]);

  return <div ref={mountRef} style={{ height: "100%" }} />;
}
```

## Current Caveats

- The packages are still marked `private`, so this is currently a workspace-first integration story.
- The editor is imperative; React wrappers should treat it as a mounted subsystem, not as a tree of React-controlled text nodes.
- The custom element wrapper is intentionally thin. For more control, use `createEditor(...)` directly.
