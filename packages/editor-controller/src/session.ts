import type { EditorState, SelectionSet, Transaction } from "@wx/editor-core";
import type { EditorLanguageServiceInput, EditorLanguageServices } from "@wx/editor-language";
import type { EditorJumpEntry } from "./types";

export function selectionEquals(left: SelectionSet, right: SelectionSet): boolean {
  if (left.primaryIndex !== right.primaryIndex || left.ranges.length !== right.ranges.length) {
    return false;
  }

  return left.ranges.every((range, index) => {
    const other = right.ranges[index];
    return (
      !!other &&
      range.anchor === other.anchor &&
      range.head === other.head &&
      range.preferredColumn === other.preferredColumn
    );
  });
}

export function jumpEntryEquals(left: EditorJumpEntry, right: EditorJumpEntry): boolean {
  return left.mode === right.mode && selectionEquals(left.selection, right.selection);
}

export function createJumpEntry(state: EditorState): EditorJumpEntry {
  return {
    selection: state.selection,
    mode: state.mode
  };
}

export function normalizeRegisterName(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }

  return name.toLowerCase();
}

export function normalizeLanguageServices(
  input: EditorLanguageServiceInput | readonly EditorLanguageServices[] | null | undefined
): EditorLanguageServices[] {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? [...(input as readonly EditorLanguageServices[])] : [input as EditorLanguageServices];
}

export function transactionRequiresFullDocumentLanguageSync(transaction: Transaction): boolean {
  if ((transaction.changes?.length ?? 0) > 0) {
    return false;
  }

  return (transaction.effects ?? []).some((effect) => {
    return effect.type === "controller.replace-state" || effect.type.startsWith("history.");
  });
}
