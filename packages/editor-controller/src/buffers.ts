import { createEditorState, type EditorState } from "@wx/editor-core";

import type { EditorBufferState } from "./types";

interface BufferEntry extends EditorBufferState {
  state: EditorState;
}

interface CreateBuffersRuntimeOptions {
  initialState: EditorState;
  initialFilePath: string;
}

export interface BuffersRuntime {
  syncActiveState(state: EditorState, options?: { docChanged?: boolean }): void;
  syncActiveFilePath(filePath: string): void;
  markActiveSaved(filePath?: string): void;
  getBuffers(): readonly EditorBufferState[];
  getActiveBufferId(): string;
  getBufferEntry(bufferId: string): BufferEntry | null;
  findBufferByFilePath(filePath: string): BufferEntry | null;
  addBuffer(filePath: string, state: EditorState, dirty?: boolean): BufferEntry;
  activateBuffer(bufferId: string): boolean;
  createStateForText(text: string, template: EditorState): EditorState;
}

export function createBuffersRuntime(options: CreateBuffersRuntimeOptions): BuffersRuntime {
  let nextBufferId = 2;
  const buffers = new Map<string, BufferEntry>();
  const initialBuffer: BufferEntry = {
    id: "buffer-1",
    filePath: options.initialFilePath,
    dirty: false,
    state: options.initialState
  };
  buffers.set(initialBuffer.id, initialBuffer);
  let activeBufferId = initialBuffer.id;

  const getActiveBuffer = () => buffers.get(activeBufferId) ?? initialBuffer;
  const findBufferByFilePath = (filePath: string) => {
    for (const entry of buffers.values()) {
      if (entry.filePath === filePath) {
        return entry;
      }
    }
    return null;
  };

  return {
    syncActiveState(state, runtimeOptions = {}) {
      const activeBuffer = getActiveBuffer();
      activeBuffer.state = state;
      if (runtimeOptions.docChanged) {
        activeBuffer.dirty = true;
      }
    },
    syncActiveFilePath(filePath) {
      const activeBuffer = getActiveBuffer();
      activeBuffer.filePath = filePath;
    },
    markActiveSaved(filePath) {
      const activeBuffer = getActiveBuffer();
      if (filePath) {
        activeBuffer.filePath = filePath;
      }
      activeBuffer.dirty = false;
    },
    getBuffers() {
      return [...buffers.values()].map(({ id, filePath, dirty }) => ({ id, filePath, dirty }));
    },
    getActiveBufferId() {
      return activeBufferId;
    },
    getBufferEntry(bufferId) {
      return buffers.get(bufferId) ?? null;
    },
    findBufferByFilePath,
    addBuffer(filePath, state, dirty = false) {
      const existing = findBufferByFilePath(filePath);
      if (existing) {
        existing.state = state;
        existing.dirty = dirty;
        return existing;
      }

      const entry: BufferEntry = {
        id: `buffer-${nextBufferId++}`,
        filePath,
        dirty,
        state
      };
      buffers.set(entry.id, entry);
      return entry;
    },
    activateBuffer(bufferId) {
      if (!buffers.has(bufferId)) {
        return false;
      }

      activeBufferId = bufferId;
      return true;
    },
    createStateForText(text, template) {
      return createEditorState({
        value: text,
        selection: undefined,
        mode: "normal",
        language: template.language,
        theme: template.theme
      });
    }
  };
}
