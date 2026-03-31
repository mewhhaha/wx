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
- `o` opens a new blank line below the current line and enters insert mode there.
- `O` opens a new blank line above the current line and enters insert mode there.
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
  - `gt`: go to the top visible line in the current viewport
  - `gc`: go to the center visible line in the current viewport
  - `gb`: go to the bottom visible line in the current viewport

## Additional Word Motions

- `w`
  - Moves to the start of the next lowercase word run.
  - Lowercase word runs use the same `word / whitespace / punctuation` classes as `e` and `b`.
- `W`
  - Moves to the start of the next non-whitespace run.
- `B`
  - Moves to the start of the current non-whitespace run if inside it.
  - If already at its start, moves to the start of the previous non-whitespace run.
- `E`
  - Moves to the end of the current non-whitespace run if inside it.
  - If already at its end, moves to the end of the next non-whitespace run.
- In normal mode, these motions collapse to the destination character.
- In visual mode, they preserve the existing anchor and move the active edge.

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
- `x`
  - Selects the current line.
  - If the current selection already covers whole lines, extends the selection down by one more line.
- `y`
  - Yanks the current selection into the default internal register.
  - In `visual` mode, exits back to `normal` mode after yanking.
- `u`
  - Undoes the latest document change.
- `U`
  - Redoes the latest undone document change.
- `p`
  - Pastes the yanked contents after the current selection.
  - Characterwise yanks paste at `selection.to`.
  - If the yanked contents end with a newline, paste is treated as linewise and inserts after the current line.
  - The newly pasted text becomes the active selection in `normal` mode.

## Character Find Motions

- `f<char>`
  - Moves to the next matching character in the document.
- `F<char>`
  - Moves to the previous matching character in the document.
- `t<char>`
  - Moves to the character immediately before the next matching character.
- `T<char>`
  - Moves to the character immediately after the previous matching character.
- `Alt-.`
  - Repeats the last repeatable motion implemented in this editor.
  - Current repeatable motions are `f`, `F`, `t`, `T`, `mm`, `ma`, `mi`, `[p`, and `]p`.

## Page And Screen Motions

- `Home` and `End`
  - Alias line start and line end.
- `PageUp` / `Ctrl-b`
  - Move up by `max(1, visibleLineCount - 1)` lines.
- `PageDown` / `Ctrl-f`
  - Move down by `max(1, visibleLineCount - 1)` lines.
- `Ctrl-u`
  - Move up by `max(1, floor(visibleLineCount / 2))` lines.
- `Ctrl-d`
  - Move down by `max(1, floor(visibleLineCount / 2))` lines.
- These motions preserve preferred column in the same way as `j` / `k`.

## Match And Paragraph Motions

- `mm`
  - If the active character is one of `()[]{}` or `<>`, jump to its matching pair using nesting-aware text matching.
  - If the active character is not on a supported bracket, it is a no-op.
- `]p`
  - Move to the start of the next paragraph.
- `[p`
  - Move to the start of the current paragraph, or the previous one if already at its start.
- Paragraphs are non-empty line blocks separated by one or more blank lines.
