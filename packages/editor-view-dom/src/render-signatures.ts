import { getActiveCharacterOffset, getCursorOffset, type EditorState } from "@mewhhaha/wx-core";
import type { EditorPresentationState } from "@mewhhaha/wx-controller";
import type { ThemeSpec } from "@mewhhaha/wx-theme";

function serializePendingAction(pendingAction: EditorPresentationState["ui"]["pendingAction"]): string {
  if (!pendingAction) {
    return "";
  }

  if (pendingAction.kind === "z") {
    return `${pendingAction.kind}:${pendingAction.sticky ? 1 : 0}`;
  }

  if (pendingAction.kind === "find") {
    return `${pendingAction.kind}:${pendingAction.variant}`;
  }

  if (pendingAction.kind === "textobject") {
    return `${pendingAction.kind}:${pendingAction.mode}`;
  }

  if (pendingAction.kind === "surround-replace-to") {
    return `${pendingAction.kind}:${pendingAction.fromObject}`;
  }

  if (pendingAction.kind === "register-select") {
    return `${pendingAction.kind}:${pendingAction.insert ? 1 : 0}`;
  }

  return pendingAction.kind;
}

export function getEffectiveThemeSpec(
  presentation: EditorPresentationState,
  theme: ThemeSpec,
  availableCommandThemes: readonly ThemeSpec[]
): ThemeSpec {
  const previewName = presentation.ui.previewTheme;
  if (previewName) {
    return availableCommandThemes.find((entry) => entry.name === previewName) ?? theme;
  }

  const committedName = presentation.themeName;
  if (committedName) {
    return availableCommandThemes.find((entry) => entry.name === committedName) ?? theme;
  }

  return theme;
}

export function getEffectiveThemeName(
  presentation: EditorPresentationState,
  theme: ThemeSpec
): string {
  return presentation.ui.previewTheme ?? presentation.themeName ?? theme.name;
}

export function readStatusSignature(options: {
  state: EditorState;
  presentation: EditorPresentationState;
  bufferTitle: string;
  diagnosticsSummary: { errors: number; warnings: number };
}): string {
  const cursorOffset =
    options.state.mode === "insert"
      ? getCursorOffset(options.state.selection)
      : getActiveCharacterOffset(options.state);
  const cursorPosition = options.state.doc.positionAt(cursorOffset);

  return [
    options.state.mode,
    options.presentation.ui.flash.active ? "flash" : "",
    serializePendingAction(options.presentation.ui.pendingAction),
    options.bufferTitle,
    options.presentation.fileStatus.dirty ? 1 : 0,
    options.presentation.fileStatus.externalChanged ? 1 : 0,
    options.diagnosticsSummary.errors,
    options.diagnosticsSummary.warnings,
    cursorPosition.line,
    cursorPosition.column
  ].join("|");
}

export function readBottomBarSignature(presentation: EditorPresentationState): string {
  const ui = presentation.ui;

  return [
    ui.commandLine.active ? 1 : 0,
    ui.commandLine.prompt,
    ui.commandLine.value,
    ui.commandCompletionIndex,
    ui.commandCompletionItems.map((item) => `${item.label}:${item.detail ?? ""}`).join(";"),
    ui.completion.active ? 1 : 0,
    ui.completion.loading ? 1 : 0,
    ui.completion.anchorOffset ?? -1,
    ui.completion.selectedIndex,
    ui.completion.error ?? "",
    ui.completion.items.map((item) => `${item.label}:${item.detail ?? ""}:${item.selected ? 1 : 0}`).join(";"),
    ui.signatureHelp.active ? 1 : 0,
    ui.signatureHelp.loading ? 1 : 0,
    ui.signatureHelp.anchorOffset ?? -1,
    ui.signatureHelp.selectedIndex,
    ui.signatureHelp.signatures.map((item) => `${item.label}:${item.activeParameter ?? -1}`).join(";"),
    ui.picker.active ? 1 : 0,
    ui.picker.loading ? 1 : 0,
    ui.picker.title,
    ui.picker.query,
    ui.picker.variant,
    ui.picker.selectedIndex,
    ui.picker.error ?? "",
    ui.picker.previewTitle,
    ui.picker.previewContent,
    ui.picker.previewLoading ? 1 : 0,
    ui.picker.items.map((item) => `${item.kind ?? ""}:${item.filePath ?? ""}:${item.label}:${item.detail ?? ""}:${item.selected ? 1 : 0}`).join(";"),
    ui.bottomMessage?.tone ?? "",
    ui.bottomMessage?.text ?? "",
    ui.flash.active ? 1 : 0,
    ui.flash.target,
    ui.flash.input,
    ui.flash.hints.map((hint) => `${hint.offset}:${hint.label}`).join(";"),
    serializePendingAction(ui.pendingAction),
    ui.pendingCount
  ].join("|");
}

export function readTooltipSignature(options: {
  presentation: EditorPresentationState;
  hoverAnchor: { left: number; top: number };
}): string {
  const hover = options.presentation.ui.hover;

  return [
    hover.active ? 1 : 0,
    hover.pinned ? 1 : 0,
    hover.offset ?? -1,
    hover.source ?? "",
    hover.tone,
    hover.content,
    options.hoverAnchor.left,
    options.hoverAnchor.top
  ].join("|");
}
