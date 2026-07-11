import { inferRegisterKind, type EditorState, type RegisterKind } from "@mewhhaha/wx-core";

import { createJumpEntry, jumpEntryEquals, normalizeRegisterName } from "./session";
import type { EditorJumpEntry, EditorPresentationState, EditorRegisterValue } from "./types";

interface CreateRegistersJumpsRuntimeOptions {
  presentation: EditorPresentationState;
  registers: EditorPresentationState["registers"];
  jumpList: EditorJumpEntry[];
  getState(): EditorState;
  getFilePath(): string | null;
  openBuffer(filePath: string): Promise<boolean>;
  dispatch(transaction: {
    selection?: EditorState["selection"];
    mode?: EditorState["mode"];
    yankBuffer?: string | null;
    yankKind?: RegisterKind;
  }): void;
  emitPresentationUpdate(effectType?: string): void;
  revealSelectionWithinViewport(): boolean;
  syncVisibleViewportRows(): boolean;
  syncVisibleLanguageDecorations(): void;
}

export interface RegistersJumpsRuntime {
  applyRegisterValue(name: string | null, value: string | null, effectType?: string, kind?: RegisterKind): void;
  getRegister(name?: string | null): string | null;
  getRegisterKind(name?: string | null): RegisterKind;
  selectRegister(name: string | null): void;
  getSelectedRegister(): string | null;
  primeSelectedRegisterForPaste(): void;
  pushJumpEntry(entry: EditorJumpEntry): boolean;
  restoreJump(entry: EditorJumpEntry | null): Promise<boolean>;
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

  const readRegisterEntry = (name: string | null | undefined): EditorRegisterValue | null => {
    const normalized = normalizeRegisterName(name ?? registers.selected);
    if (!normalized || normalized === "\"") {
      return registers.unnamed === null
        ? null
        : { text: registers.unnamed, kind: registers.unnamedKind };
    }
    if (normalized === "/") {
      return registers.search === null ? null : { text: registers.search, kind: "characterwise" };
    }
    const text = registers.named[normalized];
    return text === undefined
      ? null
      : { text, kind: registers.namedKinds[normalized] ?? inferRegisterKind(text) };
  };

  return {
    applyRegisterValue(name, value, effectType = "register.update", kind = inferRegisterKind(value)) {
      const normalized = normalizeRegisterName(name);
      const entry = value === null ? null : { text: value, kind };

      if (!normalized) {
        registers.unnamed = entry?.text ?? null;
        registers.unnamedKind = entry?.kind ?? "characterwise";
      } else if (normalized === "/") {
        registers.search = value;
      } else if (value === null) {
        delete registers.named[normalized];
        delete registers.namedKinds[normalized];
      } else {
        registers.named[normalized] = entry!.text;
        registers.namedKinds[normalized] = entry!.kind;
      }

      emitPresentationUpdate(effectType);
    },
    getRegister(name = null) {
      return readRegisterEntry(name)?.text ?? null;
    },
    getRegisterKind(name = null) {
      return readRegisterEntry(name)?.kind ?? "characterwise";
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

      const entry = readRegisterEntry(selected);
      dispatch({ yankBuffer: entry?.text ?? null, yankKind: entry?.kind ?? "characterwise" });
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
    async restoreJump(entry) {
      if (!entry) {
        return false;
      }

      if (entry.filePath && entry.filePath !== options.getFilePath()) {
        if (!(await options.openBuffer(entry.filePath))) return false;
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
        this.pushJumpEntry(createJumpEntry(getState(), options.getFilePath()));
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
