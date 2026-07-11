import type { EditorState } from "@mewhhaha/wx-core";
import type { EditorController, EditorHostServices, EditorPresentationState, KeymapConfig } from "@mewhhaha/wx-controller";
import type { EditorLanguageServiceInput, LanguageProvider, LanguageRegistry } from "@mewhhaha/wx-language";
import type { ThemeSpec } from "@mewhhaha/wx-theme";

export interface AnsiFrameCursor {
  row: number;
  col: number;
  shape: "beam" | "block";
}

/** A complete logical terminal frame. Rows include their ANSI style runs. */
export interface AnsiFrameSnapshot {
  cols: number;
  rows: number;
  serializedRows: readonly string[];
  cursor: AnsiFrameCursor | null;
}

export type AnsiFramePatchKind = "none" | "cursor" | "rows" | "full";

export interface AnsiFramePatch {
  text: string;
  kind: AnsiFramePatchKind;
  damagedRows: readonly number[];
  bytes: number;
}

export interface AnsiTerminalMetrics {
  bytesWritten: number;
  writes: number;
  fullRepaints: number;
  rowPatches: number;
  cursorPatches: number;
  skippedFrames: number;
  damagedRows: number;
  lastWriteBytes: number;
  outputQueueDepth: number;
  maxOutputQueueDepth: number;
  maxOutputQueueAgeMs: number;
  inputQueueDepth: number;
  maxInputQueueDepth: number;
  maxInputQueueAgeMs: number;
  inputBacklogBytes: number;
  maxInputBacklogBytes: number;
  inputBacklogAgeMs: number;
  maxInputBacklogAgeMs: number;
  inputPausedCount: number;
  inputCommands: number;
  desynchronizations: number;
}

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
  /** Applied only when this host creates the controller. */
  keymap?: KeymapConfig;
  filePath?: string;
  host?: EditorHostServices | null;
  value?: string;
  language?: LanguageProvider | null;
  languageServices?: EditorLanguageServiceInput | null;
  languageRegistry?: LanguageRegistry | null;
  write(text: string): unknown;
  theme?: ThemeSpec;
  cols: number;
  rows: number;
  enterAltScreen?: boolean;
  indentGuides?: RenderEditorAnsiFrameInput["indentGuides"];
  now?: () => number;
  onMetrics?(metrics: Readonly<AnsiTerminalMetrics>): void;
  onWriteError?(error: unknown): void;
}

export interface AnsiEditorMirror {
  mount(): void;
  destroy(): void;
  resize(viewport: { cols: number; rows: number }): void;
  setTheme(theme: ThemeSpec): void;
  renderNow(): void;
  resume(): void;
  markDesynchronized(): void;
  getMetrics(): Readonly<AnsiTerminalMetrics>;
  whenIdle(): Promise<void>;
}

export interface AnsiTerminalInput {
  isTTY?: boolean;
  on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown;
  off?(event: "data", listener: (chunk: Uint8Array | string) => void): unknown;
  removeListener?(event: "data", listener: (chunk: Uint8Array | string) => void): unknown;
  readonly readableHighWaterMark?: number;
  unshift?(chunk: Uint8Array | string): unknown;
  resume(): void;
  pause?(): void;
  close?(): unknown;
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
  inputQueueLimit?: number;
  escapeSequenceTimeoutMs?: number;
}

export interface AnsiEditorTerminal extends AnsiEditorMirror {}
