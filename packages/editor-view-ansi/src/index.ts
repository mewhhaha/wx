import type { EditorState } from "../../editor-core/src/index";
import type { EditorController, EditorHostServices, EditorPresentationState } from "../../editor-controller/src/index";
import type { EditorLanguageServiceInput, LanguageProvider } from "../../editor-language/src/index";
import type { ThemeSpec } from "../../editor-theme/src/index";

export interface RenderEditorAnsiFrameInput {
  state: EditorState;
  presentation: EditorPresentationState;
  theme?: ThemeSpec;
  cols: number;
  rows: number;
  indentGuides?: {
    render?: boolean;
    character?: string;
    skipLevels?: number;
    indentWidth?: number;
  };
}

export interface CreateAnsiEditorMirrorOptions {
  controller?: EditorController;
  filePath?: string;
  host?: EditorHostServices | null;
  value?: string;
  language?: LanguageProvider | null;
  languageServices?: EditorLanguageServiceInput | null;
  write(text: string): void;
  theme?: ThemeSpec;
  cols: number;
  rows: number;
  enterAltScreen?: boolean;
  indentGuides?: {
    render?: boolean;
    character?: string;
    skipLevels?: number;
    indentWidth?: number;
  };
}

export interface AnsiEditorMirror {
  mount(): void;
  destroy(): void;
  resize(viewport: { cols: number; rows: number }): void;
  setTheme(theme: ThemeSpec): void;
  renderNow(): void;
}

export interface AnsiTerminalInput {
  isTTY?: boolean;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off?(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener?(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  resume(): void;
  pause?(): void;
  setEncoding?(encoding: BufferEncoding): void;
  setRawMode?(mode: boolean): void;
}

export interface AnsiTerminalOutput {
  columns?: number;
  rows?: number;
  on?(event: "resize", listener: () => void): unknown;
  off?(event: "resize", listener: () => void): unknown;
  removeListener?(event: "resize", listener: () => void): unknown;
}

export interface CreateAnsiEditorTerminalOptions extends CreateAnsiEditorMirrorOptions {
  input: AnsiTerminalInput;
  output?: AnsiTerminalOutput;
  availableThemes?: readonly ThemeSpec[];
  exit?(code?: number): void;
}

export interface AnsiEditorTerminal extends AnsiEditorMirror {}

export { renderEditorAnsiFrame } from "./frame";
export { createAnsiEditorMirror, createAnsiEditorTerminal, parseAnsiInput } from "./terminal";
export { runAnsiMirrorDemo } from "./demo-runtime";
