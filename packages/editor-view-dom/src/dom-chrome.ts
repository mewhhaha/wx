import { getActiveCharacterOffset, getCursorOffset, type EditorState } from "@mewhhaha/wx-core";
import type { EditorPresentationState } from "@mewhhaha/wx-controller";
import { getEditorFilePickerPresentation, type EditorLayoutModel } from "@mewhhaha/wx-layout";

interface CreateDomChromeRuntimeOptions {
  bottomRow: HTMLDivElement;
  commandPopover: HTMLDivElement;
  statusMode: HTMLDivElement;
  statusFile: HTMLDivElement;
  statusMeta: HTMLDivElement;
  tooltip: HTMLDivElement;
  getState(): EditorState;
  getPresentation(): EditorPresentationState;
  getUiState(): EditorPresentationState["ui"];
  getBufferTitle(): string;
  getMetrics(): { charWidth: number; lineHeight: number };
  getRenderedLayout(): EditorLayoutModel;
  getDiagnosticsSummary(): { errors: number; warnings: number };
  getCurrentStatusSignature(): string;
  setRenderedStatusSignature(signature: string): void;
  getCurrentBottomBarSignature(): string;
  setRenderedBottomBarSignature(signature: string): void;
  getCurrentTooltipSignature(): string;
  setRenderedTooltipSignature(signature: string): void;
}

function getStatusModeName(
  mode: EditorState["mode"],
  ui: { flash: { active: boolean }; pendingAction: { kind: string } | null }
): "JMP" | "INS" | "VIS" | "NOR" {
  if (ui.flash.active || ui.pendingAction?.kind === "flash-target") {
    return "JMP";
  }

  if (mode === "insert") {
    return "INS";
  }

  if (mode === "visual") {
    return "VIS";
  }

  return "NOR";
}

export interface DomChromeRuntime {
  patchCommandPopover(): void;
  patchStatus(): void;
  patchBottomRow(): void;
  patchTooltip(): void;
}

function appendPickerFileRow(row: HTMLDivElement, item: EditorPresentationState["ui"]["picker"]["items"][number]): void {
  const icon = document.createElement("span");
  const fileName = document.createElement("span");
  const directory = document.createElement("span");
  const presentation = getEditorFilePickerPresentation(item.filePath ?? item.label);

  icon.className = "wx-editor__picker-combo-item-icon";
  icon.textContent = presentation.icon;

  fileName.className = "wx-editor__picker-combo-item-name";
  fileName.textContent = presentation.fileName;

  directory.className = "wx-editor__picker-combo-item-directory";
  directory.textContent = presentation.directory;

  row.append(icon, fileName, directory);
}

function getVisiblePickerItems<T>(
  items: readonly T[],
  selectedIndex: number,
  visibleCount: number
): Array<{ item: T; index: number }> {
  if (items.length <= visibleCount) {
    return items.map((item, index) => ({ item, index }));
  }

  const clampedSelectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex));
  const before = Math.floor((visibleCount - 1) / 2);
  const maxStart = Math.max(0, items.length - visibleCount);
  const start = Math.max(0, Math.min(maxStart, clampedSelectedIndex - before));

  return items.slice(start, start + visibleCount).map((item, index) => ({ item, index: start + index }));
}

export function createDomChromeRuntime(options: CreateDomChromeRuntimeOptions): DomChromeRuntime {
  return {
    patchCommandPopover() {
      const uiState = options.getUiState();
      const items = uiState.commandCompletionItems;
      const layout = options.getRenderedLayout();
      const completionPanel = layout.panels.find((panel) => panel.kind === "completion" || panel.kind === "signature");

      if (uiState.picker.active && uiState.picker.variant === "combo") {
        options.commandPopover.hidden = false;
        options.commandPopover.dataset.kind = "picker-combo";

        const panel = document.createElement("div");
        const queryRow = document.createElement("div");
        const queryValue = document.createElement("span");
        const queryCount = document.createElement("span");
        const list = document.createElement("div");

        panel.className = "wx-editor__picker-combo";
        panel.dataset.wxEditorPickerCombo = "true";

        queryRow.className = "wx-editor__picker-combo-query";
        queryValue.className = "wx-editor__picker-combo-query-value";
        queryValue.textContent = uiState.picker.query || " ";
        queryCount.className = "wx-editor__picker-combo-query-count";
        queryCount.textContent =
          uiState.picker.items.length > 0 ? `${uiState.picker.selectedIndex + 1}/${uiState.picker.items.length}` : "0/0";
        queryRow.append(queryValue, queryCount);

        list.className = "wx-editor__picker-combo-list";

        if (uiState.picker.loading) {
          const loading = document.createElement("div");
          loading.className = "wx-editor__picker-combo-item";
          loading.textContent = `Loading ${uiState.picker.title}...`;
          list.append(loading);
        } else if (uiState.picker.error && uiState.picker.items.length === 0) {
          const error = document.createElement("div");
          error.className = "wx-editor__picker-combo-item";
          error.dataset.selected = "false";
          error.textContent = uiState.picker.error;
          list.append(error);
        } else {
          getVisiblePickerItems(uiState.picker.items, uiState.picker.selectedIndex, 8).forEach(({ item, index }) => {
            const row = document.createElement("div");
            row.className = "wx-editor__picker-combo-item";
            row.dataset.selected = String(index === uiState.picker.selectedIndex);
            row.dataset.wxEditorPickerItem = item.filePath ?? item.label;

            if (item.kind === "file" && item.filePath) {
              appendPickerFileRow(row, item);
            } else {
              const label = document.createElement("span");
              const detail = document.createElement("span");

              label.className = "wx-editor__picker-combo-item-name";
              label.textContent = item.label;
              detail.className = "wx-editor__picker-combo-item-directory";
              detail.textContent = item.detail ?? "";
              row.append(label, detail);
            }

            list.append(row);
          });
        }

        panel.append(queryRow, list);
        options.commandPopover.replaceChildren(panel);
        return;
      }

      if (uiState.picker.active && uiState.picker.variant === "modal") {
        options.commandPopover.hidden = false;
        options.commandPopover.dataset.kind = "picker-modal";

        const panel = document.createElement("div");
        const queryRow = document.createElement("div");
        const queryLabel = document.createElement("span");
        const queryValue = document.createElement("span");
        const queryCount = document.createElement("span");
        const body = document.createElement("div");
        const list = document.createElement("div");
        const preview = document.createElement("div");
        const previewTitle = document.createElement("div");
        const previewBody = document.createElement("pre");

        panel.className = "wx-editor__picker-modal";
        panel.dataset.wxEditorPickerModal = "true";

        queryRow.className = "wx-editor__picker-modal-query";
        queryLabel.className = "wx-editor__picker-modal-query-label";
        queryLabel.textContent = uiState.picker.title;
        queryValue.className = "wx-editor__picker-modal-query-value";
        queryValue.textContent = uiState.picker.query || " ";
        queryCount.className = "wx-editor__picker-modal-query-count";
        queryCount.textContent =
          uiState.picker.items.length > 0 ? `${uiState.picker.selectedIndex + 1}/${uiState.picker.items.length}` : "0/0";
        queryRow.append(queryLabel, queryValue, queryCount);

        body.className = "wx-editor__picker-modal-body";
        list.className = "wx-editor__picker-modal-list";
        preview.className = "wx-editor__picker-modal-preview";
        previewTitle.className = "wx-editor__picker-modal-preview-title";
        previewTitle.textContent = uiState.picker.previewTitle || "preview";
        previewBody.className = "wx-editor__picker-modal-preview-body";
        previewBody.textContent = uiState.picker.previewLoading
          ? "Loading preview..."
          : uiState.picker.previewContent || "No preview";

        if (uiState.picker.loading) {
          const loading = document.createElement("div");
          loading.className = "wx-editor__picker-modal-item";
          loading.textContent = `Loading ${uiState.picker.title}...`;
          list.append(loading);
        } else if (uiState.picker.error && uiState.picker.items.length === 0) {
          const error = document.createElement("div");
          error.className = "wx-editor__picker-modal-item";
          error.dataset.selected = "false";
          error.textContent = uiState.picker.error;
          list.append(error);
        } else {
          getVisiblePickerItems(uiState.picker.items, uiState.picker.selectedIndex, 12).forEach(({ item, index }) => {
            const row = document.createElement("div");
            const label = document.createElement("span");
            const detail = document.createElement("span");

            row.className = "wx-editor__picker-modal-item";
            row.dataset.selected = String(index === uiState.picker.selectedIndex);
            row.dataset.wxEditorPickerItem = item.label;

            label.className = "wx-editor__picker-modal-item-label";
            label.textContent = item.label;
            detail.className = "wx-editor__picker-modal-item-detail";
            detail.textContent = item.detail ?? "";

            row.append(label, detail);
            list.append(row);
          });
        }

        preview.append(previewTitle, previewBody);
        body.append(list, preview);
        panel.append(queryRow, body);
        options.commandPopover.replaceChildren(panel);
        return;
      }

      if (completionPanel) {
        options.commandPopover.hidden = false;
        options.commandPopover.dataset.kind = completionPanel.kind;
        const panel = document.createElement("div");
        panel.className = "wx-editor__command-popover-panel";

        completionPanel.rows.forEach((rowRuns, index) => {
          const row = document.createElement("div");
          const run = rowRuns[0];
          row.className = "wx-editor__command-completion";
          row.dataset.selected = String(index === uiState.completion.selectedIndex || !!run?.selectedInPicker);
          row.dataset.wxEditorCommandCompletion = run?.text.trimEnd() ?? "";

          const label = document.createElement("span");
          label.className = "wx-editor__command-completion-label";
          label.textContent = run?.text.trimEnd() ?? "";
          row.append(label);
          panel.append(row);
        });

        options.commandPopover.replaceChildren(panel);
        return;
      }

      const keyHelpPanel = layout.panels.find((panel) => panel.kind === "key-help");
      const showPendingKeyHelp = keyHelpPanel !== undefined;

      if ((items.length === 0 || !uiState.commandLine.active || uiState.commandLine.prompt !== ":") && !showPendingKeyHelp) {
        options.commandPopover.hidden = true;
        delete options.commandPopover.dataset.kind;
        options.commandPopover.replaceChildren();
        return;
      }

      options.commandPopover.hidden = false;
      options.commandPopover.dataset.kind = "command";
      const selectedIndex = Math.max(0, Math.min(items.length - 1, uiState.commandCompletionIndex));
      const panel = document.createElement("div");
      panel.className = "wx-editor__command-popover-panel";

      const visibleItems = showPendingKeyHelp ? keyHelpPanel?.keyHelpItems ?? [] : items.slice(0, 6);
      visibleItems.forEach((item, index) => {
        const row = document.createElement("div");
        const label = document.createElement("span");
        const detail = document.createElement("span");

        row.className = "wx-editor__command-completion";
        row.dataset.selected = String(index === selectedIndex);
        row.dataset.wxEditorCommandCompletion = item.label;

        label.className = "wx-editor__command-completion-label";
        label.textContent = item.label;

        detail.className = "wx-editor__command-completion-detail";
        detail.textContent = item.detail ?? "";

        row.append(label, detail);
        panel.append(row);
      });

      options.commandPopover.replaceChildren(panel);
    },
    patchStatus() {
      const state = options.getState();
      const uiState = options.getUiState();
      const cursorOffset = state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state);
      const cursorPosition = state.doc.positionAt(cursorOffset);
      const { errors, warnings } = options.getDiagnosticsSummary();
      const statusModeName = getStatusModeName(state.mode, {
        flash: uiState.flash,
        pendingAction: uiState.pendingAction
      });

      options.statusMode.textContent = ` ${statusModeName} `;
      options.statusMode.dataset.mode = statusModeName;
      options.statusFile.replaceChildren();
      options.statusFile.append(document.createTextNode(` ${options.getBufferTitle()}`));
      if (options.getPresentation().fileStatus.externalChanged || options.getPresentation().fileStatus.dirty) {
        const indicator = document.createElement("span");
        indicator.className = options.getPresentation().fileStatus.externalChanged
          ? "wx-editor__status-external-change"
          : "wx-editor__status-dirty";
        indicator.dataset.wxEditorStatusFileIndicator = options.getPresentation().fileStatus.externalChanged
          ? "external-change"
          : "dirty";
        indicator.textContent = " ●";
        options.statusFile.append(indicator);
      }
      options.statusMeta.textContent = [
        "1 sel",
        errors > 0 ? `E${errors}` : "",
        warnings > 0 ? `W${warnings}` : "",
        `${cursorPosition.line + 1}:${cursorPosition.column + 1}`
      ]
        .filter(Boolean)
        .join("   ");
      options.setRenderedStatusSignature(options.getCurrentStatusSignature());
    },
    patchBottomRow() {
      const layout = options.getRenderedLayout();
      const uiState = options.getUiState();
      options.bottomRow.dataset.active = String(layout.bottomBar.active);
      options.bottomRow.replaceChildren();
      this.patchCommandPopover();
      const promptRun = layout.bottomBar.runs.find((run) => run.part === "command-prompt");
      const commandTextRun = layout.bottomBar.runs.find((run) => run.part === "command-text");
      const pickerRuns = layout.bottomBar.runs.filter((run) => run.part === "code-action");
      const pickerMessage = layout.bottomBar.runs.find((run) => run.part === "picker-loading" || run.part === "picker-error");
      const messageRun = layout.bottomBar.runs.find((run) => run.part === "bottom-message");
      const prefixRun = layout.bottomBar.runs.find((run) => run.part === "prefix-hint");

      if (promptRun) {
        const prompt = document.createElement("span");
        const value = document.createElement("span");

        prompt.className = "wx-editor__command-prompt";
        prompt.dataset.wxEditorCommandPrompt = "true";
        prompt.textContent = promptRun.text;

        value.className = "wx-editor__command-text";
        value.dataset.wxEditorCommandText = "true";
        value.textContent = commandTextRun?.text ?? "";

        options.bottomRow.append(prompt, value);
        options.setRenderedBottomBarSignature(options.getCurrentBottomBarSignature());
        return;
      }

      if (uiState.picker.active && uiState.picker.variant !== "bar") {
        options.bottomRow.textContent = " ";
        options.setRenderedBottomBarSignature(options.getCurrentBottomBarSignature());
        return;
      }

      if (pickerRuns.length > 0 || pickerMessage) {
        const actions = document.createElement("div");
        actions.className = "wx-editor__code-actions";
        actions.dataset.wxEditorCodeActions = "true";
        actions.dataset.wxEditorPicker = "true";

        if (pickerMessage) {
          actions.textContent = pickerMessage.text;
        } else {
          pickerRuns.forEach((entry, index) => {
            const pickerItem = document.createElement("span");
            pickerItem.className = "wx-editor__code-action";
            pickerItem.dataset.selected = String(!!entry.selectedInPicker);
            pickerItem.dataset.wxEditorCodeAction = String(index + 1);
            pickerItem.textContent = entry.text;
            actions.append(pickerItem);
          });
        }

        options.bottomRow.append(actions);
        options.setRenderedBottomBarSignature(options.getCurrentBottomBarSignature());
        return;
      }

      if (messageRun) {
        const message = document.createElement("span");
        message.className = "wx-editor__bottom-message";
        message.dataset.tone = messageRun.tone ?? "info";
        message.dataset.wxEditorBottomMessage = "true";
        message.textContent = messageRun.text;
        options.bottomRow.append(message);
        options.setRenderedBottomBarSignature(options.getCurrentBottomBarSignature());
        return;
      }

      if (prefixRun) {
        const prefix = document.createElement("span");
        prefix.className = "wx-editor__prefix-hint";
        prefix.dataset.wxEditorPrefixHint =
          uiState.flash.active
            ? "flash"
            : uiState.pendingAction?.kind === "flash-target"
              ? "flash-target"
              : uiState.pendingAction?.kind === "space"
                ? "space"
                : uiState.pendingAction?.kind === "z"
                  ? (uiState.pendingAction.sticky ? "Z" : "z")
                  : uiState.pendingAction?.kind ?? (uiState.pendingCount ? "count" : "prefix");
        prefix.textContent = prefixRun.text;
        options.bottomRow.append(prefix);
        options.setRenderedBottomBarSignature(options.getCurrentBottomBarSignature());
        return;
      }

      options.bottomRow.textContent = " ";
      options.setRenderedBottomBarSignature(options.getCurrentBottomBarSignature());
    },
    patchTooltip() {
      const uiState = options.getUiState();
      if (!uiState.hover.active) {
        options.tooltip.hidden = true;
        options.tooltip.replaceChildren();
        options.setRenderedTooltipSignature(options.getCurrentTooltipSignature());
        return;
      }

      const panel = options.getRenderedLayout().panels.find((entry) => entry.kind === "tooltip");

      if (!panel) {
        options.tooltip.hidden = true;
        options.tooltip.replaceChildren();
        options.setRenderedTooltipSignature(options.getCurrentTooltipSignature());
        return;
      }

      const metrics = options.getMetrics();
      options.tooltip.hidden = false;
      options.tooltip.dataset.tone = panel.tone ?? "info";
      options.tooltip.style.left = `${panel.anchor.col * metrics.charWidth}px`;
      options.tooltip.style.top = `${panel.anchor.row * metrics.lineHeight}px`;
      options.tooltip.replaceChildren();

      for (const row of panel.rows) {
        for (const run of row) {
          if (run.part === "tooltip-source") {
            const source = document.createElement("span");
            source.className = "wx-editor__tooltip-source";
            source.textContent = run.text;
            options.tooltip.append(source);
            continue;
          }

          const body = document.createElement("div");
          body.textContent = run.text;
          options.tooltip.append(body);
        }
      }

      options.setRenderedTooltipSignature(options.getCurrentTooltipSignature());
    }
  };
}
