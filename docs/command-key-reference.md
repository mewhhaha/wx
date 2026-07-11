# Command and key reference (v1)

Generated from the stable catalog and default map. Do not edit manually.

## Context policies

| Context | Modifiers | Unmatched input | After input | Overlay fallback |
| --- | --- | --- | --- | --- |
| `bracket-next` | ignore | fallthrough | — | — |
| `bracket-prev` | ignore | fallthrough | — | — |
| `completion` | completion-tab-shift | fallthrough | — | — |
| `ctrl-w` | ctrl-w (Escape, ArrowLeft, ArrowRight, ArrowUp, ArrowDown) | fallthrough | — | — |
| `editor` | canonical | fallthrough | — | — |
| `goto` | ignore | fallthrough | — | — |
| `hover` | ignore | fallthrough | — | — |
| `match` | ignore | fallthrough | — | — |
| `picker` | ignore | consume | — | — |
| `question` | ignore | fallthrough | — | — |
| `sticky-view` | selective-ignore (Escape, j, k, ArrowDown, ArrowUp) | fallthrough | — | — |
| `sticky-view-overlay` | selective-ignore (Escape, j, k, ArrowDown, ArrowUp) | delegate | — | sticky-view-prefix (retained on match) |
| `sticky-view-prefix` | ignore | consume | sticky:sticky-view; non-sticky:editor | — |
| `view` | ignore | consume | editor | — |

## Commands

| ID | Description | Default keys | Metadata |
| --- | --- | --- | --- |
| `comment.smart` | Toggle smart comment | editor/normal,visual: Alt+/ | async |
| `comment.toggle` | Toggle line comment | goto/normal,visual: c | async |
| `completion.accept` | Accept completion | completion/normal,visual,insert: Enter | async |
| `completion.dismiss` | Dismiss completion | completion/normal,visual,insert: Escape | — |
| `completion.next` | Next completion | completion/normal,visual,insert: ArrowDown<br>completion/normal,visual,insert: Tab | — |
| `completion.previous` | Previous completion | completion/normal,visual,insert: ArrowUp<br>completion/normal,visual,insert: Shift+Tab | — |
| `diagnostic.next` | Next diagnostic | bracket-next/normal,visual: D<br>bracket-next/normal,visual: d | args:extreme |
| `diagnostic.previous` | Previous diagnostic | bracket-prev/normal,visual: D<br>bracket-prev/normal,visual: d | args:extreme |
| `edit.change` | Change selection | editor/normal,visual: c | count, history |
| `edit.delete` | Delete selection | editor/normal,visual: d | count, history |
| `edit.delete-backward` | Delete backward | editor/insert: Backspace | count, history |
| `edit.delete-forward` | Delete forward | editor/insert: Delete | count, history |
| `edit.indent` | Insert indentation | editor/insert: Tab | count, history |
| `edit.newline` | Insert newline | editor/insert: Enter | count, history |
| `edit.open-above` | Open line above | editor/normal,visual: O | count, history |
| `edit.open-below` | Open line below | editor/normal,visual: o | count, history |
| `edit.paste-after` | Paste after | editor/normal,visual: p | count, async |
| `edit.paste-before` | Paste before | editor/normal,visual: P | count, async |
| `edit.redo` | Redo | editor/normal,visual: U | count |
| `edit.select-all` | Select all | editor/normal,visual: % | count |
| `edit.select-line-below` | Select line below | editor/normal,visual: x | count |
| `edit.undo` | Undo | editor/normal,visual: u | count |
| `edit.yank` | Yank selection | editor/normal,visual: y | count |
| `find.next-char` | Find next character | editor/normal,visual: f | repeat, operand:character/1 |
| `find.previous-char` | Find previous character | editor/normal,visual: F | repeat, operand:character/1 |
| `find.till-next-char` | Find until next character | editor/normal,visual: t | repeat, operand:character/1 |
| `find.till-previous-char` | Find until previous character | editor/normal,visual: T | repeat, operand:character/1 |
| `goto.counted-line` | Go to one-based counted line | editor/normal,visual: G<br>goto/normal,visual: g | count, args:fallback |
| `goto.declaration` | Go to declaration | goto/normal,visual: D | async |
| `goto.definition` | Go to definition | editor/normal,visual: Alt+g<br>goto/normal,visual: d | async |
| `goto.file-start` | Go to file start | — | count |
| `goto.first-non-whitespace` | Go to first non-whitespace | goto/normal,visual: s | count |
| `goto.implementation` | Go to implementation | goto/normal,visual: i | async |
| `goto.last-line` | Go to last line | goto/normal,visual: e | count |
| `goto.line-end` | Go to line end | editor/normal,visual: End<br>goto/normal,visual: l | count |
| `goto.line-start` | Go to line start | editor/normal,visual: Home<br>goto/normal,visual: h | count |
| `goto.matching-bracket` | Matching bracket | match/normal,visual: m | repeat |
| `goto.next-paragraph` | Next paragraph | bracket-next/normal,visual: p | count, repeat, args:direction |
| `goto.previous-paragraph` | Previous paragraph | bracket-prev/normal,visual: p | count, repeat, args:direction |
| `goto.references` | Go to references | editor/normal,visual: Alt+G<br>goto/normal,visual: r<br>question/normal,visual: r | async |
| `goto.type-definition` | Go to type definition | goto/normal,visual: y | async |
| `goto.window-bottom` | Go to window bottom | goto/normal,visual: b | count |
| `goto.window-center` | Go to window center | — | — |
| `goto.window-top` | Go to window top | goto/normal,visual: t | count |
| `history.checkpoint` | Checkpoint history | editor/insert: Ctrl+s | — |
| `hover.dismiss` | Dismiss hover | hover/normal,visual,insert: Escape | — |
| `jump.flash` | Jump to a visible target | editor/normal,visual: Space | — |
| `mode.append` | Append in insert mode | editor/normal: a | count |
| `mode.append-line-end` | Append at line end | editor/normal: A | count |
| `mode.insert` | Enter insert mode | editor/normal: i | count |
| `mode.insert-line-start` | Insert at first non-whitespace | editor/normal: I | count |
| `mode.normal` | Return to normal mode | editor/visual,insert: Escape | count |
| `mode.visual` | Toggle visual mode | editor/normal,visual: v | count |
| `motion.B-start` | Move to previous long word | editor/normal,visual: B | count |
| `motion.E-end` | Move to long word end | editor/normal,visual: E | count |
| `motion.W-start` | Move to next long word start | editor/normal,visual: W | count |
| `motion.down` | Move down | editor/insert: ArrowDown<br>editor/normal,visual: ArrowDown<br>editor/normal,visual: j<br>goto/normal,visual: j | count |
| `motion.half-page-down` | Half page down | editor/normal,visual: Ctrl+d | count |
| `motion.half-page-up` | Half page up | editor/normal,visual: Ctrl+u | count |
| `motion.left` | Move left | editor/insert: ArrowLeft<br>editor/normal,visual: ArrowLeft<br>editor/normal,visual: h | count |
| `motion.page-down` | Page down | editor/normal,visual: Ctrl+f<br>editor/normal,visual: PageDown | count |
| `motion.page-up` | Page up | editor/normal,visual: Ctrl+b<br>editor/normal,visual: PageUp | count |
| `motion.right` | Move right | editor/insert: ArrowRight<br>editor/normal,visual: ArrowRight<br>editor/normal,visual: l | count |
| `motion.up` | Move up | editor/insert: ArrowUp<br>editor/normal,visual: ArrowUp<br>editor/normal,visual: k<br>goto/normal,visual: k | count |
| `motion.word-backward` | Move backward a word | editor/normal,visual: b | count |
| `motion.word-forward` | Move forward a word | editor/normal,visual: e | count |
| `motion.word-start` | Move to next word start | editor/normal,visual: w | count |
| `picker.accept` | Accept picker item | picker/normal,visual,insert: Enter | async |
| `picker.accept-background` | Open picker result in background | picker/normal,visual,insert: B | async |
| `picker.accept-horizontal` | Open picker result in horizontal split | picker/normal,visual,insert: H | async |
| `picker.accept-vertical` | Open picker result in vertical split | picker/normal,visual,insert: V | async |
| `picker.buffers` | show buffers (g n / g p cycle) | question/normal,visual: B<br>question/normal,visual: b | — |
| `picker.delete-backward` | Delete picker query backward | picker/normal,visual,insert: Backspace | async |
| `picker.diagnostics` | show diagnostics | question/normal,visual: d | — |
| `picker.dismiss` | Dismiss picker | picker/normal,visual,insert: Escape | — |
| `picker.jumps` | show jumplist | question/normal,visual: j | — |
| `picker.next` | Next picker item | picker/normal,visual,insert: ArrowDown<br>picker/normal,visual,insert: ArrowRight<br>picker/normal,visual,insert: l | args:variant |
| `picker.panes` | show panes (Ctrl-w window mode) | question/normal,visual: p | — |
| `picker.previous` | Previous picker item | picker/normal,visual,insert: ArrowLeft<br>picker/normal,visual,insert: ArrowUp<br>picker/normal,visual,insert: h | args:variant |
| `picker.symbols-document` | show document symbols | question/normal,visual: s | async |
| `picker.symbols-workspace` | show workspace symbols | question/normal,visual: S | async |
| `prefix.bracket-next` | Next bracket prefix | editor/normal,visual: ] | — |
| `prefix.bracket-prev` | Previous bracket prefix | editor/normal,visual: [ | — |
| `prefix.ctrl-w` | Window prefix | editor/normal,visual: Ctrl+w | — |
| `prefix.goto` | Go-to prefix | editor/normal,visual: g | — |
| `prefix.match` | Match prefix | editor/normal,visual: m | — |
| `prefix.question` | Help prefix | editor/normal,visual: ? | — |
| `prefix.sticky-view` | Sticky view prefix | editor/normal,visual: Z | — |
| `prefix.view` | View prefix | editor/normal,visual: z | — |
| `register.insert` | Insert selected register | editor/insert: Ctrl+r | async, operand:register/1 |
| `register.select` | Select register | editor/normal,visual: " | operand:register/1 |
| `repeat.edit` | Repeat last completed edit | editor/normal,visual: . | count, async, repeat, history |
| `repeat.motion` | Repeat motion | editor/normal,visual: Alt+. | async |
| `search.backward` | Search backward | — | palette, aliases:search-backward |
| `search.forward` | Search forward | editor/normal,visual: / | palette, aliases:search,/ |
| `search.repeat-next` | Repeat next search | editor/normal,visual: n | — |
| `search.repeat-previous` | Repeat previous search | editor/normal,visual: N | — |
| `search.selection` | Search selected text | editor/normal,visual: *<br>editor/normal,visual: Alt+* | — |
| `selection.align` | Align selection columns | editor/normal,visual: & | history, palette |
| `selection.collapse` | Collapse selections | editor/normal,visual: ; | palette |
| `selection.decrement` | Decrement selected numbers | editor/normal,visual: Ctrl+x | history, palette |
| `selection.ensure-forward` | Ensure selections face forward | editor/normal,visual: Alt+: | palette |
| `selection.flip` | Flip selection direction | editor/normal,visual: Alt+; | palette |
| `selection.format` | Format selections | editor/normal,visual: = | async, history, palette |
| `selection.increment` | Increment selected numbers | editor/normal,visual: Ctrl+a | history, palette |
| `selection.indent` | Indent selections | editor/normal,visual: > | history, palette |
| `selection.join-lines` | Join selected lines | editor/normal,visual: J | history, palette |
| `selection.join-lines-space` | Join selected lines with spaces | editor/normal,visual: Alt+J | history, palette |
| `selection.keep-primary` | Keep primary selection | editor/normal,visual: , | palette |
| `selection.lower-case` | Lowercase selections | editor/normal,visual: ` | history, palette |
| `selection.merge-consecutive` | Merge consecutive selections | editor/normal,visual: Alt+_ | palette |
| `selection.merge-overlapping` | Merge overlapping selections | editor/normal,visual: Alt+- | palette |
| `selection.outdent` | Outdent selections | editor/normal,visual: < | history, palette |
| `selection.remove-primary` | Remove primary selection | editor/normal,visual: Alt+, | palette |
| `selection.replace-character` | Replace selection characters | editor/normal,visual: r | history, palette, operand:character/1 |
| `selection.rotate-primary-backward` | Rotate primary selection backward | editor/normal,visual: ( | palette |
| `selection.rotate-primary-forward` | Rotate primary selection forward | editor/normal,visual: ) | palette |
| `selection.split-newline` | Split selections on newlines | editor/normal,visual: Alt+s | palette |
| `selection.split-regex` | Split selections by regular expression | editor/normal,visual: S | async, palette |
| `selection.toggle-case` | Toggle selection case | editor/normal,visual: ~ | history, palette |
| `selection.trim` | Trim selections | editor/normal,visual: _ | history, palette |
| `selection.upper-case` | Uppercase selections | editor/normal,visual: Alt+` | history, palette |
| `signature.dismiss` | Dismiss signature help | editor/normal: Escape | — |
| `signature.next` | Next signature | editor/insert: Alt+PageDown<br>editor/normal,visual: Alt+PageDown | — |
| `signature.previous` | Previous signature | editor/insert: Alt+PageUp<br>editor/normal,visual: Alt+PageUp | — |
| `surround.add` | Add surround | match/normal,visual: s | operand:surround/1 |
| `surround.delete` | Delete surround | match/normal,visual: d | operand:surround/1 |
| `surround.replace` | Replace surround | match/normal,visual: r | operand:surround/2 |
| `syntax.next` | Next syntax target | bracket-next/normal,visual: T<br>bracket-next/normal,visual: a<br>bracket-next/normal,visual: c<br>bracket-next/normal,visual: f<br>bracket-next/normal,visual: g<br>bracket-next/normal,visual: t<br>bracket-next/normal,visual: x | async, args:target |
| `syntax.previous` | Previous syntax target | bracket-prev/normal,visual: T<br>bracket-prev/normal,visual: a<br>bracket-prev/normal,visual: c<br>bracket-prev/normal,visual: f<br>bracket-prev/normal,visual: g<br>bracket-prev/normal,visual: t<br>bracket-prev/normal,visual: x | async, args:target |
| `syntax.select-down` | Shrink syntax selection | editor/normal,visual: Alt+ArrowDown | async |
| `syntax.select-up` | Expand syntax selection | editor/normal,visual: Alt+ArrowUp | async |
| `textobject.select` | Select text object | match/normal,visual: a<br>match/normal,visual: i | async, repeat, operand:textobject/1, args:scope |
| `ui.code-actions` | Code actions | editor/normal,visual: Ctrl+. | async |
| `ui.command-line` | Open command line | editor/normal,visual: : | palette, aliases:command,: |
| `ui.completion` | Request completion | editor/insert: Ctrl+Space<br>editor/normal,visual: Ctrl+Space | async |
| `ui.file-picker` | Open file picker | editor/insert: Ctrl+p<br>editor/normal,visual: Ctrl+p | async, aliases:files |
| `ui.hover` | Show hover | editor/normal,visual: Alt+K<br>editor/normal,visual: Alt+k<br>editor/normal,visual: Ctrl+, | async |
| `ui.rename` | Rename symbol | editor/insert: F2<br>editor/normal,visual: Alt+R<br>editor/normal,visual: Alt+r<br>editor/normal,visual: F2 | async, aliases:rename |
| `ui.signature-help` | Request signature help | editor/insert: Ctrl+k<br>editor/normal,visual: Ctrl+k | async, palette |
| `ui.workspace-search` | Search workspace contents | editor/insert: Ctrl+F<br>editor/normal,visual: Ctrl+F | async, palette, aliases:global-search |
| `view.bottom` | Align selection bottom | sticky-view-prefix/normal,visual: b<br>view/normal,visual: b | args:alignment/sticky |
| `view.center` | Center selection | sticky-view-prefix/normal,visual: c<br>sticky-view-prefix/normal,visual: m<br>sticky-view-prefix/normal,visual: z<br>view/normal,visual: c<br>view/normal,visual: m<br>view/normal,visual: z | args:alignment/sticky |
| `view.exit-sticky` | Exit sticky view mode | sticky-view-overlay/normal,visual: Escape<br>sticky-view/normal,visual: Escape | — |
| `view.half-page-down` | Half-page viewport down | sticky-view/normal,visual,insert: Ctrl+d | — |
| `view.half-page-up` | Half-page viewport up | sticky-view/normal,visual,insert: Ctrl+u | — |
| `view.page-down` | Page viewport down | sticky-view/normal,visual,insert: Ctrl+f | — |
| `view.page-up` | Page viewport up | sticky-view/normal,visual,insert: Ctrl+b | — |
| `view.scroll-down` | Scroll down | sticky-view-overlay/normal,visual: ArrowDown<br>sticky-view-overlay/normal,visual: j<br>sticky-view-prefix/normal,visual: j<br>sticky-view/normal,visual: ArrowDown<br>sticky-view/normal,visual: j<br>view/normal,visual: j | args:sticky |
| `view.scroll-up` | Scroll up | sticky-view-overlay/normal,visual: ArrowUp<br>sticky-view-overlay/normal,visual: k<br>sticky-view-prefix/normal,visual: k<br>sticky-view/normal,visual: ArrowUp<br>sticky-view/normal,visual: k<br>view/normal,visual: k | args:sticky |
| `view.top` | Align selection top | sticky-view-prefix/normal,visual: t<br>view/normal,visual: t | args:alignment/sticky |
| `workspace.close-pane` | Close pane | ctrl-w/normal,visual: Ctrl+Q<br>ctrl-w/normal,visual: Ctrl+q<br>ctrl-w/normal,visual: Q<br>ctrl-w/normal,visual: q | — |
| `workspace.focus-down` | Focus down | ctrl-w/normal,visual: ArrowDown<br>ctrl-w/normal,visual: Ctrl+j<br>ctrl-w/normal,visual: j | — |
| `workspace.focus-left` | Focus left | ctrl-w/normal,visual: ArrowLeft<br>ctrl-w/normal,visual: Ctrl+h<br>ctrl-w/normal,visual: h | — |
| `workspace.focus-next-pane` | Focus next pane | ctrl-w/normal,visual: Ctrl+W<br>ctrl-w/normal,visual: Ctrl+w<br>ctrl-w/normal,visual: W<br>ctrl-w/normal,visual: w | — |
| `workspace.focus-right` | Focus right | ctrl-w/normal,visual: ArrowRight<br>ctrl-w/normal,visual: Ctrl+l<br>ctrl-w/normal,visual: l | — |
| `workspace.focus-up` | Focus up | ctrl-w/normal,visual: ArrowUp<br>ctrl-w/normal,visual: Ctrl+k<br>ctrl-w/normal,visual: k | — |
| `workspace.jump-back` | Jump back | editor/normal,visual: Ctrl+o | async |
| `workspace.jump-forward` | Jump forward | editor/normal,visual: Ctrl+i | async |
| `workspace.new-scratch-horizontal` | New scratch split | ctrl-w/normal,visual: Ctrl+N<br>ctrl-w/normal,visual: Ctrl+n<br>ctrl-w/normal,visual: N<br>ctrl-w/normal,visual: n | — |
| `workspace.next-buffer` | Next buffer | goto/normal,visual: n | — |
| `workspace.only-pane` | Only pane | ctrl-w/normal,visual: Ctrl+O<br>ctrl-w/normal,visual: Ctrl+o<br>ctrl-w/normal,visual: O<br>ctrl-w/normal,visual: o | — |
| `workspace.open-selection-horizontal` | Open selection horizontally | ctrl-w/normal,visual: Ctrl+f<br>ctrl-w/normal,visual: f | async |
| `workspace.open-selection-vertical` | Open selection vertically | ctrl-w/normal,visual: Ctrl+F<br>ctrl-w/normal,visual: F | async |
| `workspace.previous-buffer` | Previous buffer | goto/normal,visual: p | — |
| `workspace.save-jump` | Save jump | editor/normal,visual: Ctrl+s | — |
| `workspace.split-horizontal` | Split horizontally | ctrl-w/normal,visual: Ctrl+S<br>ctrl-w/normal,visual: Ctrl+s<br>ctrl-w/normal,visual: S<br>ctrl-w/normal,visual: s | — |
| `workspace.split-vertical` | Split vertically | ctrl-w/normal,visual: Ctrl+V<br>ctrl-w/normal,visual: Ctrl+v<br>ctrl-w/normal,visual: V<br>ctrl-w/normal,visual: v | — |
| `workspace.swap-down` | Swap down | ctrl-w/normal,visual: Ctrl+J<br>ctrl-w/normal,visual: J | — |
| `workspace.swap-left` | Swap left | ctrl-w/normal,visual: Ctrl+H<br>ctrl-w/normal,visual: H | — |
| `workspace.swap-right` | Swap right | ctrl-w/normal,visual: Ctrl+L<br>ctrl-w/normal,visual: L | — |
| `workspace.swap-up` | Swap up | ctrl-w/normal,visual: Ctrl+K<br>ctrl-w/normal,visual: K | — |
