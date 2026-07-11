# @wx/playground

Browser playground for the wx editor stack and scene shader language.

The app wires the DOM editor, tree-sitter highlighting, scene language Wasm runtime, worker-backed language services, shader preview, and local development helpers into a Vite application.

## Usage

From the repository root:

```bash
pnpm dev
```

Or target the app directly:

```bash
pnpm --filter @wx/playground dev
```

## Build

```bash
pnpm --filter @wx/playground build
```

The app builds `@wx/scene-lang-wasm` before `dev` and `build` so the Wasm asset is available to Vite.

## Browser verification

The fast pull-request Chromium project runs from the repository root:

```bash
pnpm test:e2e:ci
```

`test:e2e:ci` and `test:e2e:chromium-smoke` are aliases for the
`chromium-smoke` Playwright project. They cover the production-relevant
playground path, degraded startup, browser input/accessibility, and host
operations without running the heavier lifecycle matrix.

The Pages-equivalent smoke path builds the app with a non-root repository base,
serves that production output, and verifies that scripts, styles, workers,
grammars, and Wasm stay beneath the injected base:

```bash
pnpm test:e2e:production
```

P1-03's cache-disabled editor-only first-load check uses the same Pages base in
an isolated context with cache-bypassing headers and service workers blocked:

```bash
pnpm test:e2e:web-lifecycle-production
```

Set `WX_E2E_REPOSITORY=owner/repository-name` to reproduce a particular Pages
base locally. Failed runs retain traces, screenshots, video, and the collected
browser failure log under `test-results`.

Run the Chromium smoke, DOM engine matrix, and cache-disabled production
lifecycle check with `pnpm test:e2e`.

## DOM browser compatibility matrix

The repository lockfile pins Playwright 1.59.1 and its Linux browser builds:

| Project | Playwright browser build | Emulation |
| --- | --- | --- |
| `dom-chromium` | Chromium 147.0.7727.15 (build 1217) | Desktop Chrome, DPR 2 |
| `dom-firefox` | Firefox 148.0.2 (build 1511) | Desktop Firefox, DPR 2 |
| `dom-webkit` | WebKit 26.4 (build 2272) | Desktop Safari, DPR 2 |

These are the Playwright-patched desktop engines, not a claim that every
branded browser with the same marketing version was tested. Use
`pnpm exec playwright install --dry-run` to inspect the builds selected by the
current lockfile.

The compatibility suite uses `?fixture=editor`, blocks service workers, and
installs a throwing `navigator.gpu` getter. It exercises the DOM editor and a
real Worker response boundary without creating a preview or loading scene
language assets, so hardware WebGPU availability cannot affect the result.
Chromium smoke uses the normal DPR 1 desktop profile; the matrix repeats the
viewport contract at DPR 2.

Run the fast Chromium feedback loop with `pnpm test:e2e:chromium-smoke`. Run a
single compatibility engine with `pnpm test:e2e:dom-chromium`,
`pnpm test:e2e:dom-firefox`, or `pnpm test:e2e:dom-webkit`; run all three with
`pnpm test:e2e:dom-matrix`. The suite records console errors, page errors,
unhandled rejections, worker failures, and failed critical asset requests.

### Known limitations

- Modern module workers, `ResizeObserver`, and the WebAssembly baseline are
  required. Obsolete browsers without them are unsupported.
- Coverage is desktop/headless. Mobile virtual keyboards, OS IME candidate
  windows, branded-browser policy, extensions, and assistive-technology speech
  output need separate manual testing.
- Cross-engine Playwright cannot mutate DPR on a live browser context. The
  suite covers DPR 1 and DPR 2 contexts, then performs live resize and CSS zoom
  changes while asserting cursor, wrapping, overflow, and bounded-node
  invariants.
- Hidden-tab coverage opens and foregrounds a real second Playwright page.
  Headless engines that keep every renderer `visible` receive an explicit
  `visibilitychange` fallback before the return-to-foreground assertion. This
  does not reproduce operating-system suspension or aggressive mobile
  background throttling.
