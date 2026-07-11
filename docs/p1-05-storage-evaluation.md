# P1-05 storage evaluation

## Decision

wx uses an immutable flat piece table with per-source newline indexes and per-revision piece
prefix indexes. Revisions share the original and inserted source strings. `text` remains a
compatible lazy view, while `charAt`, `slice`, `lineAt`, `positionAt`, and `offsetAt` operate on
the indexed pieces. Inactive history revisions release any derived whole-text cache.

This is the simplest candidate that met the measured wx workload. A persistent rope has a
better asymptotic bound for very long edit sessions, but its tree/rebalancing complexity and
node cost did not buy anything in the current 250-group history workload. An incrementally
maintained line index cannot fix the immutable JavaScript string copy/retention cost.

## Reproducible candidate measurement

The diagnostic scenario is
`document.storage-candidate-evaluation.20000-line-typescript`. It edits the midpoint of the
same 497,779-code-unit, 20,000-line fixture used by the full P0-03 matrix. Initialization is
outside the timed region. The rope uses 4,096-code-unit leaves and a persistent balanced
starting tree; the incrementally indexed string copies its immutable line-start array and
shifts only affected offsets. The product piece-table measurement uses its public storage
counters.

On 2026-07-11, 30 samples on Node 24.12.0, Linux x86-64, Ryzen 7 7800X3D produced:

| representation | edit p50 / p95 | deterministic retained/edit work | line/offset access | result |
| --- | ---: | --- | --- | --- |
| flat piece table | 0.0050 / 0.0099 ms | 1 code unit scanned; 2 pieces touched; 192 B revision metadata; 0 B newline index | binary-search piece prefixes and source newline offsets | chosen |
| persistent rope diagnostic | 0.0141 / 0.0211 ms | 12 nodes; 768 B estimated node metadata, plus one leaf split | logarithmic tree walk | unnecessary complexity for measured sessions |
| incrementally indexed string diagnostic | 0.2224 / 0.3409 ms | 1,155,560 B new text/index retention; 9,572 line starts shifted | binary-search line starts | rejected: whole immutable text remains the dominant cost |

Wall times are a local diagnostic, not portable budgets. The deterministic counters are the
important evidence: the selected edit work does not depend on the fixture's 497,779 existing
code units or 19,999 newline offsets. Re-run with:

```sh
pnpm build
node scripts/benchmark-editor.mjs --mode full --samples 30 --lines 20000
```

## Correctness and compatibility

`StringTextDocument` remains the string-model oracle. A deterministic seeded model test runs
400 randomized, unordered, non-overlapping multi-edits and compares text, every line,
character access, positions, offsets, slices, and normalized selections after every step.
Regression fixtures separately cover a newline in a prior piece, UTF-16 surrogate halves,
CRLF and mixed endings, an empty final line, edits at shared boundaries, and rejected overlap.

The `TextDocument.text`, `length`, `lineCount`, `slice`, line/position methods, and edit behavior
remain available. `charAt(offset)` is the one additive interface requirement for custom
`TextDocument` implementations; it returns one UTF-16 code unit just like `String.charAt`.
Public cursor/lifecycle paths use document identity, indexed queries, or `charAt`, so a
cursor-only controller update does not force `text`.

## History memory budget

The default hard limits cover all undo, redo, and pending entries together:

- `maxEntries`: 200 snapshots.
- `maxRetainedBytes`: 8 MiB.

Retention accounting deduplicates shared source buffers and documents, and includes UTF-16
source bytes, newline arrays, piece descriptors, prefix arrays, materialized compatibility
caches, document/source overhead, selection ranges, and retained yank text. On the same local
20,000-line run, `memory.sustained-edit-history` completed 250 insert groups in 101.24 ms p50 /
111.33 ms p95 and retained 200 entries at exactly 3,180,116 estimated bytes (p50 and p95), below
the 8 MiB limit. Heap/RSS deltas are still emitted for diagnosis, but are not used as the hard
budget because an unforced Node garbage collector makes those deltas non-monotonic.

## P0-03 scenarios improved

The implementation report uses the full fixture-qualified IDs at 100, 1,000, 5,000, and
20,000 lines:

- `controller.transactions.motion-200.<fixture>` no longer materializes document text merely
  to decide whether a cursor-only lifecycle update changed the document.
- `memory.sustained-edit-history.<fixture>` retains shared revisions under explicit count and
  byte limits rather than unbounded whole strings.
- `document.single-character-edit.<fixture>` isolates the edit and incremental-index work.
- `document.storage-candidate-evaluation.<fixture>` records the representation decision.

Run `pnpm bench:editor:full` and compare these exact IDs before changing the representation,
piece compaction policy, or history budgets.
