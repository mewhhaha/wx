# WHX Motion Spec

This document defines the current editor motion semantics for `normal`, `insert`, and `visual` mode.

## Selection Model

- In `insert` mode, the selection is a collapsed insertion point.
- In `normal` mode, the active selection is character-based. The active character is `head`, and the rendered selection covers `min(anchor, head)` through `max(anchor, head) + 1`.
- In `visual` mode, the same character-based range model is used, but motions extend from the existing `anchor` instead of collapsing to a single character.
- On an empty document, all modes use offset `0`.

## Mode Entry And Exit

- `i` enters insert mode before the current character selection.
- `a` enters insert mode after the current character selection.
- `i` starts with the insert caret at the start edge of the selected character.
- `a` starts with the insert caret at the end edge of the selected character.
- `Escape` from insert mode restores the original selected character if the insert session did not move the caret.
- If the insert caret was moved during insert mode, `Escape` falls back to the character immediately before the insertion point when possible.
- `v` toggles visual mode from normal mode.
- `Escape` from visual mode returns to normal mode and collapses to the active character.

## Character Motions

- `h` / `ArrowLeft`
  - Insert: move the insertion point left by one offset.
  - Normal: move to the previous character and collapse to that one-character selection.
  - Visual: move to the previous character and extend the selection from the existing anchor.
- `l` / `ArrowRight`
  - Insert: move the insertion point right by one offset.
  - Normal: move to the next character and collapse to that one-character selection.
  - Visual: move to the next character and extend the selection from the existing anchor.
- `j` / `ArrowDown`
  - Insert: move the insertion point to the next line using the preferred column, clamped to line length.
  - Normal: move the active character to the next line using preferred column, clamped to the visible character range of that line.
  - Visual: same as normal, but extend from the existing anchor.
- `k` / `ArrowUp`
  - Same rules as `j`, but toward the previous line.

## Goto Motions

- `g` enters a goto prefix in normal or visual mode.
- In normal mode, goto motions move the cursor and collapse back to a one-character selection.
- In visual mode, goto motions move the active edge and keep the existing anchor.
- Implemented goto bindings:
  - `gg`: go to the start of the file
  - `ge`: go to the start of the last non-empty line
  - `gh`: go to the start of the current line
  - `gl`: go to the end of the current line, excluding the newline
  - `gs`: go to the first non-whitespace character of the current line

## Word Motions

- Character classes are:
  - word: `[A-Za-z0-9_]`
  - whitespace: `\\s`
  - punctuation: any non-word, non-whitespace character
- `e`
  - Operates on runs of the character classes above, not just identifier words.
  - If the current normal-mode selection is a single character inside a run, it expands to the end of that run.
  - If the current normal-mode selection is already at the end of a non-whitespace run, the next `e` steps to the end of the following non-whitespace run.
  - If the step starts on whitespace, that whitespace stays included and the motion continues through the next non-whitespace run.
  - Normal: the new selection is the stepped span itself, not the previously active character plus the target.
  - Visual: keep the existing anchor and extend or shrink the active edge to the target end.
- `b`
  - Also operates on class runs.
  - If the current normal-mode selection is a single character inside a run, it expands back to the start of that run.
  - If the current normal-mode selection is already at the start of a run, the next `b` steps to the preceding run.
  - Whitespace runs are distinct backward steps, so repeated `b` can land on a separating space before continuing to the previous punctuation or word run.
  - Normal: the new selection is the stepped span itself.
  - Visual: keep the existing anchor and move only the active edge to the target start.

Example `e` progression from `m` in `import { greet } from "./hello";`:

- `mport`
- ` {`
- ` greet`
- ` }`
- ` from`
- ` "./`
- `hello`
- `";`

## Editing

- Printable characters insert at the insertion point in `insert` mode.
- `Backspace`, `Delete`, and `Enter` operate on the insertion point in `insert` mode.
- `normal` and `visual` mode do not type directly.
