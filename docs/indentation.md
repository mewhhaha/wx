# Indentation

`@mewhhaha/wx-core` stores indentation preferences as serializable data: `indentUnit`
is a tab or one through sixteen spaces; `tabWidth` controls visual tab stops; and
`guideWidth` controls guides. Line endings are detected as LF or CRLF (or configured)
and are preserved by every plan.

`planIndentation` creates normalized, non-overlapping text changes for Enter, open
below, and open above. Duplicate insertion points share an edit and retain selection
mapping. It uses a conservative text fallback: reference indentation is retained,
opening braces/brackets/parentheses indent, and a following closer outdents. Obvious
single-line strings and comments do not participate in delimiter detection. Enter
splits at the caret; open-above and open-below inspect the complete target line, so
their result does not depend on the horizontal cursor position. Open-below inserts
before the complete existing LF or CRLF sequence.

Tree-sitter supports the versioned `wx-indent-v1` capture subset based on the Helix
indent guide as consulted 2026-07-11: `@indent`, `@outdent`, `@align` with exactly one
`@anchor` in its query pattern, and `@opaque`. Same-line `@indent` scopes collapse.
`@indent.always`, `@outdent.always`, `@extend`, `@extend.prevent-once`, and `@header`
are not implemented and must not be used as compatibility claims. Provider responses
are revision-aware; stale, incomplete, and error responses deliberately fall back to
the core planner. An `ok` provider answer describes absolute syntax depth (or an
absolute alignment column), avoiding double indentation from the line's existing
whitespace. `@opaque` suppresses syntax captures and returns `incomplete`, preserving
the current/reference indentation through the plain fallback instead of resetting a
nested comment or template line to column zero. For aligned hints, outdent is applied
to the visual column before that column is rendered as tabs and spaces.

The worker transfers full text only during `open`; indentation requests carry an
offset, action, generation, request id, and revision. Indent queries run only at the
local syntax node and its ancestors, so request work is proportional to syntax depth
rather than document length. Incremental updates remain edit-sized and cancellation
makes obsolete requests harmless. The browser, Deno, and Node worker adapters execute
the same protocol and capture resolver; real TypeScript fixtures run through both local
worker hosts during verification. Controllers should query
the active language provider per insertion point, pass only `status: "ok"` answers to
the planner, apply the returned changes in one transaction, then map cursors from the
plan's insertion offsets.

There is currently no bundled WGSL grammar. WGSL/scene integrations should use their
own grammar/query; shared capture-model tests cover compound/struct closing-brace
semantics without pretending grammar support exists.
