# @mewhhaha/wx-theme

Theme types, defaults, presets, and CSS variable generation for wx editors.

Themes are small objects keyed by editor roles. Renderers can resolve fallback colors or convert a theme to `--wx-color-*` CSS variables.

## Usage

```ts
import { createThemeVariables, defaultTheme } from "@mewhhaha/wx-theme";

const variables = createThemeVariables(defaultTheme);
```

## Exports

- `ThemeSpec` and `ThemeRole`
- `defaultTheme`
- `resolveThemeColor(...)`
- `createThemeVariables(...)`
- `normalizeCommandThemes(...)`
- bundled presets including `graphiteTheme`, `mintTheme`, `phTheme`, and `playgroundThemes`

## Development

```bash
pnpm --filter @mewhhaha/wx-theme build
```
