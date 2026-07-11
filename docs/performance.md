# Performance baselines

`scripts/benchmark-editor.mjs` emits format-versioned JSON.  Every timing has separate
`synchronousMs`, `nextPaintMs`, and `settledMs` samples. Mount workloads also report
`firstInteractiveMs`, which waits for the configured language/diagnostic service. Settled means two animation
frames after the action; it is intentionally not a mutation quiet-window and is never
used as a substitute for key-to-paint latency.

The stable smoke suite samples a 1,000-line TypeScript document 30 times for DOM mount,
DOM motion and key-to-paint insertion, headless controller transactions, ANSI frame/write
work, Tree-sitter protocol work, sustained history, and (when Deno plus GNU `script`/`stty`
are installed) the real Deno product terminal under a slave pseudo-TTY plus a Deno Tree-sitter
initialization/open probe.
The scheduled/manual full suite repeats the matrix at 100, 1,000, 5,000, and 20,000 lines
and adds long-line, soft-wrap, Unicode, many-selection, and diagnostic-heavy DOM fixtures.
Many-selection creates up to 256 real controller selections; diagnostic-heavy installs one
diagnostic per fixture line. Browser-only metrics remain explicitly `null` where the browser
does not expose them. Node probes record ANSI output bytes, process heap/RSS deltas, and
Tree-sitter worker-message bytes in both directions.
Browser, Node, Tree-sitter, and Deno lanes run sequentially, as do full-suite line-count
fixtures, so measured processes do not compete with another benchmark lane for CPU or memory.

The ANSI sink matrix keeps the existing `ansi.frame-construction` and
`ansi.key-to-write` IDs for compatibility and additionally emits
`ansi.viewport.{frame-construction,key-to-write}.{100x30,200x60,240x80}`. These use a
real ANSI mirror and byte-counting synchronous sink at each viewport. The sink makes
render/write bytes and synchronous work observable; it intentionally leaves paint or
asynchronous scheduling latency `null` rather than inventing a terminal presentation clock.
The separate `ansi.viewport.render-to-accepted-write.{100x30,200x60,240x80}` scenarios
start at an explicit full-render request and finish only when `mirror.whenIdle()` observes
the promise returned by an event-loop-scheduled writer as accepted. They report accepted-write
latency and bytes, but make no claim about physical terminal transmission or paint.

The CI reference is Ubuntu 24.04, Node 22.22.0, and Playwright Chromium. Local numbers
are useful for diagnosis but are not portable claims. The smoke and full commands
perform a clean workspace build before measuring:

```sh
pnpm bench:editor:smoke
pnpm bench:editor:full
pnpm bench:compare -- --candidate benchmarks/results/latest.json
```

`benchmarks/baselines/editor-v1.json` contains the measured smoke reference and p95 quality
budgets: mount and movement protect responsiveness, while newline key-to-paint protects
typing. The three calibration captures used to select it are committed beside the baseline.
Before updating it, collect three clean runs on the pinned CI image, commit one complete
smoke result with its runtime metadata as the baseline, and review the others for thermal or
host noise. The comparison command rejects missing or under-sampled recorded metrics, requires
at least 30 samples in each compared result, and fails regressions only when both its practical
threshold and robust noise band are exceeded.

Scenario IDs include the fixture (for example,
`controller.transactions.motion-200.1000-line-typescript`) and must be unique. Comparison
matches the full ID, never the first line-count match. `deno.terminal.cold-first-frame` starts
the actual CLI in GNU `script`'s slave pseudo-TTY and ends at the terminal's completed mount
output boundary. `deno.terminal.warm-key-to-write` establishes insert mode, then measures one
printable key through its next completed terminal write. Both report terminal bytes and the
Deno process heap/RSS snapshots taken at those boundaries; they make no fixed-delay or quiet-
window latency claim. The source CLI is always launched with `--conditions development` so a
clean checkout cannot accidentally resolve untracked build output. `deno.treesitter.initialize-open`
uses the shipped Deno adapter with local TypeScript parser Wasm and highlight query, separately
reporting lifecycle readiness and document open. `grammarInitialized` is true only if that work
succeeds. If Deno, GNU `script`, `stty`, or grammar assets are unavailable, affected workloads
are omitted rather than represented by zero-valued rows. Each terminal boundary has a per-sample
timeout and the harness terminates any remaining benchmark-owned PTY child.

The benchmark helper tests cover percentile aggregation, timeouts, malformed and duplicate
results, and regression gating. Optimization work should cite the exact scenario it improves.

## Incremental document storage (P1-05)

`document.single-character-edit.<fixture>` isolates the storage path used by the P0-03
controller and sustained-history profiles. In addition to timing, it reports deterministic
`scannedCodeUnits`, `touchedPieces`, `indexedBytes`, `metadataBytes`, and `pieceCount`.
At 20,000 lines, a middle one-character insertion must scan one inserted code unit, touch two
existing ranges, allocate no newline-index bytes, and leave `text` unmaterialized. These work
counters are the correctness gate; sub-millisecond timings alone are too noisy to prove that
work is independent of document length.

`document.storage-candidate-evaluation.<fixture>` runs the same steady-state edit through the
selected piece table and diagnostic persistent-rope and incrementally-indexed-string models.
It records timings plus representation-specific retained-work counters. The decision and a
30-sample local report are in [P1-05 storage evaluation](./p1-05-storage-evaluation.md).

`memory.sustained-edit-history.<fixture>` performs 250 insert groups and reports both process
heap/RSS deltas and deterministic `retainedBytes`/`retainedEntries`. Process deltas remain
diagnostic because garbage-collection scheduling makes them non-monotonic. The enforceable
product budget is at most 200 total undo/redo/pending snapshots and 8 MiB of estimated unique
document, index, cache, and entry storage. Both limits are configurable with
`createSnapshotHistory`; `CreateEditorControllerOptions.historyOptions` configures the default
controller history. Focused tests exercise the count, byte, insert-grouping, selection, undo,
and redo boundaries.
