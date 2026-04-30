import { createThemeVariables, type ThemeSpec } from "@mewhhaha/wx-theme";

const EDITOR_STYLE_TEXT = `
  .wx-editor {
    --wx-editor-frame: color-mix(in srgb, var(--wx-color-gutter) 34%, transparent);
    --wx-editor-frame-strong: color-mix(in srgb, var(--wx-color-gutter) 54%, transparent);
    --wx-editor-chrome: color-mix(in srgb, var(--wx-color-background) 88%, black);
    --wx-editor-chrome-raised: color-mix(in srgb, var(--wx-color-background) 82%, #111827);
    --wx-editor-muted: color-mix(in srgb, var(--wx-color-text) 58%, var(--wx-color-background));
    --wx-editor-gridline: color-mix(in srgb, var(--wx-color-gutter) 13%, transparent);
    --wx-editor-radius: 8px;
    --wx-editor-panel-radius: calc(var(--wx-editor-radius) - 2px);
    --wx-editor-pane-radius: calc(var(--wx-editor-radius) - 4px);
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    min-height: 240px;
    overflow: hidden;
    box-sizing: border-box;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--wx-color-background) 96%, #111827), var(--wx-color-background));
    color: var(--wx-color-text);
    border: 1px solid var(--wx-editor-frame);
    border-radius: var(--wx-editor-radius);
    font: 15px/1.6 "Monaspace Argon NF", "Monaspace Argon", "Iosevka Web", "SFMono-Regular", "Monaco", monospace;
    font-variant-ligatures: contextual discretionary-ligatures;
    font-variant-numeric: tabular-nums;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-feature-settings:
      "calt" 1,
      "liga" 1,
      "ss01" 1,
      "ss02" 1,
      "ss03" 1,
      "ss04" 1,
      "ss05" 1,
      "ss06" 1,
      "ss07" 1,
      "ss08" 1,
      "ss09" 1,
      "ss10" 1;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--wx-color-text) 8%, transparent),
      inset 0 0 0 1px rgba(0, 0, 0, 0.22),
      0 18px 52px rgba(0, 0, 0, 0.34);
  }

  .wx-editor::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background:
      repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent calc(var(--wx-line-height, 24px) - 1px),
        var(--wx-editor-gridline) calc(var(--wx-line-height, 24px) - 1px),
        var(--wx-editor-gridline) var(--wx-line-height, 24px)
      );
    opacity: 0.42;
  }

  .wx-editor__surface {
    position: relative;
    z-index: 1;
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    padding: 14px 0;
    outline: none;
  }

  .wx-editor__surface::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--wx-color-background) 76%, black) 0,
        color-mix(in srgb, var(--wx-color-background) 88%, black) 7ch,
        transparent 13ch
      );
    opacity: 0.68;
  }

  .wx-editor__input {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    resize: none;
    width: 1px;
    height: 1px;
  }

  .wx-editor__rows {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    z-index: 1;
  }

  .wx-editor__viewport {
    display: grid;
    grid-template-columns: 1ch max-content 2.5ch minmax(0, 1fr);
    align-content: start;
    column-gap: 0;
    height: 100%;
    overflow: hidden;
  }

  .wx-editor__spacer {
    height: 0;
    pointer-events: none;
  }

  .wx-editor__row {
    position: relative;
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: center;
    min-height: var(--wx-line-height, 24px);
    white-space: pre;
  }

  .wx-editor__line-group {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
  }

  .wx-row-active {
    background: color-mix(in srgb, var(--wx-color-current-line) 82%, transparent);
    box-shadow: inset 0.35ch 0 var(--wx-color-cursor);
  }

  .wx-row-jump-highlighted {
    background: color-mix(in srgb, var(--wx-color-current-line) 76%, transparent);
    box-shadow: inset 0.35ch 0 var(--wx-color-type);
  }

  .wx-row-active.wx-row-jump-highlighted {
    background: color-mix(in srgb, var(--wx-color-current-line) 92%, transparent);
    box-shadow: inset 0.35ch 0 var(--wx-color-cursor);
  }

  .wx-editor__gutter {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / 4;
    align-items: stretch;
    justify-items: stretch;
    color: var(--wx-color-gutter);
    background: color-mix(in srgb, var(--wx-color-background) 88%, black);
    box-shadow: inset -1px 0 var(--wx-editor-frame);
    user-select: none;
  }

  .wx-editor__gutter-number {
    display: inline-block;
    min-width: 0;
    width: 100%;
    text-align: right;
    justify-self: stretch;
    grid-column: 2;
    padding-right: 0.35ch;
    font-variant-numeric: tabular-nums;
  }

  .wx-editor__gutter-number[data-active="true"] {
    color: var(--wx-color-text);
    font-weight: 700;
    text-shadow: 0 0 10px color-mix(in srgb, var(--wx-color-cursor) 42%, transparent);
  }

  .wx-editor__gutter-number[data-jump="true"] {
    color: var(--wx-color-text);
    font-weight: 600;
    text-shadow: 0 0 10px color-mix(in srgb, var(--wx-color-type) 34%, transparent);
  }

  .wx-editor__gutter-change {
    position: relative;
    width: 0.38ch;
    min-height: var(--wx-line-height, 24px);
    height: 100%;
    justify-self: center;
    align-self: stretch;
    visibility: hidden;
    grid-column: 3;
  }

  .wx-editor__gutter-change[data-change="added"] {
    visibility: visible;
    background: #22c55e;
  }

  .wx-editor__gutter-change[data-change="modified"] {
    visibility: visible;
    background: #f59e0b;
  }

  .wx-editor__gutter-change[data-deleted="true"]::after {
    content: "";
    position: absolute;
    left: -0.1ch;
    right: -0.1ch;
    bottom: 0;
    height: 2px;
    background: #ef4444;
  }

  .wx-editor__gutter-marker {
    width: 0.55ch;
    height: 0.55ch;
    border-radius: 2px;
    flex: 0 0 auto;
    justify-self: center;
    align-self: center;
    visibility: hidden;
    grid-column: 1;
  }

  .wx-editor__gutter-marker[data-severity="error"] {
    visibility: visible;
    background: var(--wx-color-diagnostic-error);
  }

  .wx-editor__gutter-marker[data-severity="warning"] {
    visibility: visible;
    background: var(--wx-color-diagnostic-warning);
  }

  .wx-editor__gutter-marker[data-severity="info"] {
    visibility: visible;
    background: var(--wx-color-diagnostic-info);
  }

  .wx-editor__gutter-marker[data-severity="hint"] {
    visibility: visible;
    background: var(--wx-color-diagnostic-hint);
  }

  .wx-editor__content {
    position: relative;
    display: flex;
    align-items: baseline;
    justify-content: flex-start;
    color: var(--wx-color-text);
    min-height: var(--wx-line-height, 24px);
    min-width: 0;
    overflow: hidden;
    grid-column: 4;
    padding-left: 0.4ch;
  }

  .wx-editor__line-text {
    display: inline-flex;
    flex: 0 0 auto;
    padding-right: 1ch;
    line-height: inherit;
    align-self: baseline;
    white-space: pre;
  }

  .wx-role-comment { color: var(--wx-color-comment); }
  .wx-role-function { color: var(--wx-color-function); }
  .wx-role-keyword { color: var(--wx-color-keyword); }
  .wx-role-number { color: var(--wx-color-number); }
  .wx-role-operator { color: var(--wx-color-operator); }
  .wx-role-punctuation { color: var(--wx-color-punctuation); }
  .wx-role-string { color: var(--wx-color-string); }
  .wx-role-type { color: var(--wx-color-type); }

  .wx-indent-guide {
    color: color-mix(in srgb, var(--wx-color-gutter) 74%, transparent);
  }

  .wx-diagnostic-error {
    text-decoration: underline wavy var(--wx-color-diagnostic-error);
    text-underline-offset: 0.18em;
  }

  .wx-diagnostic-warning {
    text-decoration: underline wavy var(--wx-color-diagnostic-warning);
    text-underline-offset: 0.18em;
  }

  .wx-diagnostic-info {
    text-decoration: underline dotted var(--wx-color-diagnostic-info);
    text-underline-offset: 0.18em;
  }

  .wx-diagnostic-hint {
    text-decoration: underline dotted var(--wx-color-diagnostic-hint);
    text-underline-offset: 0.18em;
  }

  .wx-editor__eol-diagnostic {
    display: inline-block;
    flex: 1 1 0;
    min-width: 0;
    padding-left: 1ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    line-height: inherit;
    align-self: baseline;
  }

  .wx-editor__inline-diagnostic {
    display: inline-flex;
    align-items: flex-start;
    gap: 0.75ch;
    margin-top: 2px;
    white-space: pre-wrap;
    line-height: 1.35;
    opacity: 0.95;
    font-weight: 600;
    position: relative;
  }

  .wx-editor__inline-diagnostic-hook {
    position: relative;
    flex: 0 0 auto;
    width: 1.2ch;
    height: calc(var(--wx-line-height, 24px) * 0.72);
    margin-top: 0.1em;
  }

  .wx-editor__inline-diagnostic-hook::before {
    content: "";
    position: absolute;
    left: 0.4ch;
    top: 0;
    width: 0.8ch;
    height: 0.72em;
    border-left: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    border-bottom-left-radius: 2px;
    opacity: 0.9;
  }

  .wx-editor__inline-diagnostic-text {
    min-width: 0;
  }

  .wx-editor__diagnostic-row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: start;
    min-height: calc(var(--wx-line-height, 24px) * 0.95);
  }

  .wx-editor__diagnostic-gutter {
    grid-column: 1 / 4;
    color: transparent;
    user-select: none;
  }

  .wx-editor__diagnostic-content {
    position: relative;
    min-height: calc(var(--wx-line-height, 24px) * 0.95);
    white-space: pre-wrap;
    grid-column: 4;
  }

  .wx-editor__inline-diagnostic[data-severity="error"],
  .wx-editor__eol-diagnostic[data-severity="error"] {
    color: var(--wx-color-diagnostic-error);
  }

  .wx-editor__inline-diagnostic[data-severity="warning"],
  .wx-editor__eol-diagnostic[data-severity="warning"] {
    color: var(--wx-color-diagnostic-warning);
  }

  .wx-editor__inline-diagnostic[data-severity="info"],
  .wx-editor__eol-diagnostic[data-severity="info"] {
    color: var(--wx-color-diagnostic-info);
  }

  .wx-editor__inline-diagnostic[data-severity="hint"],
  .wx-editor__eol-diagnostic[data-severity="hint"] {
    color: var(--wx-color-diagnostic-hint);
  }

  .wx-is-selected {
    background: color-mix(in srgb, var(--wx-color-selection) 86%, transparent);
  }

  .wx-search-match {
    background: color-mix(in srgb, #facc15 24%, transparent);
  }

  .wx-search-current {
    background: color-mix(in srgb, #f59e0b 42%, transparent);
  }

  .wx-flash-target {
    background: var(--wx-color-cursor);
    color: transparent;
    text-decoration-color: transparent;
  }

  .wx-editor__flash-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 3;
  }

  .wx-editor__flash-hint {
    position: absolute;
    top: 0;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    height: var(--wx-line-height, 24px);
    min-width: 1ch;
    padding: 0;
    background: var(--wx-color-cursor);
    color: var(--wx-color-cursor-text);
    font-weight: 700;
    line-height: var(--wx-line-height, 24px);
    box-shadow: 0 0 14px color-mix(in srgb, var(--wx-color-cursor) 52%, transparent);
    white-space: pre;
  }

  .wx-cursor-block {
    display: inline-block;
    min-width: 1ch;
    color: var(--wx-color-cursor-text);
    background: var(--wx-color-cursor);
  }

  .wx-cursor-line {
    position: absolute;
    top: 0;
    width: 2px;
    background: var(--wx-color-cursor);
    border-radius: 0;
    box-shadow: 0 0 12px color-mix(in srgb, var(--wx-color-cursor) 62%, transparent);
    pointer-events: none;
  }

  .wx-editor__status {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 1ch;
    box-sizing: border-box;
    flex: 0 0 var(--wx-line-height, 24px);
    height: var(--wx-line-height, 24px);
    padding: 0 1ch 0 0;
    background:
      linear-gradient(180deg, var(--wx-editor-chrome-raised), var(--wx-editor-chrome));
    border-top: 1px solid var(--wx-editor-frame-strong);
    color: var(--wx-editor-muted);
    font-size: 15px;
    line-height: var(--wx-line-height, 24px);
  }

  .wx-editor__status-mode {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 4ch;
    height: 100%;
    padding: 0 1ch;
    background: var(--wx-color-cursor);
    color: var(--wx-color-cursor-text);
    font-weight: 700;
    letter-spacing: 0;
    box-shadow: inset -1px 0 rgba(0, 0, 0, 0.28);
  }

  .wx-editor__status-mode[data-mode="INS"] {
    background: var(--wx-color-string);
    color: var(--wx-color-background);
  }

  .wx-editor__status-mode[data-mode="VIS"] {
    background: var(--wx-color-keyword);
    color: var(--wx-color-background);
  }

  .wx-editor__status-mode[data-mode="JMP"] {
    background: var(--wx-color-type);
    color: var(--wx-color-background);
  }

  .wx-editor__status-file {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--wx-color-text);
    font-weight: 600;
  }

  .wx-editor__status-meta {
    display: inline-flex;
    align-items: center;
    gap: 1.25ch;
    min-width: 0;
    overflow: hidden;
    color: var(--wx-editor-muted);
    white-space: nowrap;
  }

  .wx-editor__status-meta > * {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wx-editor__bottom-row {
    position: relative;
    z-index: 1;
    box-sizing: border-box;
    flex: 0 0 var(--wx-line-height, 24px);
    height: var(--wx-line-height, 24px);
    background: color-mix(in srgb, var(--wx-editor-chrome) 92%, black);
    border-top: 1px solid var(--wx-editor-frame);
    color: var(--wx-color-text);
    display: flex;
    align-items: center;
    padding: 0 1ch;
    line-height: var(--wx-line-height, 24px);
    white-space: pre;
  }

  .wx-editor__command-popover {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--wx-line-height, 24px) * 2);
    display: flex;
    justify-content: flex-start;
    padding: 0 1ch 8px;
    pointer-events: none;
    z-index: 5;
  }

  .wx-editor__command-popover[data-kind="picker-modal"] {
    inset: 0;
    bottom: calc(var(--wx-line-height, 24px) * 2);
    align-items: stretch;
    justify-content: stretch;
    padding: 16px;
  }

  .wx-editor__command-popover[data-kind="picker-combo"] {
    inset: 0;
    bottom: calc(var(--wx-line-height, 24px) * 2);
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .wx-editor__command-popover[hidden] {
    display: none;
  }

  .wx-editor__command-popover-panel {
    min-width: min(42ch, calc(100% - 2ch));
    max-width: min(64ch, calc(100% - 2ch));
    max-height: calc(var(--wx-line-height, 24px) * 6);
    overflow: hidden;
    border: 1px solid var(--wx-editor-frame-strong);
    border-radius: var(--wx-editor-panel-radius);
    background: color-mix(in srgb, var(--wx-editor-chrome) 96%, black);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--wx-color-text) 8%, transparent),
      0 18px 40px rgba(0, 0, 0, 0.42);
  }

  .wx-editor__command-completion {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    align-items: center;
    gap: 2ch;
    min-height: var(--wx-line-height, 24px);
    padding: 0 1ch;
    color: var(--wx-color-text);
    white-space: nowrap;
  }

  .wx-editor__command-completion[data-selected="true"] {
    background: color-mix(in srgb, var(--wx-color-selection) 82%, transparent);
    color: var(--wx-color-text);
    box-shadow: inset 0.35ch 0 var(--wx-color-cursor);
  }

  .wx-editor__command-completion-label {
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 700;
  }

  .wx-editor__command-completion-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--wx-editor-muted);
    text-align: right;
  }

  .wx-editor__picker-modal {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: min(32rem, calc(100% - 32px));
    width: 100%;
    border: 1px solid var(--wx-editor-frame-strong);
    border-radius: var(--wx-editor-panel-radius);
    background: color-mix(in srgb, var(--wx-editor-chrome) 96%, black);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--wx-color-text) 8%, transparent),
      0 18px 40px rgba(0, 0, 0, 0.42);
    pointer-events: none;
    overflow: hidden;
  }

  .wx-editor__picker-modal-query {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 1ch;
    min-height: var(--wx-line-height, 24px);
    padding: 0 1ch;
    border-bottom: 1px solid var(--wx-editor-frame);
    color: var(--wx-color-text);
  }

  .wx-editor__picker-modal-query-label {
    color: var(--wx-editor-muted);
    text-transform: lowercase;
  }

  .wx-editor__picker-modal-query-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    color: var(--wx-color-text);
  }

  .wx-editor__picker-modal-query-count {
    color: var(--wx-color-diagnostic-warning);
    white-space: nowrap;
  }

  .wx-editor__picker-modal-body {
    display: grid;
    grid-template-columns: minmax(18rem, 1fr) minmax(20rem, 1fr);
    min-height: 0;
  }

  .wx-editor__picker-modal-list {
    min-width: 0;
    overflow: hidden;
    border-right: 1px solid var(--wx-editor-frame);
  }

  .wx-editor__picker-modal-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1ch;
    min-height: var(--wx-line-height, 24px);
    padding: 0 1ch;
    align-items: center;
    color: var(--wx-color-text);
  }

  .wx-editor__picker-modal-item[data-selected="true"] {
    background: color-mix(in srgb, var(--wx-color-selection) 82%, transparent);
    color: var(--wx-color-text);
    box-shadow: inset 0.35ch 0 var(--wx-color-cursor);
  }

  .wx-editor__picker-modal-item-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wx-editor__picker-modal-item-detail {
    color: var(--wx-editor-muted);
    white-space: nowrap;
  }

  .wx-editor__picker-modal-preview {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .wx-editor__picker-modal-preview-title {
    min-height: var(--wx-line-height, 24px);
    padding: 0 1ch;
    border-bottom: 1px solid var(--wx-editor-frame);
    color: var(--wx-editor-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wx-editor__picker-modal-preview-body {
    margin: 0;
    padding: 1ch;
    overflow: hidden;
    white-space: pre-wrap;
    color: var(--wx-color-text);
    font: inherit;
    line-height: 1.45;
  }

  .wx-editor__picker-combo {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: min(108ch, calc(100% - 4ch));
    min-height: calc(var(--wx-line-height, 24px) * 9 + 2px);
    max-height: min(24rem, calc(100% - 32px));
    border: 1px solid var(--wx-editor-frame-strong);
    border-radius: var(--wx-editor-panel-radius);
    background: color-mix(in srgb, var(--wx-editor-chrome) 96%, black);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--wx-color-text) 8%, transparent),
      0 18px 40px rgba(0, 0, 0, 0.42);
    pointer-events: none;
    overflow: hidden;
  }

  .wx-editor__picker-combo-query {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 1ch;
    min-height: var(--wx-line-height, 24px);
    padding: 0 1ch;
    border-bottom: 1px solid var(--wx-editor-frame);
    color: var(--wx-color-text);
  }

  .wx-editor__picker-combo-query-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    color: var(--wx-color-text);
  }

  .wx-editor__picker-combo-query-count {
    color: var(--wx-color-diagnostic-warning);
    white-space: nowrap;
  }

  .wx-editor__picker-combo-list {
    min-width: 0;
    min-height: calc(var(--wx-line-height, 24px) * 8);
    overflow: hidden;
  }

  .wx-editor__picker-combo-item {
    display: grid;
    grid-template-columns: auto minmax(0, max-content) minmax(0, 1fr);
    gap: 1ch;
    align-items: center;
    min-height: var(--wx-line-height, 24px);
    padding: 0 1ch;
    color: var(--wx-color-text);
  }

  .wx-editor__picker-combo-item[data-selected="true"] {
    background: color-mix(in srgb, var(--wx-color-selection) 82%, transparent);
    color: var(--wx-color-text);
    box-shadow: inset 0.35ch 0 var(--wx-color-cursor);
  }

  .wx-editor__picker-combo-item-icon {
    color: var(--wx-color-type);
    font-family: "Symbols Nerd Font Mono", "Symbols Nerd Font", monospace;
  }

  .wx-editor__picker-combo-item-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }

  .wx-editor__picker-combo-item-directory {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--wx-editor-muted);
  }

  .wx-editor__picker-combo-item[data-selected="true"] .wx-editor__picker-combo-item-directory {
    color: color-mix(in srgb, var(--wx-color-text) 78%, var(--wx-color-background));
  }

  .wx-editor__bottom-row[data-active="false"] {
    color: transparent;
  }

  .wx-editor__command-prompt {
    color: var(--wx-color-cursor);
  }

  .wx-editor__command-text {
    color: var(--wx-color-text);
  }

  .wx-editor__bottom-message {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wx-editor__bottom-message[data-tone="error"] {
    color: var(--wx-color-diagnostic-error);
  }

  .wx-editor__bottom-message[data-tone="warning"] {
    color: var(--wx-color-diagnostic-warning);
  }

  .wx-editor__bottom-message[data-tone="info"] {
    color: var(--wx-color-text);
  }

  .wx-editor__prefix-hint {
    color: var(--wx-color-cursor);
    font-weight: 700;
    letter-spacing: 0;
  }

  .wx-editor__code-actions {
    display: flex;
    align-items: center;
    gap: 1ch;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .wx-editor__code-action {
    display: inline-flex;
    align-items: center;
    gap: 0.5ch;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wx-editor__code-action[data-selected="true"] {
    color: var(--wx-color-text);
    font-weight: 700;
  }

  .wx-editor__tooltip {
    position: absolute;
    z-index: 6;
    max-width: min(56ch, calc(100% - 32px));
    padding: 8px 10px;
    border-radius: var(--wx-editor-panel-radius);
    background: color-mix(in srgb, var(--wx-editor-chrome) 98%, black);
    border: 1px solid var(--wx-editor-frame-strong);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--wx-color-text) 8%, transparent),
      0 18px 40px rgba(0, 0, 0, 0.42);
    color: var(--wx-color-text);
    line-height: 1.35;
    pointer-events: none;
    white-space: pre-wrap;
  }

  .wx-editor__tooltip[data-tone="error"] {
    border-color: color-mix(in srgb, var(--wx-color-diagnostic-error) 60%, rgba(148, 163, 184, 0.22));
  }

  .wx-editor__tooltip[data-tone="warning"] {
    border-color: color-mix(in srgb, var(--wx-color-diagnostic-warning) 60%, rgba(148, 163, 184, 0.22));
  }

  .wx-editor__tooltip[data-tone="info"] {
    border-color: color-mix(in srgb, var(--wx-color-diagnostic-info) 45%, rgba(148, 163, 184, 0.22));
  }

  .wx-editor__tooltip-source {
    display: block;
    margin-bottom: 4px;
    font-size: 0.85em;
    opacity: 0.75;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .wx-editor__filler-row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: center;
    min-height: var(--wx-line-height, 24px);
    color: color-mix(in srgb, var(--wx-color-gutter) 80%, transparent);
    user-select: none;
  }

  .wx-editor__filler-gutter {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / 4;
    align-items: center;
  }

  .wx-editor__workspace-pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--wx-color-background);
    border: 1px solid var(--wx-editor-frame);
    border-radius: var(--wx-editor-pane-radius);
  }

  .wx-editor__workspace-pane[data-active="true"] {
    border-color: var(--wx-color-cursor);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--wx-color-cursor) 34%, transparent);
  }

  .wx-editor__workspace-pane-body {
    flex: 1;
    overflow: hidden;
  }

  .wx-editor__workspace-pane-status,
  .wx-editor__workspace-pane-bottom {
    display: flex;
    align-items: center;
    min-height: var(--wx-line-height, 24px);
    overflow: hidden;
    white-space: pre;
  }

  .wx-editor__workspace-pane-status {
    background: var(--wx-color-current-line);
  }

  .wx-editor__workspace-pane-bottom {
    background: color-mix(in srgb, var(--wx-color-background) 92%, black);
  }

  .wx-editor__pane-divider {
    position: absolute;
    background: var(--wx-editor-frame-strong);
    pointer-events: none;
  }

  .wx-editor__pane-divider--vertical {
    width: 1px;
  }

  .wx-editor__pane-divider--horizontal {
    height: 1px;
  }

  @media (max-width: 720px) {
    .wx-editor {
      border-radius: 0;
    }

    .wx-editor__surface {
      padding: 10px 0;
    }

    .wx-editor__status {
      gap: 0.75ch;
    }

    .wx-editor__status-meta {
      gap: 0.75ch;
    }

    .wx-editor__picker-modal-body {
      grid-template-columns: minmax(0, 1fr);
    }

    .wx-editor__picker-modal-preview {
      display: none;
    }
  }
`;

export function mountStyles(styleHost: HTMLElement): void {
  if (styleHost.querySelector("style[data-wx-style='true']")) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.dataset.wxStyle = "true";
  styleElement.textContent = EDITOR_STYLE_TEXT;
  styleHost.append(styleElement);
}

export function applyThemeVariables(root: HTMLElement, theme: ThemeSpec): void {
  const variables = createThemeVariables(theme);

  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
}
