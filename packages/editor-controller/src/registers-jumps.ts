import type { EditorState } from "@wx/editor-core";

import { createJumpEntry, jumpEntryEquals, normalizeRegisterName } from "./session";
import type { EditorJumpEntry, EditorPresentationState } from "./types";

interface CreateRegistersJumpsRuntimeOptions {
  presentation: EditorPresentationState;
  registers: EditorPresentationState["registers"];
  jumpList: EditorJumpEntry[];
  getState(): EditorState;
  dispatch(transaction: { selection?: EditorState["selection"]; mode?: EditorState["mode"]; yankBuffer?: string | null }): void;
  emitPresentationUpdate(effectType?: string): void;
  revealSelectionWithinViewport(): boolean;
  syncVisibleViewportRows(): boolean;
  syncVisibleLanguageDecorations(): void;
}

export interface RegistersJumpsRuntime {
  applyRegisterValue(name: string | null, value: string | null, effectType?: string): void;
  getRegister(name?: string | null): string | null;
  selectRegister(name: string | null): void;
  getSelectedRegister(): string | null;
  primeSelectedRegisterForPaste(): void;
  pushJumpEntry(entry: EditorJumpEntry): boolean;
  restoreJump(entry: EditorJumpEntry | null): boolean;
  jumpBackward(): EditorJumpEntry | null;
  jumpForward(): EditorJumpEntry | null;
  getJumpList(): EditorJumpEntry[];
}

export function createRegistersJumpsRuntime(options: CreateRegistersJumpsRuntimeOptions): RegistersJumpsRuntime {
  const { presentation, registers, jumpList, getState, dispatch, emitPresentationUpdate } = options;
  let jumpCursor = presentation.jumps.cursor;

  const trimJumpTail = () => {
    if (jumpCursor < jumpList.length) {
      jumpList.splice(jumpCursor);
    }
  };

  const readRegisterValue = (name: string | null | undefined): string | null => {
    const normalized = normalizeRegisterName(name ?? registers.selected);
    if (!normalized || normalized === "\"") {
      return registers.unnamed;
    }
    if (normalized === "/") {
      return registers.search;
    }
    return registers.named[normalized] ?? null;
  };

  return {
    applyRegisterValue(name, value, effectType = "register.update") {
      const normalized = normalizeRegisterName(name);

      if (!normalized) {
        registers.unnamed = value;
      } else if (normalized === "/") {
        registers.search = value;
      } else if (value === null) {
        delete registers.named[normalized];
      } else {
        registers.named[normalized] = value;
      }

      emitPresentationUpdate(effectType);
    },
    getRegister(name = null) {
      return readRegisterValue(name);
    },
    selectRegister(name) {
      const next = normalizeRegisterName(name);
      if (registers.selected === next) {
        return;
      }
      registers.selected = next;
      emitPresentationUpdate("register.select");
    },
    getSelectedRegister() {
      return registers.selected;
    },
    primeSelectedRegisterForPaste() {
      const selected = registers.selected;
      registers.selected = null;
      if (!selected) {
        return;
      }

      dispatch({
        yankBuffer: readRegisterValue(selected)
      });
    },
    pushJumpEntry(entry) {
      trimJumpTail();
      const previous = jumpList[jumpList.length - 1];

      if (previous && jumpEntryEquals(previous, entry)) {
        jumpCursor = jumpList.length;
        presentation.jumps.cursor = jumpCursor;
        return false;
      }

      jumpList.push(entry);
      if (jumpList.length > 100) {
        jumpList.shift();
      }
      jumpCursor = jumpList.length;
      presentation.jumps.cursor = jumpCursor;
      return true;
    },
    restoreJump(entry) {
      if (!entry) {
        return false;
      }

      dispatch({
        selection: entry.selection,
        mode: entry.mode
      });
      options.revealSelectionWithinViewport();
      options.syncVisibleViewportRows();
      options.syncVisibleLanguageDecorations();
      return true;
    },
    jumpBackward() {
      if (jumpList.length === 0) {
        return null;
      }

      if (jumpCursor === jumpList.length) {
        this.pushJumpEntry(createJumpEntry(getState()));
      }

      if (jumpCursor <= 1) {
        return null;
      }

      jumpCursor -= 2;
      const target = jumpList[jumpCursor] ?? null;
      jumpCursor += 1;
      presentation.jumps.cursor = jumpCursor;
      return target;
    },
    jumpForward() {
      if (jumpCursor >= jumpList.length) {
        return null;
      }

      const target = jumpList[jumpCursor] ?? null;
      if (!target) {
        return null;
      }

      jumpCursor += 1;
      presentation.jumps.cursor = jumpCursor;
      return target;
    },
    getJumpList() {
      return [...jumpList];
    }
  };
}
