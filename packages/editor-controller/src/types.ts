import type {
  Command,
  CommandContext,
  EditorBufferDocumentState,
  EditorState,
  EditorViewState,
  InsertSession,
  SelectionSet,
  TextChange,
  Transaction
} from "@mewhhaha/wx-core";
import type {
  EditorCodeAction,
  EditorDiagnostic,
  EditorHover,
  EditorLanguageServiceInput,
  EditorLanguageServices,
  EditorLineRange,
  HighlightSpan,
  LanguageRegistry
} from "@mewhhaha/wx-language";
import type { EditorLineVisualRange, EditorVisualRow } from "@mewhhaha/wx-layout";

export interface HistoryEntry {
  doc: EditorState["doc"];
  selection: SelectionSet;
  mode: EditorState["mode"];
  insertSession: InsertSession | null;
  yankBuffer: string | null;
  lastDeletedFrom: number | null;
}

export interface EditorUpdate {
  prevState: EditorState;
  nextState: EditorState;
  transaction: Transaction;
  docChanged: boolean;
  selectionChanged: boolean;
  modeChanged: boolean;
}

export interface EditorSearchState {
  query: string;
  direction: "forward" | "backward";
  lastMatch: { from: number; to: number } | null;
}

export interface EditorSearchPresentationState extends EditorSearchState {
  matches: readonly { from: number; to: number }[];
  visibleMatchesByLine: Map<number, { from: number; to: number }[]>;
}

export interface EditorJumpEntry {
  selection: SelectionSet;
  mode: EditorState["mode"];
}

export interface EditorRegisterState {
  unnamed: string | null;
  search: string | null;
  named: Record<string, string>;
  selected: string | null;
}

export type EditorLineChangeKind = "added" | "modified" | "deleted";

export interface EditorLineChange {
  line: number;
  kind: EditorLineChangeKind;
}

export interface EditorHostServices {
  writeFile?(context: { filePath: string; text: string }): Promise<void>;
  readFile?(context: { filePath: string }): Promise<{ text: string } | string>;
  searchFiles?(context: {
    filePath: string;
    query: string;
  }): Promise<readonly EditorFileSearchResult[]>;
  listFolders?(context: { filePath: string }): Promise<readonly EditorFolderSearchResult[]>;
  getLineChanges?(context: { filePath: string; text: string }): Promise<readonly EditorLineChange[]>;
  didWriteFile?(context: { filePath: string; text: string }): Promise<void> | void;
}

export interface EditorCommandLineState {
  active: boolean;
  value: string;
  prompt: ":" | "/" | "?";
}

export interface EditorCommandCompletionItem {
  label: string;
  detail?: string;
}

export interface EditorBottomMessageState {
  tone: "info" | "warning" | "error";
  text: string;
}

export interface EditorPickerItemState {
  kind?: "file";
  label: string;
  detail?: string;
  filePath?: string;
  selected?: boolean;
}

export interface EditorPickerState {
  active: boolean;
  loading: boolean;
  title: string;
  items: readonly EditorPickerItemState[];
  selectedIndex: number;
  error: string | null;
  query: string;
  variant: "bar" | "modal" | "combo";
  inputMode?: "search" | "filename";
  previewTitle: string;
  previewContent: string;
  previewLoading: boolean;
}

export interface EditorCompletionItemState {
  label: string;
  detail?: string;
  kind?: string;
  documentation?: string;
  insertText?: string;
  selected?: boolean;
}

export interface EditorCompletionState {
  active: boolean;
  loading: boolean;
  anchorOffset: number | null;
  items: readonly EditorCompletionItemState[];
  selectedIndex: number;
  error: string | null;
}

export interface EditorRenameState {
  active: boolean;
  anchorOffset: number | null;
  value: string;
  error: string | null;
}

export interface EditorHoverState {
  active: boolean;
  pinned: boolean;
  offset: number | null;
  content: string;
  source?: string;
  tone: "info" | "warning" | "error";
}

export interface EditorFlashHintState {
  offset: number;
  label: string;
}

export interface EditorFlashState {
  active: boolean;
  target: string;
  input: string;
  hints: readonly EditorFlashHintState[];
}

export type EditorPendingAction =
  | null
  | { kind: "g" }
  | { kind: "ctrl-w" }
  | { kind: "[" | "]" }
  | { kind: "m" }
  | { kind: "?" }
  | { kind: "space" }
  | { kind: "flash-target" }
  | { kind: "z"; sticky: boolean }
  | { kind: "find"; variant: "f" | "F" | "t" | "T" }
  | { kind: "textobject"; mode: "around" | "inside" }
  | { kind: "surround-add" }
  | { kind: "surround-delete" }
  | { kind: "surround-replace-from" }
  | { kind: "surround-replace-to"; fromObject: string }
  | { kind: "register-select"; insert: boolean };

export type EditorRepeatableMotion =
  | { kind: "find"; variant: "f" | "F" | "t" | "T"; target: string }
  | { kind: "matching-bracket" }
  | { kind: "paragraph"; direction: "next" | "prev" }
  | { kind: "textobject"; mode: "around" | "inside"; object: string }
  | { kind: "search"; reverse: boolean };

export interface EditorLineChangeState {
  kind: Exclude<EditorLineChangeKind, "deleted"> | null;
  deleted: boolean;
}

export interface EditorViewportPresentationState {
  topVisualRow: number;
  visibleRowCapacity: number;
  scrolloffRows: number;
  wrapColumns: number;
  softWrap: boolean;
  visualRows: readonly EditorVisualRow[];
  visibleVisualRows: readonly EditorVisualRow[];
  lineVisualRanges: readonly EditorLineVisualRange[];
  wrapRevision: number;
}

export type EditorWorkspaceSplitAxis = "horizontal" | "vertical";

export type EditorPaneTreeNode =
  | {
      kind: "pane";
      paneId: string;
    }
  | {
      kind: "split";
      axis: EditorWorkspaceSplitAxis;
      ratio: number;
      first: EditorPaneTreeNode;
      second: EditorPaneTreeNode;
    };

export interface EditorLanguagePresentationState {
  services: readonly EditorLanguageServices[];
  host: EditorHostServices | null;
  languageRevision: number;
  lastHighlightedRevision: number;
  highlightRequestId: number;
  diagnosticsRequestId: number;
  lineChangesRequestId: number;
  hoverRequestId: number;
  completionRequestId: number;
  navigationRequestId: number;
  renameRequestId: number;
  symbolsRequestId: number;
  highlightCache: Map<number, HighlightSpan[]>;
  highlightCoverage: Set<number>;
  diagnostics: readonly EditorDiagnostic[];
  diagnosticsByLine: Map<number, EditorDiagnostic[]>;
  lineChangesByLine: Map<number, EditorLineChangeState>;
  visibleHighlights: readonly HighlightSpan[];
  visibleHighlightsByLine: Map<number, HighlightSpan[]>;
  visibleDiagnostics: readonly EditorDiagnostic[];
  visibleLineChanges: readonly EditorLineChange[];
}

export interface EditorUiPresentationState {
  commandLine: EditorCommandLineState;
  commandCompletionIndex: number;
  commandCompletionItems: readonly EditorCommandCompletionItem[];
  completion: EditorCompletionState;
  rename: EditorRenameState;
  picker: EditorPickerState;
  bottomMessage: EditorBottomMessageState | null;
  hover: EditorHoverState;
  flash: EditorFlashState;
  pendingAction: EditorPendingAction;
  pendingCount: string;
  stickyViewMode: boolean;
  previewTheme: string | null;
  lastRepeatableMotion: EditorRepeatableMotion | null;
}

export interface EditorPresentationState {
  filePath: string | null;
  bufferTitle: string;
  themeName: string | null;
  viewport: EditorViewportPresentationState;
  language: EditorLanguagePresentationState;
  ui: EditorUiPresentationState;
  search: EditorSearchPresentationState;
  jumps: {
    items: readonly EditorJumpEntry[];
    cursor: number;
  };
  registers: EditorRegisterState;
}

export interface EditorWorkspacePanePresentationState {
  paneId: string;
  bufferId: string;
  active: boolean;
  filePath: string | null;
  bufferTitle: string;
  buffer: EditorBufferDocumentState;
  view: EditorViewState;
  state: EditorState;
  presentation: EditorPresentationState;
}

export interface EditorWorkspacePresentationState {
  activePaneId: string;
  activeBufferId: string;
  layoutTree: EditorPaneTreeNode;
  panes: readonly EditorWorkspacePanePresentationState[];
}

export interface EditorFileSearchResult {
  filePath: string;
  detail?: string;
}

export interface EditorFolderSearchResult {
  folderPath: string;
  detail?: string;
}

export interface EditorBufferState {
  id: string;
  kind: "file" | "scratch";
  filePath: string | null;
  displayName: string;
  dirty: boolean;
}

export interface EditorCommandLineKeyOptions {
  themeNames?: readonly string[];
  shift?: boolean;
}

export interface EditorCommandLineKeyResult {
  handled: boolean;
  quit?: boolean;
  themeName?: string | null;
}

export interface EditorKeyInput {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
  shift?: boolean;
  text?: string;
  source?: "dom" | "ansi";
}

export interface EditorKeyInputOptions extends EditorCommandLineKeyOptions {
  readClipboardText?: () => Promise<string | null>;
}

export interface EditorKeyInputResult extends EditorCommandLineKeyResult {
  handled: boolean;
}

export type EditorUpdateListener = (update: EditorUpdate) => void;

export interface HistoryPlugin {
  record(update: EditorUpdate, options?: { checkpoint?: boolean }): void;
  undo(currentState: EditorState): HistoryEntry | null;
  redo(currentState: EditorState): HistoryEntry | null;
  checkpoint(): boolean;
  clear(): void;
}

export interface EditorController {
  getState(): EditorState;
  getPresentationState(): EditorPresentationState;
  getWorkspacePresentationState(): EditorWorkspacePresentationState;
  dispatch(transaction: Transaction): void;
  replaceState(nextState: EditorState, transaction?: Transaction): void;
  execute(command: Command, context?: Omit<CommandContext, "history">): boolean;
  subscribe(listener: EditorUpdateListener): () => void;
  getSearchState(): EditorSearchState;
  setSearchState(next: Partial<EditorSearchState>): void;
  clearSearchState(): void;
  pushJump(): boolean;
  jumpBackward(): EditorJumpEntry | null;
  jumpForward(): EditorJumpEntry | null;
  getJumpList(): readonly EditorJumpEntry[];
  getRegister(name?: string | null): string | null;
  setRegister(name: string | null, value: string | null): void;
  selectRegister(name: string | null): void;
  getSelectedRegister(): string | null;
  getBuffers(): readonly EditorBufferState[];
  switchBuffer(bufferId: string): boolean;
  openBuffer(filePath: string): Promise<boolean>;
  openEmptyFileBuffer(filePath: string): boolean;
  newScratchBuffer(): boolean;
  newScratchSplit(axis: EditorWorkspaceSplitAxis): boolean;
  splitPane(axis: EditorWorkspaceSplitAxis): boolean;
  closePane(): boolean;
  onlyPane(): boolean;
  focusNextPane(): boolean;
  swapPane(direction: "left" | "right" | "up" | "down"): boolean;
  openSelectionInPane(axis: EditorWorkspaceSplitAxis): Promise<boolean>;
  focusPane(direction: "left" | "right" | "up" | "down"): boolean;
  setActivePane(paneId: string): boolean;
  searchFiles(query?: string): Promise<readonly EditorFileSearchResult[]>;
  listFolders(): Promise<readonly EditorFolderSearchResult[]>;
  selectNextOccurrence(reverse?: boolean): boolean;
  selectAllOccurrences(): boolean;
  splitSelectionsByLine(): boolean;
  collapseSelections(): boolean;
  removePrimarySelection(): boolean;
  requestCompletion(): Promise<boolean>;
  acceptCompletion(index?: number): Promise<boolean>;
  moveCompletion(delta: number): boolean;
  dismissCompletion(): boolean;
  gotoTarget(kind: "definition" | "declaration" | "type-definition" | "implementation" | "references"): Promise<boolean>;
  renameSymbol(nextName: string): Promise<boolean>;
  openSymbols(kind: "document" | "workspace"): Promise<boolean>;
  updatePresentationState(
    updater: (state: EditorPresentationState) => void,
    effectType?: string,
    options?: { defer?: boolean }
  ): void;
  setBottomMessage(message: EditorBottomMessageState | null): void;
  clearBottomMessage(): void;
  setViewportMetrics(metrics: { visibleRowCapacity: number; wrapColumns: number; softWrap: boolean }): void;
  scrollViewportBy(rowsDelta: number): boolean;
  alignViewportToSelection(position: "top" | "center" | "bottom"): boolean;
  revealSelection(): void;
  setLanguageServices(languageServices: EditorLanguageServiceInput | readonly EditorLanguageServices[] | null): void;
  setLanguageRegistry(registry: LanguageRegistry | null): void;
  resetLanguageServices(): void;
  setHostServices(host: EditorHostServices | null): void;
  setFilePath(filePath: string | null): void;
  setThemeName(themeName: string | null): void;
  handleKeyInput(input: EditorKeyInput, options?: EditorKeyInputOptions): Promise<EditorKeyInputResult>;
  handleTextInput(text: string, options?: EditorKeyInputOptions): Promise<EditorKeyInputResult>;
  openCommandLine(prompt: ":" | "/" | "?"): void;
  handleCommandLineKey(key: string, options?: EditorCommandLineKeyOptions): Promise<EditorCommandLineKeyResult>;
  repeatSearch(reverseAgainstDirection?: boolean): boolean;
  beginFlashTarget(): void;
  handleFlashKey(key: string): boolean;
  refreshLanguage(options?: {
    changes?: readonly TextChange[];
    forceDocumentSync?: boolean;
    highlightViewport?: EditorLineRange;
    refreshHighlights?: boolean;
    refreshDiagnostics?: boolean;
    refreshLineChanges?: boolean;
  }): Promise<void>;
  requestHoverAt(offset: number, options?: { pinned?: boolean }): Promise<boolean>;
  showDiagnosticHover(diagnostic: EditorDiagnostic, options?: { pinned?: boolean }): boolean;
  clearHover(options?: { preservePinned?: boolean }): boolean;
  clearFlash(): boolean;
  requestHover(offset: number): Promise<EditorHover | null>;
  dismissHover(): void;
  requestCodeActions(): Promise<readonly EditorCodeAction[]>;
  applyCodeAction(action: EditorCodeAction): Promise<boolean>;
  formatDocument(): Promise<boolean>;
  saveDocument(targetPath?: string | null): Promise<boolean>;
}

export interface CreateEditorControllerOptions {
  state?: EditorState;
  value?: string;
  selection?: SelectionSet;
  mode?: EditorState["mode"];
  language?: string;
  theme?: string;
  filePath?: string;
  languageRegistry?: LanguageRegistry | null;
  history?: HistoryPlugin | false;
}
