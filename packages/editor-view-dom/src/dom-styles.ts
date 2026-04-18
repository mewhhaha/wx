import { createThemeVariables, type ThemeSpec } from "@wx/editor-theme";

const EDITOR_STYLE_TEXT = `
  .wx-editor {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 240px;
    overflow: hidden;
    box-sizing: border-box;
    background: var(--wx-color-background);
    color: var(--wx-color-text);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 18px;
    font: 15px/1.6 "Monaspace Argon NF", "Monaspace Argon", "Iosevka Web", "SFMono-Regular", "Monaco", monospace;
    font-variant-ligatures: contextual discretionary-ligatures;
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
    box-shadow: 0 24px 80px rgba(2, 8, 23, 0.28);
  }

  .wx-editor__surface {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    padding: 16px 0;
    outline: none;
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
    z-index: 1;
  }

  .wx-editor__viewport {
    display: grid;
    grid-template-columns: 1ch max-content 2ch minmax(0, 1fr);
    column-gap: 0;
  }

  .wx-editor__spacer {
    height: 0;
    pointer-events: none;
  }

  .wx-editor__row {
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
    background: color-mix(in srgb, var(--wx-color-current-line) 88%, transparent);
  }

  .wx-row-jump-highlighted {
    background: color-mix(in srgb, var(--wx-color-current-line) 82%, transparent);
  }

  .wx-row-active.wx-row-jump-highlighted {
    background: color-mix(in srgb, var(--wx-color-current-line) 94%, transparent);
  }

  .wx-editor__gutter {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / 4;
    align-items: stretch;
    justify-items: stretch;
    color: var(--wx-color-gutter);
    user-select: none;
  }

  .wx-editor__gutter-number {
    display: inline-block;
    min-width: 0;
    width: 100%;
    text-align: right;
    justify-self: stretch;
    grid-column: 2;
  }

  .wx-editor__gutter-number[data-active="true"] {
    color: var(--wx-color-text);
    font-weight: 700;
  }

  .wx-editor__gutter-number[data-jump="true"] {
    color: var(--wx-color-text);
    font-weight: 600;
  }

  .wx-editor__gutter-change {
    position: relative;
    width: 0.45ch;
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
    border-radius: 999px;
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
    color: color-mix(in srgb, var(--wx-color-gutter) 88%, transparent);
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
    border-bottom-left-radius: 6px;
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
    background: var(--wx-color-selection);
  }

  .wx-search-match {
    background: color-mix(in srgb, #facc15 24%, transparent);
  }

  .wx-search-current {
    background: color-mix(in srgb, #f59e0b 42%, transparent);
  }

  .wx-flash-target {
    background: #fb7185;
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
    background: transparent;
    color: #fff7ed;
    font-weight: 700;
    line-height: var(--wx-line-height, 24px);
    box-shadow: none;
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
    border-radius: 999px;
    pointer-events: none;
  }

  .wx-editor__status {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    box-sizing: border-box;
    flex: 0 0 var(--wx-line-height, 24px);
    height: var(--wx-line-height, 24px);
    padding: 0 1ch 0 0;
    background: #0b0d12;
    border-top: 1px solid rgba(148, 163, 184, 0.14);
    color: #dbe2f0;
    font-size: 15px;
    line-height: var(--wx-line-height, 24px);
  }

  .wx-editor__status-mode {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: 100%;
    padding: 0 1ch;
    background: var(--wx-color-cursor);
    color: var(--wx-color-cursor-text);
    font-weight: 700;
    letter-spacing: 0.06em;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #eef2ff;
  }

  .wx-editor__status-meta {
    display: inline-flex;
    align-items: center;
    gap: 18px;
    color: #c5cedd;
    white-space: nowrap;
  }

  .wx-editor__bottom-row {
    box-sizing: border-box;
    flex: 0 0 var(--wx-line-height, 24px);
    height: var(--wx-line-height, 24px);
    background: #0a0b0f;
    border-top: 1px solid rgba(148, 163, 184, 0.08);
    color: #dbe2f0;
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

  .wx-editor__command-popover[hidden] {
    display: none;
  }

  .wx-editor__command-popover-panel {
    min-width: min(42ch, calc(100% - 2ch));
    max-width: min(64ch, calc(100% - 2ch));
    max-height: calc(var(--wx-line-height, 24px) * 6);
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.16);
    background: rgba(10, 11, 15, 0.98);
    box-shadow: 0 18px 40px rgba(2, 8, 23, 0.35);
  }

  .wx-editor__command-completion {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    align-items: center;
    gap: 2ch;
    min-height: var(--wx-line-height, 24px);
    padding: 0 1ch;
    color: #dbe2f0;
    white-space: nowrap;
  }

  .wx-editor__command-completion[data-selected="true"] {
    background: color-mix(in srgb, var(--wx-color-selection) 80%, transparent);
    color: #ffffff;
  }

  .wx-editor__command-completion-label {
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 700;
  }

  .wx-editor__command-completion-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    color: #aeb8cb;
    text-align: right;
  }

  .wx-editor__picker-modal {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: min(32rem, calc(100% - 32px));
    width: 100%;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(7, 8, 11, 0.985);
    box-shadow: 0 18px 40px rgba(2, 8, 23, 0.35);
    pointer-events: none;
  }

  .wx-editor__picker-modal-query {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 1ch;
    min-height: var(--wx-line-height, 24px);
    padding: 0 1ch;
    border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    color: #eef2ff;
  }

  .wx-editor__picker-modal-query-label {
    color: #aeb8cb;
    text-transform: lowercase;
  }

  .wx-editor__picker-modal-query-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    color: #ffffff;
  }

  .wx-editor__picker-modal-query-count {
    color: #aeb8cb;
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
    border-right: 1px solid rgba(148, 163, 184, 0.14);
  }

  .wx-editor__picker-modal-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1ch;
    min-height: var(--wx-line-height, 24px);
    padding: 0 1ch;
    align-items: center;
    color: #dbe2f0;
  }

  .wx-editor__picker-modal-item[data-selected="true"] {
    background: color-mix(in srgb, var(--wx-color-selection) 80%, transparent);
    color: #ffffff;
  }

  .wx-editor__picker-modal-item-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wx-editor__picker-modal-item-detail {
    color: #aeb8cb;
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
    border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    color: #aeb8cb;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wx-editor__picker-modal-preview-body {
    margin: 0;
    padding: 1ch;
    overflow: hidden;
    white-space: pre-wrap;
    color: #dbe2f0;
    font: inherit;
    line-height: 1.45;
  }

  .wx-editor__bottom-row[data-active="false"] {
    color: transparent;
  }

  .wx-editor__command-prompt {
    color: #eef2ff;
  }

  .wx-editor__command-text {
    color: #dbe2f0;
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
    color: #dbe2f0;
  }

  .wx-editor__prefix-hint {
    color: #eef2ff;
    font-weight: 700;
    letter-spacing: 0.04em;
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
    color: #ffffff;
    font-weight: 700;
  }

  .wx-editor__tooltip {
    position: absolute;
    z-index: 6;
    max-width: min(56ch, calc(100% - 32px));
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(10, 11, 15, 0.98);
    border: 1px solid rgba(148, 163, 184, 0.22);
    box-shadow: 0 18px 40px rgba(2, 8, 23, 0.35);
    color: #eef2ff;
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
    letter-spacing: 0.06em;
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
    border: 1px solid color-mix(in srgb, var(--wx-color-gutter) 45%, transparent);
  }

  .wx-editor__workspace-pane[data-active="true"] {
    border-color: var(--wx-color-cursor);
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
    background: color-mix(in srgb, var(--wx-color-gutter) 50%, transparent);
    pointer-events: none;
  }

  .wx-editor__pane-divider--vertical {
    width: 1px;
  }

  .wx-editor__pane-divider--horizontal {
    height: 1px;
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
