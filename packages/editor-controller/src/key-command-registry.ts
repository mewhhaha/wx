import {
  DEFAULT_INDENTATION_CONFIG,
  alignSelectionColumns,
  addSurround,
  appendInsertMode,
  appendInsertModeAtLineEnd,
  changeSelection,
  collapseSelections,
  decrementSelections,
  deleteBackwardIndentAware,
  deleteForward,
  deleteSelection,
  enterInsertMode,
  enterNormalMode,
  ensureForwardSelections,
  flipSelectionDirection,
  findNextChar,
  findPrevChar,
  findTillNextChar,
  findTillPrevChar,
  gotoFileStart,
  gotoFirstNonWhitespace,
  gotoLastLine,
  gotoLine,
  gotoLineEnd,
  gotoLineStart,
  gotoMatchingBracket,
  gotoNextParagraph,
  gotoPrevParagraph,
  gotoWindowBottom,
  gotoWindowCenter,
  gotoWindowTop,
  halfPageDown,
  halfPageUp,
  insertNewline,
  insertFirstNonWhitespace,
  insertText,
  incrementSelections,
  indentSelections,
  joinSelectionLines,
  keepPrimarySelection,
  mergeConsecutiveSelections,
  mergeOverlappingSelections,
  moveDown,
  moveLeft,
  moveNextLongWordEnd,
  moveNextLongWordStart,
  moveNextWordStart,
  movePrevLongWordStart,
  moveRight,
  moveUp,
  moveWordBackward,
  moveWordForward,
  openAbove,
  openBelow,
  pageDown,
  pageUp,
  pasteAfter,
  pasteBefore,
  redo,
  removePrimarySelection,
  replaceSelectionCharacters,
  replaceSurround,
  rotatePrimarySelection,
  selectAll,
  selectLineBelow,
  splitSelectionsOnNewline,
  transformSelectionCase,
  trimSelections,
  toggleVisualMode,
  undo,
  outdentSelections,
  yankSelection,
  deleteSurround,
  type Command
} from "@mewhhaha/wx-core";
import { commandCatalogById, type CommandMetadata } from "./command-catalog";
import type { KeymapArgs } from "./keymap-schema";
import type { KeyRuntimeContext } from "./key-runtime-types";
import type { EditorKeyInput, EditorKeyInputOptions, EditorKeyInputResult } from "./types";

export interface RuntimeCommandInvocation { readonly command: string; readonly args?: KeymapArgs; readonly operands?: readonly string[]; readonly input: EditorKeyInput; readonly options: EditorKeyInputOptions; }
export type SyncRuntimeCommandHandler = (invocation: RuntimeCommandInvocation) => EditorKeyInputResult;
export type RuntimeCommandHandler = (invocation: RuntimeCommandInvocation) => EditorKeyInputResult | Promise<EditorKeyInputResult>;
export interface RuntimeCommandRegistry { readonly handlers: ReadonlyMap<string, RuntimeCommandHandler>; readonly catalog: ReadonlyMap<string, CommandMetadata>; dispatch(invocation: RuntimeCommandInvocation): EditorKeyInputResult | Promise<EditorKeyInputResult>; }

const handled = (value = true): EditorKeyInputResult => ({ handled: value });

export function createRuntimeCommandRegistry(context: KeyRuntimeContext, catalog: ReadonlyMap<string, CommandMetadata> = commandCatalogById): RuntimeCommandRegistry {
  const handlers = new Map<string, RuntimeCommandHandler>();
  const register = (id: string, handler: SyncRuntimeCommandHandler) => {
    if (catalog.get(id)?.async) throw new Error(`Command ${id} is declared async but registered as synchronous`);
    handlers.set(id, handler);
  };
  const registerAsync = (id: string, handler: RuntimeCommandHandler) => {
    if (!catalog.get(id)?.async) throw new Error(`Command ${id} has an async runtime handler but is not declared async`);
    handlers.set(id, handler);
  };
  const core = new Map<string, Command>([
    ["mode.insert", enterInsertMode], ["mode.append", appendInsertMode], ["mode.insert-line-start", insertFirstNonWhitespace], ["mode.append-line-end", appendInsertModeAtLineEnd], ["mode.normal", enterNormalMode], ["mode.visual", toggleVisualMode],
    ["motion.left", moveLeft], ["motion.right", moveRight], ["motion.up", moveUp], ["motion.down", moveDown], ["motion.word-forward", moveWordForward], ["motion.word-backward", moveWordBackward], ["motion.word-start", moveNextWordStart], ["motion.W-start", moveNextLongWordStart], ["motion.B-start", movePrevLongWordStart], ["motion.E-end", moveNextLongWordEnd], ["motion.page-up", pageUp], ["motion.page-down", pageDown], ["motion.half-page-up", halfPageUp], ["motion.half-page-down", halfPageDown],
    ["goto.file-start", gotoFileStart], ["goto.line-start", gotoLineStart], ["goto.line-end", gotoLineEnd], ["goto.first-non-whitespace", gotoFirstNonWhitespace], ["goto.last-line", gotoLastLine], ["goto.window-top", gotoWindowTop], ["goto.window-center", gotoWindowCenter], ["goto.window-bottom", gotoWindowBottom],
    ["edit.select-all", selectAll], ["edit.change", changeSelection], ["edit.delete", deleteSelection], ["edit.paste-after", pasteAfter], ["edit.paste-before", pasteBefore], ["edit.yank", yankSelection], ["edit.undo", undo], ["edit.redo", redo], ["edit.open-below", openBelow], ["edit.open-above", openAbove], ["edit.select-line-below", selectLineBelow], ["edit.delete-backward", deleteBackwardIndentAware("  ")], ["edit.delete-forward", deleteForward], ["edit.newline", insertNewline], ["edit.indent", insertText("  ")]
  ]);
  for (const [id, command] of core) {
    if (command === pasteAfter || command === pasteBefore) registerAsync(id, async ({ options }) => { await context.executeCommandWithCount(command, options); return handled(); });
    else register(id, () => { const metadata = catalog.get(id); if (metadata?.count) context.executeCommandWithCountSync(command); else context.executeEditorCommand(command); return handled(); });
  }
  const operand = (id: string, invocation: RuntimeCommandInvocation) => { const arity = catalog.get(id)?.operand?.arity ?? 0; if ((invocation.operands?.length ?? 0) < arity) { context.setPendingActionState({ kind: "command-operand", command: id, args: invocation.args, operands: [...(invocation.operands ?? [])] }); return false; } return true; };
  const selectionCommand = (id: string, transform: (state: ReturnType<KeyRuntimeContext["getState"]>) => Parameters<ReturnType<KeyRuntimeContext["getController"]>["dispatch"]>[0]) => register(id, () => {
    context.getController().dispatch(transform(context.getState()));
    return handled();
  });
  selectionCommand("selection.collapse", (state) => collapseSelections(state));
  selectionCommand("selection.keep-primary", keepPrimarySelection);
  selectionCommand("selection.remove-primary", removePrimarySelection);
  selectionCommand("selection.flip", flipSelectionDirection);
  selectionCommand("selection.ensure-forward", ensureForwardSelections);
  selectionCommand("selection.rotate-primary-forward", (state) => rotatePrimarySelection(state, 1));
  selectionCommand("selection.rotate-primary-backward", (state) => rotatePrimarySelection(state, -1));
  selectionCommand("selection.merge-overlapping", mergeOverlappingSelections);
  selectionCommand("selection.merge-consecutive", mergeConsecutiveSelections);
  selectionCommand("selection.split-newline", splitSelectionsOnNewline);
  selectionCommand("selection.trim", trimSelections);
  selectionCommand("selection.join-lines", (state) => joinSelectionLines(state, false));
  selectionCommand("selection.join-lines-space", (state) => joinSelectionLines(state, true));
  selectionCommand("selection.align", alignSelectionColumns);
  selectionCommand("selection.toggle-case", (state) => transformSelectionCase(state, "toggle"));
  selectionCommand("selection.lower-case", (state) => transformSelectionCase(state, "lower"));
  selectionCommand("selection.upper-case", (state) => transformSelectionCase(state, "upper"));
  selectionCommand("selection.indent", (state) => indentSelections(state, DEFAULT_INDENTATION_CONFIG.indentUnit));
  selectionCommand("selection.outdent", (state) => outdentSelections(state, DEFAULT_INDENTATION_CONFIG.indentUnit));
  selectionCommand("selection.increment", incrementSelections);
  selectionCommand("selection.decrement", decrementSelections);
  register("selection.replace-character", (invocation) => {
    if (!operand("selection.replace-character", invocation)) return handled();
    context.getController().dispatch(replaceSelectionCharacters(context.getState(), invocation.operands![0]!));
    return handled();
  });
  registerAsync("selection.split-regex", async () => {
    context.clearPendingCount();
    context.openCommandLine(":");
    await context.getController().handleTextInput("split-regex ");
    return handled();
  });
  registerAsync("selection.format", async () => handled(await context.getController().formatDocument()));
  for (const [id, direction, command] of [["goto.previous-paragraph", "prev", gotoPrevParagraph], ["goto.next-paragraph", "next", gotoNextParagraph]] as const) register(id, () => { const revision = context.getState().revision; context.executeCommandWithCountSync(command); context.recordRepeatableMotion({ kind: "paragraph", direction }, context.getState().revision !== revision); return handled(); });
  register("goto.counted-line", ({ args }) => {
    const rawCount = context.getPresentation().ui.pendingCount;
    const target = rawCount ? context.readPendingCount() : args?.fallback === "last" ? context.getState().doc.lineCount : 1;
    context.executeEditorCommand(gotoLine(target));
    return handled();
  });
  register("goto.matching-bracket", () => { const revision = context.getState().revision; context.executeEditorCommand(gotoMatchingBracket); context.recordRepeatableMotion({ kind: "matching-bracket" }, context.getState().revision !== revision); return handled(); });
  for (const [id, variant] of [["find.next-char", "f"], ["find.previous-char", "F"], ["find.till-next-char", "t"], ["find.till-previous-char", "T"]] as const) register(id, (invocation) => { if (!operand(id, invocation)) return handled(); const target = invocation.operands![0]!; const revision = context.getState().revision; context.executeEditorCommand(variant === "f" ? findNextChar(target) : variant === "F" ? findPrevChar(target) : variant === "t" ? findTillNextChar(target) : findTillPrevChar(target)); context.recordRepeatableMotion({ kind: "find", variant, target }, context.getState().revision !== revision); return handled(); });
  registerAsync("textobject.select", async (invocation) => { if (!operand(invocation.command, invocation)) return handled(); const mode = invocation.args?.scope === "inside" ? "inside" : "around"; const revision = context.getState().revision; const didRun = await context.selectTextobjectWithFallback(mode, invocation.operands![0]!); context.recordRepeatableMotion({ kind: "textobject", mode, object: invocation.operands![0]! }, didRun || context.getState().revision !== revision); return handled(); });
  register("surround.add", (invocation) => { if (!operand(invocation.command, invocation)) return handled(); context.executeEditorCommand(addSurround(invocation.operands![0]!)); return handled(); });
  register("surround.delete", (invocation) => { if (!operand(invocation.command, invocation)) return handled(); context.executeEditorCommand(deleteSurround(invocation.operands![0]!)); return handled(); });
  register("surround.replace", (invocation) => { if (!operand(invocation.command, invocation)) return handled(); context.executeEditorCommand(replaceSurround(invocation.operands![0]!, invocation.operands![1]!)); return handled(); });
  register("register.select", (invocation) => { if (!operand(invocation.command, invocation)) return handled(); const name = invocation.operands![0]!; context.getController().selectRegister(name); context.setBottomMessage({ tone: "info", text: `Register "${name}" selected` }); return handled(); });
  registerAsync("register.insert", async (invocation) => { if (!operand(invocation.command, invocation)) return handled(); const name = invocation.operands![0]!; const controller = context.getController(); const value = name === "+" ? (await invocation.options.readClipboardText?.()) ?? null : controller.getRegister(name); controller.selectRegister(null); if (!value) { context.setBottomMessage({ tone: "warning", text: `Register ${name} is empty` }); return handled(); } context.executeEditorCommand(insertText(value)); return handled(); });
  const prefix = (id: string, next: Parameters<KeyRuntimeContext["setPendingActionState"]>[0]) => register(id, () => { context.setPendingActionState(next); return handled(); });
  prefix("prefix.goto", { kind: "g" }); prefix("prefix.match", { kind: "m" }); prefix("prefix.bracket-prev", { kind: "[" }); prefix("prefix.bracket-next", { kind: "]" }); prefix("prefix.ctrl-w", { kind: "ctrl-w" });
  register("prefix.question", () => { context.clearPendingCount(); context.setPendingActionState({ kind: "?" }); return handled(); });
  register("prefix.view", () => { context.setStickyViewMode(false); context.setPendingActionState({ kind: "z", sticky: false }); return handled(); });
  register("prefix.sticky-view", () => { context.setStickyViewMode(true); context.setPendingActionState({ kind: "z", sticky: true }); return handled(); });
  register("jump.flash", () => { context.setPendingActionState({ kind: "flash-target" }, "flash.pending"); return handled(); });
  register("completion.previous", () => handled(context.moveCompletion(-1))); register("completion.next", () => handled(context.moveCompletion(1))); registerAsync("completion.accept", async () => handled(await context.acceptCompletion())); register("completion.dismiss", () => { context.dismissCompletion(); return handled(); });
  registerAsync("ui.signature-help", async () => handled(await context.requestSignatureHelp()));
  register("signature.previous", () => handled(context.moveSignatureHelp(-1)));
  register("signature.next", () => handled(context.moveSignatureHelp(1)));
  register("signature.dismiss", () => { context.dismissSignatureHelp(); return handled(); });
  register("picker.previous", ({ args }) => { if (args?.variant === "bar" && context.getPresentation().ui.picker.variant !== "bar") return handled(false); context.movePicker(-1); return handled(); }); register("picker.next", ({ args }) => { if (args?.variant === "bar" && context.getPresentation().ui.picker.variant !== "bar") return handled(false); context.movePicker(1); return handled(); }); registerAsync("picker.accept", async () => { await context.acceptPicker(); return handled(); }); register("picker.dismiss", () => { context.closePicker("ui.picker.close"); return handled(); }); registerAsync("picker.delete-backward", async () => handled(await context.updatePickerQuery(context.getPresentation().ui.picker.query.slice(0, -1))));
  for (const disposition of ["horizontal", "vertical", "background"] as const) registerAsync(`picker.accept-${disposition}`, async () => { if (context.getPresentation().ui.picker.title !== "workspace search") return handled(false); await context.acceptPicker(undefined, disposition); return handled(); });
  register("hover.dismiss", () => { context.clearHover(); context.clearPendingCount(); return handled(); });
  register("diagnostic.next", ({ args }) => { context.navigateDiagnostic("next", args?.extreme === true); return handled(); }); register("diagnostic.previous", ({ args }) => { context.navigateDiagnostic("prev", args?.extreme === true); return handled(); });
  registerAsync("syntax.next", async ({ args }) => { await context.navigateSyntax("next", String(args?.target ?? "")); return handled(); }); registerAsync("syntax.previous", async ({ args }) => { await context.navigateSyntax("prev", String(args?.target ?? "")); return handled(); }); registerAsync("syntax.select-up", async () => handled(await context.handleAltArrowSyntaxSelection("ArrowUp"))); registerAsync("syntax.select-down", async () => handled(await context.handleAltArrowSyntaxSelection("ArrowDown")));
  registerAsync("comment.toggle", async () => { await context.toggleComments("line"); return handled(); }); registerAsync("comment.smart", async () => { await context.toggleComments("smart"); return handled(); });
  register("search.forward", () => { context.clearPendingCount(); context.openCommandLine("/"); return handled(); }); register("search.backward", () => { context.clearPendingCount(); context.openCommandLine("?"); return handled(); }); register("search.selection", ({ input }) => { context.searchFromSelection(!!input.alt); return handled(); }); register("search.repeat-next", () => { context.repeatSearch(false); return handled(); }); register("search.repeat-previous", () => { context.repeatSearch(true); return handled(); });
  registerAsync("repeat.motion", async ({ options }) => { const motion = context.getPresentation().ui.lastRepeatableMotion; if (!motion) return handled(false); await context.runRepeatableMotion(motion, options); return handled(); });
  registerAsync("repeat.edit", async ({ options }) => { const edit = context.getPresentation().ui.lastRepeatableEdit; if (!edit) return handled(false); return handled(await context.runRepeatableEdit(edit, options)); });
  for (const kind of ["definition", "declaration", "type-definition", "implementation", "references"] as const) registerAsync(`goto.${kind}`, async () => handled(await context.gotoTarget(kind)));
  const showHover = async () => { const offset = context.getActiveOffset(); const diagnostic = context.getPresentation().language.diagnostics.find((entry) => offset >= entry.from && offset < entry.to); if (diagnostic) context.getController().showDiagnosticHover(diagnostic, { pinned: true }); else await context.getController().requestHoverAt(offset, { pinned: true }); return handled(); };
  registerAsync("ui.hover", showHover); registerAsync("ui.completion", async () => handled(await context.requestCompletion())); registerAsync("ui.file-picker", async () => handled(await context.openFileSearchPicker())); registerAsync("ui.workspace-search", async () => handled(await context.openWorkspaceSearchPicker())); registerAsync("ui.code-actions", async () => { await context.loadCodeActions(); return handled(); });
  register("ui.command-line", ({ options }) => { context.clearPendingCount(); context.openCommandLine(":"); const result = context.syncCommandPreviewTheme(options.themeNames ?? []); if (result.changed) context.emitPresentationUpdate("ui.command-line.completion"); return { handled: true, themeName: result.themeName }; });
  registerAsync("ui.rename", async () => { context.openCommandLine(":"); await context.getController().handleTextInput("rename "); return handled(); });
  register("history.checkpoint", () => { context.getController().execute((_state, _dispatch, commandContext) => commandContext.history?.checkpoint?.() ?? false); return handled(); });
  for (const [id, open] of [["picker.buffers", () => context.openBuffersPicker()], ["picker.diagnostics", () => context.openDiagnosticsPicker()], ["picker.jumps", () => context.openJumpListPicker()], ["picker.panes", () => context.openPanesPicker()]] as const) register(id, () => { open(); return handled(); });
  registerAsync("picker.symbols-document", async () => { await context.openSymbols("document"); return handled(); }); registerAsync("picker.symbols-workspace", async () => { await context.openSymbols("workspace"); return handled(); });
  const controller = () => context.getController();
  register("workspace.save-jump", () => { controller().pushJump(); context.setBottomMessage({ tone: "info", text: "Saved jump" }); return handled(); });
  registerAsync("workspace.jump-back", async () => { await context.restoreJump(controller().jumpBackward()); return handled(); });
  registerAsync("workspace.jump-forward", async () => { await context.restoreJump(controller().jumpForward()); return handled(); });
  const cycleBuffer = (delta: number) => { const buffers = controller().getBuffers(); const active = controller().getWorkspacePresentationState().activeBufferId; const index = buffers.findIndex((entry) => entry.id === active); return buffers.length > 1 && index >= 0 ? controller().switchBuffer(buffers[(index + delta + buffers.length) % buffers.length]!.id) : false; };
  register("workspace.next-buffer", () => { cycleBuffer(1); return handled(); }); register("workspace.previous-buffer", () => { cycleBuffer(-1); return handled(); });
  for (const [id, fn] of [["workspace.split-vertical", () => controller().splitPane("vertical")], ["workspace.split-horizontal", () => controller().splitPane("horizontal")], ["workspace.close-pane", () => controller().closePane()], ["workspace.only-pane", () => controller().onlyPane()], ["workspace.focus-next-pane", () => controller().focusNextPane()], ["workspace.new-scratch-horizontal", () => controller().newScratchSplit("horizontal")]] as const) register(id, () => { fn(); return handled(); });
  for (const direction of ["left", "right", "up", "down"] as const) { register(`workspace.focus-${direction}`, () => { controller().focusPane(direction); return handled(); }); register(`workspace.swap-${direction}`, () => { controller().swapPane(direction); return handled(); }); }
  registerAsync("workspace.open-selection-horizontal", async () => { await controller().openSelectionInPane("horizontal"); return handled(); }); registerAsync("workspace.open-selection-vertical", async () => { await controller().openSelectionInPane("vertical"); return handled(); });
  register("view.center", () => { controller().alignViewportToSelection("center"); return handled(); }); register("view.top", () => { controller().alignViewportToSelection("top"); return handled(); }); register("view.bottom", () => { controller().alignViewportToSelection("bottom"); return handled(); }); register("view.scroll-up", () => { controller().scrollViewportBy(-1); return handled(); }); register("view.scroll-down", () => { controller().scrollViewportBy(1); return handled(); });
  const page = (id: string, delta: () => number) => register(id, () => { controller().scrollViewportBy(delta()); return handled(); }); page("view.page-up", () => -Math.max(1, context.getVisibleLineCount() - 1)); page("view.page-down", () => Math.max(1, context.getVisibleLineCount() - 1)); page("view.half-page-up", () => -Math.max(1, Math.floor(context.getVisibleLineCount() / 2))); page("view.half-page-down", () => Math.max(1, Math.floor(context.getVisibleLineCount() / 2)));
  register("view.exit-sticky", () => { context.setStickyViewMode(false); return handled(); });
  const missing = [...catalog.keys()].filter((id) => !handlers.has(id)); if (missing.length) throw new Error(`Missing runtime command handlers: ${missing.join(", ")}`);
  return { handlers, catalog, dispatch(invocation) { const handler = handlers.get(invocation.command); if (!handler) throw new Error(`No runtime handler for ${invocation.command}`); return handler(invocation); } };
}
