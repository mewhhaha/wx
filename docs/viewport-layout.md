# Viewport-scoped layout

wx stores only the visual rows needed by the active viewport. Unwrapped geometry is closed-form: document line `n` is visual row `n`, so resolving 100 visible rows performs the same bounded work in a 1,000-line or a 20,000-line document. Soft-wrapped geometry uses stable logical row identities (`docLine`, `wrapSegment`) and learns wrap counts only for lines that navigation or rendering touches.

Wrapped totals deliberately expose an exactness flag. With the public `TextDocument` contract, calculating an exact total after every wrap-width change would require reading every line. `viewport.totalVisualRowsExact` is therefore `true` for unwrapped documents and `false` for a sparse wrapped window. Navigation, scroll anchors, and renderer keys do not depend on an estimated global ordinal.

## Cache and invalidation contract

Document geometry depends only on the immutable document identity/revision, soft-wrap mode, wrap width, and measured viewport capacity. Theme colors, diagnostics, highlights, searches, and selections do not invalidate it.

- Cursor movement inside the current scrolloff bounds resolves the target row but rebuilds zero rows.
- Crossing scrolloff shifts one bounded window.
- Edits map the top source anchor through the ordered text changes. An edit below the window leaves it fixed; edits above or inside remap it before resolving the bounded window.
- Resize and wrap changes preserve the top source anchor, increment the geometry generation, and resolve the new containing segment.
- History restore or whole-value replacement without change metadata clamps the existing source anchor and performs a bounded fallback rebuild.
- Each workspace pane resolves its own bounded window at its own width; split layout no longer builds a full-document row array per pane.

The current overscan is zero. DOM node count is bounded by visible document rows, filler rows, at most one inline diagnostic attachment per visible row, panels, and chrome.

## Evidence and budgets

`VisualLayoutIndex.counters` records rows visited/built and sparse wrap-cache work. The controller publishes the most recent sample at `presentation.viewport.layoutWork`. A cursor-only move within a stable viewport is gated by unit tests at `rowsRebuilt = 0` and at most three visited rows. The benchmark records `materializedVisualRows` and `domNodes` alongside timing.

The exact P0 scenarios affected are:

- `controller.transactions.motion-200.<fixture>`
- `dom.key-to-paint.motion-200.<fixture>`
- `dom.key-to-paint.soft-wrap.<fixture>`
- `dom.key-to-paint.long-line.<fixture>`
- `dom.key-to-paint.many-selection.<fixture>`
- `dom.key-to-paint.diagnostic-heavy.<fixture>`

The full benchmark runs those scenarios at 100, 1,000, 5,000, and 20,000 lines. Structural counters and node counts are the primary proof of bounded work; p50/p95 timings remain the regression gate for user-visible latency.
