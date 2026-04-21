import {
  applyTransaction,
  createSelectionSet,
  getSelectionOffsets,
  type EditorState,
  type TextChange
} from "@mewhhaha/wx-core";
import type {
  EditorCompletionItem,
  EditorLocationTarget,
  EditorRenameChangeSet,
  EditorSymbol
} from "@mewhhaha/wx-language";

import type { PickerActionItem, PickerSearchSource } from "./picker";
import type {
  LanguageCompletionSource,
  LanguageGotoSource,
  LanguageLspRuntime,
  LanguageRenameSource,
  LanguageRuntimeContext,
  LanguageSymbolSource,
  LineChangeHostServices
} from "./language-runtime-types";
import type { EditorBottomMessageState } from "./types";

interface CreateLanguageLspRuntimeOptions {
  context: LanguageRuntimeContext;
  getCompletionSource(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageCompletionSource | undefined;
  getGotoSource(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageGotoSource | undefined;
  getRenameSource(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageRenameSource | undefined;
  getSymbolSource(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LanguageSymbolSource | undefined;
  getHostServices(presentation: ReturnType<LanguageRuntimeContext["getPresentation"]>): LineChangeHostServices | null;
  setBottomMessage(message: EditorBottomMessageState | null): void;
  setCompletionState(next: ReturnType<LanguageRuntimeContext["getPresentation"]>["ui"]["completion"], effectType?: string): void;
  setRenameState(next: ReturnType<LanguageRuntimeContext["getPresentation"]>["ui"]["rename"], effectType?: string): void;
  applySelectionRange(from: number, to: number): void;
  revealSelectionWithinViewport(): boolean;
  syncVisibleViewportRows(): boolean;
  syncVisibleLanguageDecorations(): boolean;
  ensureVisibleHighlightCoverage(): Promise<void>;
  pushJump(): boolean;
  openBuffer(filePath: string): Promise<boolean>;
  findBufferState(filePath: string): EditorState | null;
  storeBufferState(filePath: string, state: EditorState, dirty?: boolean): void;
  createStateForText(text: string, template: EditorState): EditorState;
  openActionPicker(options: {
    title: string;
    items: readonly PickerActionItem[];
    selectedIndex?: number;
    query?: string;
    variant?: "bar" | "modal";
    effectType?: string;
  }): boolean;
  openSearchPicker(source: PickerSearchSource): Promise<boolean>;
}

type GotoKind = "definition" | "declaration" | "type-definition" | "implementation" | "references";
type SymbolKind = "document" | "workspace";

function completionStateFromItems(
  items: readonly EditorCompletionItem[],
  selectedIndex: number,
  anchorOffset: number
): ReturnType<CreateLanguageLspRuntimeOptions["context"]["getPresentation"]>["ui"]["completion"] {
  return {
    active: true,
    loading: false,
    anchorOffset,
    items: items.map((item, index) => ({
      label: item.label,
      detail: item.detail,
      kind: item.kind,
      documentation: item.documentation,
      insertText: item.insertText,
      selected: index === selectedIndex
    })),
    selectedIndex,
    error: items.length === 0 ? "No completions" : null
  };
}

function flattenSymbols(symbols: readonly EditorSymbol[], parentPath = ""): EditorSymbol[] {
  const flattened: EditorSymbol[] = [];

  for (const symbol of symbols) {
    const name = parentPath ? `${parentPath} › ${symbol.name}` : symbol.name;
    flattened.push({
      ...symbol,
      name
    });

    if (symbol.children?.length) {
      flattened.push(...flattenSymbols(symbol.children, name));
    }
  }

  return flattened;
}

function describeLocation(snapshot: ReturnType<LanguageRuntimeContext["getSnapshot"]>, target: EditorLocationTarget): string {
  const position = snapshot.doc.positionAt(target.from);
  const lineText = snapshot.doc.lineAt(position.line).text.trim();
  return target.detail ?? `${position.line + 1}:${position.column + 1} ${lineText}`.trim();
}

function gotoSourceMethod(source: LanguageGotoSource | undefined, kind: GotoKind) {
  if (!source) {
    return null;
  }

  return kind === "definition"
    ? source.definition
    : kind === "declaration"
      ? source.declaration
      : kind === "type-definition"
        ? source.typeDefinition
        : kind === "implementation"
          ? source.implementation
          : source.references;
}

export function createLanguageLspRuntime(options: CreateLanguageLspRuntimeOptions): LanguageLspRuntime {
  const dismissCompletion = (effectType = "ui.completion.dismiss") => {
    const presentation = options.context.getPresentation();
    const current = presentation.ui.completion;

    if (!current.active && !current.loading && current.anchorOffset === null && current.items.length === 0 && !current.error) {
      return false;
    }

    options.setCompletionState(
      {
        active: false,
        loading: false,
        anchorOffset: null,
        items: [],
        selectedIndex: 0,
        error: null
      },
      effectType
    );
    return true;
  };

  const jumpToTarget = async (target: EditorLocationTarget) => {
    const presentation = options.context.getPresentation();
    const nextPath = target.filePath ?? presentation.filePath;
    options.pushJump();

    if (nextPath && nextPath !== presentation.filePath) {
      const opened = await options.openBuffer(nextPath);
      if (!opened) {
        return false;
      }
    }

    options.applySelectionRange(target.from, target.to);
    options.revealSelectionWithinViewport();
    options.syncVisibleViewportRows();
    options.syncVisibleLanguageDecorations();
    void options.ensureVisibleHighlightCoverage();
    return true;
  };

  const loadPreviewText = async (filePath: string | null) => {
    const presentation = options.context.getPresentation();
    if (filePath === presentation.filePath) {
      return options.context.getState().doc.text;
    }

    if (!filePath) {
      return null;
    }

    const existing = options.findBufferState(filePath);
    if (existing) {
      return existing.doc.text;
    }

    const readFile = options.getHostServices(presentation)?.readFile;
    if (!readFile) {
      return null;
    }

    const payload = await readFile({ filePath });
    return typeof payload === "string" ? payload : payload.text;
  };

  const buildLocationPickerItems = (
    targets: readonly EditorLocationTarget[],
    snapshot: ReturnType<LanguageRuntimeContext["getSnapshot"]>
  ): PickerActionItem[] => {
    return targets.map((target) => {
      const presentation = options.context.getPresentation();
      const filePath = target.filePath ?? presentation.filePath;
      const title = filePath ?? presentation.bufferTitle;
      return {
        label: title,
        detail: describeLocation(snapshot, target),
        preview: async () => {
          const text = await loadPreviewText(filePath);
          if (text === null) {
            return null;
          }
          return { title, content: text };
        },
        run: async () => {
          const jumped = await jumpToTarget(target);
          if (jumped) {
            dismissCompletion("ui.completion.dismiss");
          }
        }
      };
    });
  };

  const requestCompletion = async () => {
    const presentation = options.context.getPresentation();
    const completionSource = options.getCompletionSource(presentation);
    const snapshot = options.context.getSnapshot();
    const anchorOffset = getSelectionOffsets(options.context.getState()).to;

    dismissCompletion("ui.completion.dismiss");

    if (!completionSource) {
      options.setBottomMessage({ tone: "warning", text: "No completion source" });
      return false;
    }

    const requestId = ++presentation.language.completionRequestId;
    const revision = snapshot.revision;
    const filePath = presentation.filePath;
    options.setCompletionState(
      {
        active: true,
        loading: true,
        anchorOffset,
        items: [],
        selectedIndex: 0,
        error: null
      },
      "ui.completion"
    );

    let items: readonly EditorCompletionItem[];
    try {
      items = await completionSource.complete(snapshot, anchorOffset);
    } catch {
      items = [];
    }

    const nextPresentation = options.context.getPresentation();
    if (
      requestId !== nextPresentation.language.completionRequestId ||
      revision !== options.context.getSnapshot().revision ||
      filePath !== nextPresentation.filePath
    ) {
      return false;
    }

    const sortedItems = [...items].sort((left, right) => {
      const leftKey = left.sortText ?? left.label;
      const rightKey = right.sortText ?? right.label;
      return leftKey.localeCompare(rightKey);
    });

    options.setCompletionState(completionStateFromItems(sortedItems, 0, anchorOffset), "ui.completion");

    if (sortedItems.length === 0) {
      options.setBottomMessage({ tone: "warning", text: "No completions" });
      return false;
    }

    options.setBottomMessage(null);
    return true;
  };

  const moveCompletion = (delta: number) => {
    const presentation = options.context.getPresentation();
    const completion = presentation.ui.completion;

    if (!completion.active || completion.items.length === 0) {
      return false;
    }

    const nextIndex = Math.max(0, Math.min(completion.items.length - 1, completion.selectedIndex + delta));
    if (nextIndex === completion.selectedIndex) {
      return false;
    }

    options.setCompletionState(
      {
        ...completion,
        items: completion.items.map((item, index) => ({ ...item, selected: index === nextIndex })),
        selectedIndex: nextIndex
      },
      "ui.completion"
    );
    return true;
  };

  const acceptCompletion = async (index = options.context.getPresentation().ui.completion.selectedIndex) => {
    const state = options.context.getState();
    const presentation = options.context.getPresentation();
    const completion = presentation.ui.completion;
    const item = completion.items[index];

    if (!completion.active || !item) {
      return false;
    }

    if (!state.selection.ranges[state.selection.primaryIndex]) {
      return false;
    }

    const selection = getSelectionOffsets(state);
    const insertText = item.insertText ?? item.label;
    const change: TextChange = {
      from: selection.from,
      to: selection.to,
      insert: insertText
    };
    const nextState = applyTransaction(state, { changes: [change] });
    const nextRanges = nextState.selection.ranges.map((range) => ({ ...range }));
    const nextOffset = change.from + insertText.length;
    nextRanges[nextState.selection.primaryIndex] = state.mode === "insert"
      ? { anchor: nextOffset, head: nextOffset, preferredColumn: null }
      : {
          anchor: Math.max(change.from, nextOffset === change.from ? change.from : nextOffset - 1),
          head: Math.max(change.from, nextOffset === change.from ? change.from : nextOffset - 1),
          preferredColumn: null
        };

    options.context.dispatch({
      changes: [change],
      selection: createSelectionSet(nextRanges, nextState.selection.primaryIndex),
      effects: [{ type: "language.completion.accept", value: item.label }]
    });
    dismissCompletion("ui.completion.dismiss");
    return true;
  };

  const gotoTarget = async (kind: GotoKind) => {
    const presentation = options.context.getPresentation();
    const gotoSource = options.getGotoSource(presentation);
    const snapshot = options.context.getSnapshot();
    const offset = getSelectionOffsets(options.context.getState()).from;
    const method = gotoSourceMethod(gotoSource, kind);

    if (!method) {
      options.setBottomMessage({ tone: "warning", text: `No ${kind} provider` });
      return false;
    }

    const requestId = ++presentation.language.navigationRequestId;
    const revision = snapshot.revision;
    const filePath = presentation.filePath;
    let targets: readonly EditorLocationTarget[];
    try {
      targets = await method(snapshot, offset);
    } catch {
      targets = [];
    }

    const nextPresentation = options.context.getPresentation();
    if (
      requestId !== nextPresentation.language.navigationRequestId ||
      revision !== options.context.getSnapshot().revision ||
      filePath !== nextPresentation.filePath
    ) {
      return false;
    }

    if (targets.length === 0) {
      options.setBottomMessage({ tone: "warning", text: `No ${kind} results` });
      return false;
    }

    if (kind !== "references" && targets.length === 1) {
      return jumpToTarget(targets[0]!);
    }

    return options.openActionPicker({
      title: kind === "references" ? "references" : kind,
      items: buildLocationPickerItems(targets, snapshot),
      variant: "modal"
    });
  };

  const openSymbols = async (kind: SymbolKind) => {
    const presentation = options.context.getPresentation();
    const symbolSource = options.getSymbolSource(presentation);
    const snapshot = options.context.getSnapshot();

    if (!symbolSource) {
      options.setBottomMessage({ tone: "warning", text: "No symbol source" });
      return false;
    }

    const requestId = ++presentation.language.symbolsRequestId;
    const revision = snapshot.revision;
    const filePath = presentation.filePath;

    if (kind === "workspace") {
      return options.openSearchPicker({
        title: "workspace symbols",
        variant: "modal",
        load: async (query) => {
          const activePresentation = options.context.getPresentation();
          const activeSource = options.getSymbolSource(activePresentation);
          const nextRequestId = ++activePresentation.language.symbolsRequestId;
          const symbols = await (activeSource?.workspaceSymbols?.(query, options.context.getSnapshot()) ?? Promise.resolve([]));
          const flattened = flattenSymbols(symbols);

          if (nextRequestId !== options.context.getPresentation().language.symbolsRequestId) {
            return [];
          }

          return buildLocationPickerItems(
            flattened.map((symbol) => ({
              from: symbol.from,
              to: symbol.to,
              filePath: symbol.filePath,
              detail: symbol.detail ?? symbol.kind
            })),
            options.context.getSnapshot()
          ).map((item, index) => ({
            ...item,
            label: flattened[index]?.name ?? item.label,
            detail: flattened[index]?.detail ?? item.detail
          }));
        }
      });
    }

    let symbols: readonly EditorSymbol[];
    try {
      symbols = await (symbolSource.documentSymbols?.(snapshot) ?? Promise.resolve([]));
    } catch {
      symbols = [];
    }

    const nextPresentation = options.context.getPresentation();
    if (
      requestId !== nextPresentation.language.symbolsRequestId ||
      revision !== options.context.getSnapshot().revision ||
      filePath !== nextPresentation.filePath
    ) {
      return false;
    }

    const flattened = flattenSymbols(symbols);
    if (flattened.length === 0) {
      options.setBottomMessage({ tone: "warning", text: "No document symbols" });
      return false;
    }

    return options.openActionPicker({
      title: "document symbols",
      items: flattened.map((symbol) => ({
        label: symbol.name,
        detail: symbol.detail ?? symbol.kind ?? "",
        preview: async () => {
          const targetFilePath = symbol.filePath ?? options.context.getPresentation().filePath;
          const text = await loadPreviewText(targetFilePath);
          if (text === null) {
            return null;
          }
          return {
            title: targetFilePath ?? options.context.getPresentation().bufferTitle,
            content: text
          };
        },
        run: async () => {
          await jumpToTarget({
            from: symbol.from,
            to: symbol.to,
            filePath: symbol.filePath
          });
        }
      })),
      variant: "modal"
    });
  };

  const renameSymbol = async (nextName: string) => {
    const trimmedName = nextName.trim();
    const presentation = options.context.getPresentation();
    const renameSource = options.getRenameSource(presentation);
    const snapshot = options.context.getSnapshot();
    const offset = getSelectionOffsets(options.context.getState()).from;

    if (!trimmedName) {
      options.setRenameState(
        {
          active: false,
          anchorOffset: offset,
          value: "",
          error: "Rename target required"
        },
        "ui.rename"
      );
      options.setBottomMessage({ tone: "warning", text: "Rename target required" });
      return false;
    }

    if (!renameSource) {
      options.setBottomMessage({ tone: "warning", text: "No rename source" });
      return false;
    }

    const requestId = ++presentation.language.renameRequestId;
    const revision = snapshot.revision;
    const filePath = presentation.filePath;
    options.setRenameState(
      {
        active: true,
        anchorOffset: offset,
        value: trimmedName,
        error: null
      },
      "ui.rename"
    );

    let changeSets: readonly EditorRenameChangeSet[] | null;
    try {
      changeSets = await renameSource.rename(snapshot, offset, trimmedName);
    } catch {
      changeSets = null;
    }

    const nextPresentation = options.context.getPresentation();
    if (
      requestId !== nextPresentation.language.renameRequestId ||
      revision !== options.context.getSnapshot().revision ||
      filePath !== nextPresentation.filePath
    ) {
      return false;
    }

    if (!changeSets || changeSets.length === 0) {
      options.setRenameState(
        {
          active: false,
          anchorOffset: offset,
          value: trimmedName,
          error: "Nothing to rename"
        },
        "ui.rename"
      );
      options.setBottomMessage({ tone: "warning", text: "Nothing to rename" });
      return false;
    }

    const host = options.getHostServices(nextPresentation);
    const needsExternalIo = changeSets.some((entry) => (entry.filePath ?? nextPresentation.filePath) !== nextPresentation.filePath);
    if (needsExternalIo && (!host?.readFile || !host.writeFile)) {
      options.setRenameState(
        {
          active: false,
          anchorOffset: offset,
          value: trimmedName,
          error: "Cross-file rename needs host file IO"
        },
        "ui.rename"
      );
      options.setBottomMessage({ tone: "error", text: "Cross-file rename needs host file IO" });
      return false;
    }

    const activeFilePath = nextPresentation.filePath;
    const externalPlans: Array<{ filePath: string; nextState: EditorState }> = [];
    let currentChanges: readonly TextChange[] | null = null;

    for (const changeSet of changeSets) {
      const targetPath = changeSet.filePath ?? activeFilePath;
      if (!targetPath) {
        currentChanges = changeSet.changes;
        continue;
      }

      if (targetPath === activeFilePath) {
        currentChanges = changeSet.changes;
        continue;
      }

      const existingState = options.findBufferState(targetPath);
      let baseState = existingState;

      if (!baseState) {
        const payload = await host!.readFile!({ filePath: targetPath });
        const text = typeof payload === "string" ? payload : payload.text;
        baseState = options.createStateForText(text, options.context.getState());
      }

      externalPlans.push({
        filePath: targetPath,
        nextState: applyTransaction(baseState, { changes: changeSet.changes })
      });
    }

    for (const plan of externalPlans) {
      try {
        await host!.writeFile!({ filePath: plan.filePath, text: plan.nextState.doc.text });
      } catch {
        options.setRenameState(
          {
            active: false,
            anchorOffset: offset,
            value: trimmedName,
            error: `Rename failed for ${plan.filePath}`
          },
          "ui.rename"
        );
        options.setBottomMessage({ tone: "error", text: `Rename failed for ${plan.filePath}` });
        return false;
      }

      options.storeBufferState(plan.filePath, plan.nextState, false);
    }

    if (currentChanges && currentChanges.length > 0) {
      options.context.dispatch({
        changes: currentChanges,
        effects: [{ type: "language.rename", value: trimmedName }]
      });
      options.revealSelectionWithinViewport();
      options.syncVisibleViewportRows();
      options.syncVisibleLanguageDecorations();
      void options.ensureVisibleHighlightCoverage();
    }

    options.setRenameState(
      {
        active: false,
        anchorOffset: offset,
        value: trimmedName,
        error: null
      },
      "ui.rename"
    );
    options.setBottomMessage({ tone: "info", text: `Renamed to ${trimmedName}` });
    return true;
  };

  return {
    requestCompletion,
    acceptCompletion,
    moveCompletion,
    dismissCompletion,
    gotoTarget,
    renameSymbol,
    openSymbols,
    resetLspTracking() {
      const presentation = options.context.getPresentation();
      presentation.language.completionRequestId = 0;
      presentation.language.navigationRequestId = 0;
      presentation.language.renameRequestId = 0;
      presentation.language.symbolsRequestId = 0;
    }
  };
}
