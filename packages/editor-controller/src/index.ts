import {
  applyTransaction,
  clampCharacterOffset,
  clampInsertionOffset,
  createCharacterSelection,
  createEditorState,
  getActiveCharacterOffset,
  getCursorOffset,
  getSelectionOffsets,
  mapOffsetThroughChanges,
  normalizeSelection,
  type Command,
  type CommandContext,
  type EditorState,
  type InsertSession,
  type SelectionSet,
  type TextChange,
  type Transaction
} from "@wx/editor-core";
import type {
  DiagnosticSeverity,
  EditorCodeAction,
  EditorDiagnostic,
  EditorHover,
  EditorLineRange,
  EditorLanguageServiceInput,
  EditorLanguageServices,
  HighlightSpan
} from "@wx/editor-language";
import {
  buildVisualRows,
  getVisualRowForOffset,
  type EditorLineVisualRange,
  type EditorVisualRow
} from "../../editor-layout/src/index";

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
  getLineChanges?(context: { filePath: string; text: string }): Promise<readonly EditorLineChange[]>;
  didWriteFile?(context: { filePath: string; text: string }): Promise<void> | void;
}

export interface EditorCommandLineState {
  active: boolean;
  value: string;
  prompt: ":" | "/" | "?";
}

export interface EditorBottomMessageState {
  tone: "info" | "warning" | "error";
  text: string;
}

export interface EditorPickerItemState {
  label: string;
  detail?: string;
  selected?: boolean;
}

export interface EditorPickerState {
  active: boolean;
  loading: boolean;
  title: string;
  items: readonly EditorPickerItemState[];
  selectedIndex: number;
  error: string | null;
}

export interface EditorHoverState {
  active: boolean;
  pinned: boolean;
  offset: number | null;
  content: string;
  source?: string;
  tone: "info" | "warning" | "error";
  left: number;
  top: number;
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
  | { kind: "[" | "]" }
  | { kind: "m" }
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

export interface EditorLanguagePresentationState {
  services: readonly EditorLanguageServices[];
  host: EditorHostServices | null;
  languageRevision: number;
  lastHighlightedRevision: number;
  highlightRequestId: number;
  diagnosticsRequestId: number;
  lineChangesRequestId: number;
  hoverRequestId: number;
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
  filePath: string;
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
  updatePresentationState(
    updater: (state: EditorPresentationState) => void,
    effectType?: string,
    options?: { defer?: boolean }
  ): void;
  setViewportMetrics(metrics: { visibleRowCapacity: number; wrapColumns: number; softWrap: boolean }): void;
  scrollViewportBy(rowsDelta: number): boolean;
  alignViewportToSelection(position: "top" | "center" | "bottom"): boolean;
  revealSelection(): void;
  setLanguageServices(languageServices: EditorLanguageServiceInput | readonly EditorLanguageServices[] | null): void;
  setHostServices(host: EditorHostServices | null): void;
  setFilePath(filePath: string): void;
  setThemeName(themeName: string | null): void;
  refreshLanguage(options?: {
    changes?: readonly TextChange[];
    forceDocumentSync?: boolean;
    highlightViewport?: EditorLineRange;
    refreshHighlights?: boolean;
    refreshDiagnostics?: boolean;
    refreshLineChanges?: boolean;
  }): Promise<void>;
  requestHover(offset: number): Promise<EditorHover | null>;
  dismissHover(): void;
  requestCodeActions(): Promise<readonly EditorCodeAction[]>;
  applyCodeAction(action: EditorCodeAction): Promise<boolean>;
  formatDocument(): Promise<boolean>;
  saveDocument(targetPath?: string): Promise<boolean>;
}

export interface CreateEditorControllerOptions {
  state?: EditorState;
  value?: string;
  selection?: SelectionSet;
  mode?: EditorState["mode"];
  language?: string;
  theme?: string;
  filePath?: string;
  history?: HistoryPlugin | false;
}

function createHistoryEntry(state: EditorState): HistoryEntry {
  return {
    doc: state.doc,
    selection: state.selection,
    mode: state.mode,
    insertSession: state.insertSession,
    yankBuffer: state.yankBuffer,
    lastDeletedFrom: state.lastDeletedFrom
  };
}

function selectionEquals(left: SelectionSet, right: SelectionSet): boolean {
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

function jumpEntryEquals(left: EditorJumpEntry, right: EditorJumpEntry): boolean {
  return left.mode === right.mode && selectionEquals(left.selection, right.selection);
}

function createJumpEntry(state: EditorState): EditorJumpEntry {
  return {
    selection: state.selection,
    mode: state.mode
  };
}

function normalizeRegisterName(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }

  return name.toLowerCase();
}

function normalizeLanguageServices(
  input: EditorLanguageServiceInput | readonly EditorLanguageServices[] | null | undefined
): EditorLanguageServices[] {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? [...input] : [input];
}

function transactionRequiresFullDocumentLanguageSync(transaction: Transaction): boolean {
  if ((transaction.changes?.length ?? 0) > 0) {
    return false;
  }

  return (transaction.effects ?? []).some((effect) => {
    return effect.type === "controller.replace-state" || effect.type.startsWith("history.");
  });
}

function createPresentationState(state: EditorState, options: CreateEditorControllerOptions): EditorPresentationState {
  return {
    filePath: options.filePath ?? "untitled.ts",
    themeName: options.theme ?? null,
    viewport: {
      topVisualRow: 0,
      visibleRowCapacity: 1,
      scrolloffRows: 3,
      wrapColumns: Number.MAX_SAFE_INTEGER,
      softWrap: false,
      visualRows: [],
      visibleVisualRows: [],
      lineVisualRanges: [],
      wrapRevision: -1
    },
    language: {
      services: [],
      host: null,
      languageRevision: -1,
      lastHighlightedRevision: -1,
      highlightRequestId: 0,
      diagnosticsRequestId: 0,
      lineChangesRequestId: 0,
      hoverRequestId: 0,
      highlightCache: new Map(),
      highlightCoverage: new Set(),
      diagnostics: [],
      diagnosticsByLine: new Map(),
      lineChangesByLine: new Map(),
      visibleHighlights: [],
      visibleHighlightsByLine: new Map(),
      visibleDiagnostics: [],
      visibleLineChanges: []
    },
    ui: {
      commandLine: { active: false, value: "", prompt: ":" },
      commandCompletionIndex: 0,
      picker: {
        active: false,
        loading: false,
        title: "",
        items: [],
        selectedIndex: 0,
        error: null
      },
      bottomMessage: null,
      hover: {
        active: false,
        pinned: false,
        offset: null,
        content: "",
        tone: "info",
        left: 16,
        top: 16
      },
      flash: {
        active: false,
        target: "",
        input: "",
        hints: []
      },
      pendingAction: null,
      pendingCount: "",
      stickyViewMode: false,
      previewTheme: null,
      lastRepeatableMotion: null
    },
    search: {
      query: "",
      direction: "forward",
      lastMatch: null,
      matches: [],
      visibleMatchesByLine: new Map()
    },
    jumps: {
      items: [],
      cursor: 0
    },
    registers: {
      unnamed: state.yankBuffer,
      search: null,
      named: {},
      selected: null
    }
  };
}

function normalizeHistoryRestoreEntry(entry: HistoryEntry): HistoryEntry {
  if (entry.mode !== "insert") {
    return entry;
  }

  const cursor = clampInsertionOffset(entry.doc, getCursorOffset(entry.selection));
  const position = entry.doc.positionAt(cursor);
  const previousCharacter = cursor > 0 ? entry.doc.text[cursor - 1] : undefined;
  const nextCursor =
    entry.doc.length === 0
      ? 0
      : clampCharacterOffset(entry.doc, cursor > 0 && position.column > 0 && previousCharacter !== "\n" ? cursor - 1 : cursor);

  return {
    ...entry,
    mode: "normal",
    selection: createCharacterSelection(entry.doc, nextCursor),
    insertSession: null
  };
}

function restoreEditorState(state: EditorState, entry: HistoryEntry): EditorState {
  const normalized = normalizeHistoryRestoreEntry(entry);

  return {
    ...state,
    doc: normalized.doc,
    selection: normalizeSelection(normalized.doc, normalized.selection, normalized.mode),
    mode: normalized.mode,
    yankBuffer: normalized.yankBuffer,
    lastDeletedFrom: normalized.lastDeletedFrom,
    insertSession: normalized.mode === "insert" ? normalized.insertSession : null,
    revision: state.revision + 1
  };
}

function buildHighlightCache(doc: EditorState["doc"], spans: readonly HighlightSpan[]): Map<number, HighlightSpan[]> {
  const cache = new Map<number, HighlightSpan[]>();

  for (const span of spans) {
    if (span.to <= span.from) {
      continue;
    }

    const startLine = doc.positionAt(span.from).line;
    const endLine = doc.positionAt(span.to - 1).line;

    for (let line = startLine; line <= endLine; line += 1) {
      const lineInfo = doc.lineAt(line);
      const from = Math.max(span.from, lineInfo.start);
      const to = Math.min(span.to, lineInfo.end);

      if (to <= from) {
        continue;
      }

      const entry = cache.get(line);
      const clipped = { from, to, role: span.role };

      if (entry) {
        entry.push(clipped);
      } else {
        cache.set(line, [clipped]);
      }
    }
  }

  return cache;
}

function spansEqual(left: readonly HighlightSpan[], right: readonly HighlightSpan[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((span, index) => {
    const other = right[index];
    return !!other && span.from === other.from && span.to === other.to && span.role === other.role;
  });
}

function highlightMapsEqual(
  left: ReadonlyMap<number, readonly HighlightSpan[]>,
  right: ReadonlyMap<number, readonly HighlightSpan[]>
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [line, spans] of left) {
    const other = right.get(line);
    if (!other || !spansEqual(spans, other)) {
      return false;
    }
  }

  return true;
}

function buildDiagnosticsCache(doc: EditorState["doc"], diagnostics: readonly EditorDiagnostic[]): Map<number, EditorDiagnostic[]> {
  const nextByLine = new Map<number, EditorDiagnostic[]>();

  for (const diagnostic of diagnostics) {
    const safeFrom = Math.max(0, Math.min(doc.length, diagnostic.from));
    const safeTo = Math.max(safeFrom, Math.min(doc.length, Math.max(diagnostic.from + 1, diagnostic.to)));
    const startLine = doc.positionAt(safeFrom).line;
    const endLine = doc.positionAt(Math.max(safeFrom, safeTo - 1)).line;

    for (let line = startLine; line <= endLine; line += 1) {
      const entry = nextByLine.get(line);

      if (entry) {
        entry.push({ ...diagnostic, from: safeFrom, to: safeTo });
      } else {
        nextByLine.set(line, [{ ...diagnostic, from: safeFrom, to: safeTo }]);
      }
    }
  }

  return nextByLine;
}

function buildLineChangesMap(changes: readonly EditorLineChange[]): Map<number, EditorLineChangeState> {
  const next = new Map<number, EditorLineChangeState>();

  for (const change of changes) {
    if (change.line < 0 || !Number.isFinite(change.line)) {
      continue;
    }

    if (change.kind === "deleted") {
      const previous = next.get(change.line) ?? { kind: null, deleted: false };
      next.set(change.line, { ...previous, deleted: true });
      continue;
    }

    const previous = next.get(change.line) ?? { kind: null, deleted: false };
    next.set(change.line, {
      kind: change.kind === "modified" || previous.kind === "modified" ? "modified" : change.kind,
      deleted: previous.deleted
    });
  }

  return next;
}

function compileSearchPattern(query: string): RegExp | null {
  if (!query) {
    return null;
  }

  try {
    return new RegExp(query, "gu");
  } catch {
    return null;
  }
}

function collectSearchMatches(text: string, query: string): Array<{ from: number; to: number }> {
  const pattern = compileSearchPattern(query);

  if (!pattern) {
    return [];
  }

  const matches: Array<{ from: number; to: number }> = [];
  let result = pattern.exec(text);

  while (result) {
    const matchedText = result[0] ?? "";
    const from = result.index;
    const to = from + Math.max(1, matchedText.length);
    matches.push({ from, to });

    if (matchedText.length === 0) {
      pattern.lastIndex = from + 1;
    }

    result = pattern.exec(text);
  }

  return matches;
}

function searchMatchesEqual(
  left: readonly { from: number; to: number }[],
  right: readonly { from: number; to: number }[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    return !!other && entry.from === other.from && entry.to === other.to;
  });
}

function searchMatchesByLineEqual(
  left: ReadonlyMap<number, readonly { from: number; to: number }[]>,
  right: ReadonlyMap<number, readonly { from: number; to: number }[]>
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [line, matches] of left) {
    const other = right.get(line);
    if (!other || !searchMatchesEqual(matches, other)) {
      return false;
    }
  }

  return true;
}

function diagnosticsEqual(left: readonly EditorDiagnostic[], right: readonly EditorDiagnostic[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((diagnostic, index) => {
    const other = right[index];
    return (
      !!other &&
      diagnostic.from === other.from &&
      diagnostic.to === other.to &&
      diagnostic.severity === other.severity &&
      diagnostic.message === other.message &&
      diagnostic.source === other.source
    );
  });
}

function lineChangesEqual(left: readonly EditorLineChange[], right: readonly EditorLineChange[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((change, index) => {
    const other = right[index];
    return !!other && change.line === other.line && change.kind === other.kind;
  });
}

function remapHighlightSpans(
  doc: EditorState["doc"],
  spans: readonly HighlightSpan[],
  changes: readonly TextChange[]
): HighlightSpan[] {
  const next: HighlightSpan[] = [];

  for (const span of spans) {
    const originalLength = Math.max(0, span.to - span.from);
    const hasOverlappingChange = changes.some((change) => change.from < span.to && change.to > span.from);
    const startAffinity = changes.some(
      (change) => change.from === span.from && change.to === span.from && change.insert.length > 0
    )
      ? "right"
      : "left";
    const from = Math.max(0, Math.min(doc.length, mapOffsetThroughChanges(span.from, changes, startAffinity)));
    const mappedTo = Math.max(from, Math.min(doc.length, mapOffsetThroughChanges(span.to, changes, "right")));
    const to = hasOverlappingChange
      ? mappedTo
      : Math.max(from, Math.min(doc.length, from + originalLength));

    if (to <= from) {
      continue;
    }

    next.push({
      from,
      to,
      role: span.role
    });
  }

  return next;
}

export function createSnapshotHistory(): HistoryPlugin {
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let pendingInsertGroup: HistoryEntry | null = null;

  const flushPendingInsertGroup = (): boolean => {
    if (!pendingInsertGroup) {
      return false;
    }

    undoStack.push(pendingInsertGroup);
    pendingInsertGroup = null;
    return true;
  };

  return {
    record(update, options = {}) {
      if (options.checkpoint) {
        flushPendingInsertGroup();
      }

      if (!update.docChanged) {
        return;
      }

      if (update.nextState.mode === "insert") {
        pendingInsertGroup ??= createHistoryEntry(update.prevState);
        redoStack.length = 0;
        return;
      }

      flushPendingInsertGroup();
      undoStack.push(createHistoryEntry(update.prevState));
      redoStack.length = 0;
    },
    undo(currentState) {
      flushPendingInsertGroup();
      const previous = undoStack.pop() ?? null;

      if (!previous) {
        return null;
      }

      redoStack.push(createHistoryEntry(currentState));
      return previous;
    },
    redo(currentState) {
      flushPendingInsertGroup();
      const next = redoStack.pop() ?? null;

      if (!next) {
        return null;
      }

      undoStack.push(createHistoryEntry(currentState));
      return next;
    },
    checkpoint() {
      return flushPendingInsertGroup();
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      pendingInsertGroup = null;
    }
  };
}

export function createEditorController(options: CreateEditorControllerOptions = {}): EditorController {
  let state =
    options.state ??
    createEditorState({
      value: options.value,
      selection: options.selection,
      mode: options.mode,
      language: options.language,
      theme: options.theme
    });
  const presentation = createPresentationState(state, options);
  const listeners = new Set<EditorUpdateListener>();
  const history = options.history === false ? null : options.history ?? createSnapshotHistory();
  const searchState = presentation.search;
  const jumpList = presentation.jumps.items as EditorJumpEntry[];
  let jumpCursor = presentation.jumps.cursor;
  const registers = presentation.registers;
  let searchMatchCache = [...presentation.search.matches];
  let viewportModelRevision = -1;
  let viewportModelWrapColumns = presentation.viewport.wrapColumns;
  let viewportModelSoftWrap = presentation.viewport.softWrap;
  let inFlightVisibleHighlightRequestKey: string | null = null;
  let inFlightVisibleHighlightRequest: Promise<void> | null = null;
  let pendingDeferredPresentationUpdate = false;
  let deferredPresentationEffectType = "presentation.update";

  const refreshSearchMatchCache = (targetState: EditorState = state) => {
    searchMatchCache = collectSearchMatches(targetState.doc.text, presentation.search.query);
    presentation.search.matches = searchMatchCache;
  };

  const syncVisibleViewportRows = (): boolean => {
    const visualRows = presentation.viewport.visualRows;

    if (visualRows.length === 0) {
      const changed = presentation.viewport.visibleVisualRows.length > 0;
      presentation.viewport.visibleVisualRows = [];
      return changed;
    }

    const fromRowIndex = Math.max(0, Math.min(visualRows.length - 1, presentation.viewport.topVisualRow));
    const toRowIndex = Math.max(
      fromRowIndex,
      Math.min(visualRows.length - 1, fromRowIndex + presentation.viewport.visibleRowCapacity - 1)
    );
    const nextVisibleRows = visualRows.slice(fromRowIndex, toRowIndex + 1);
    const changed =
      nextVisibleRows.length !== presentation.viewport.visibleVisualRows.length ||
      nextVisibleRows.some((row, index) => presentation.viewport.visibleVisualRows[index] !== row);

    presentation.viewport.visibleVisualRows = nextVisibleRows;
    return changed;
  };

  const notify = (
    prevState: EditorState,
    nextState: EditorState,
    transaction: Transaction,
    options: { recordHistory?: boolean } = {}
  ) => {
    const update: EditorUpdate = {
      prevState,
      nextState,
      transaction,
      docChanged: prevState.doc.text !== nextState.doc.text,
      selectionChanged: !selectionEquals(prevState.selection, nextState.selection),
      modeChanged: prevState.mode !== nextState.mode
    };

    const shouldCheckpointHistory = prevState.mode === "insert" && nextState.mode !== "insert";

    if (options.recordHistory !== false && (update.docChanged || shouldCheckpointHistory)) {
      history?.record(update, { checkpoint: shouldCheckpointHistory });
    }

    if (update.docChanged) {
      presentation.language.lastHighlightedRevision = -1;
      const changes = transaction.changes ?? [];
      refreshSearchMatchCache(nextState);

      if (changes.length > 0) {
        presentation.language.visibleHighlights = remapHighlightSpans(
          nextState.doc,
          presentation.language.visibleHighlights,
          changes
        );
        remapHighlightCacheForChanges(prevState, nextState, changes);
        remapHighlightCoverageForChanges(prevState, nextState, changes);
        remapDiagnosticsForChanges(prevState, nextState, changes);
        const changedViewport = getChangedHighlightViewport(prevState, nextState, changes);
        if (changedViewport) {
          invalidateHighlightViewport(changedViewport);
        }
      } else {
        presentation.language.highlightCoverage.clear();
        presentation.language.visibleHighlights = [];
        presentation.language.visibleHighlightsByLine = new Map();
        presentation.language.visibleDiagnostics = [];
        presentation.language.visibleLineChanges = [];
      }
    }

    if (update.nextState.yankBuffer !== update.prevState.yankBuffer) {
      registers.unnamed = update.nextState.yankBuffer;
      const selected = normalizeRegisterName(registers.selected);

      if (selected && selected !== "/") {
        if (registers.unnamed === null) {
          delete registers.named[selected];
        } else {
          registers.named[selected] = registers.unnamed;
        }
      }
    }

    let viewportChanged = false;

    if (update.selectionChanged || update.modeChanged || update.docChanged) {
      rebuildViewportModel();
      const didReveal = revealSelectionWithinViewport();
      viewportChanged = syncVisibleViewportRows() || didReveal;
      syncVisibleLanguageDecorations();
    }

    if (viewportChanged) {
      ensureVisibleHighlightCoverage();
    }

    if (update.docChanged) {
      void syncLanguage({
        changes: transaction.changes ?? [],
        forceDocumentSync: transactionRequiresFullDocumentLanguageSync(transaction),
        refreshHighlights: true,
        refreshDiagnostics: true,
        refreshLineChanges: true
      });
    }

    for (const listener of listeners) {
      listener(update);
    }
  };

  const dispatch = (transaction: Transaction) => {
    const prevState = state;
    state = applyTransaction(state, transaction);
    notify(prevState, state, transaction);
  };

  const applyHistoryEntry = (entry: HistoryEntry | null, effectType: string) => {
    if (!entry) {
      return false;
    }

    const prevState = state;
    state = restoreEditorState(state, entry);
    notify(prevState, state, {
      effects: [{ type: effectType }]
    }, { recordHistory: false });
    return true;
  };

  const historyControls: NonNullable<CommandContext["history"]> = {
    undo: () => applyHistoryEntry(history?.undo(state) ?? null, "history.undo"),
    redo: () => applyHistoryEntry(history?.redo(state) ?? null, "history.redo"),
    checkpoint: () => history?.checkpoint() ?? false
  };

  const emitPresentationUpdate = (effectType = "presentation.update") => {
    notify(state, state, { effects: [{ type: effectType }] }, { recordHistory: false });
  };

  const schedulePresentationUpdate = (effectType = "presentation.update") => {
    deferredPresentationEffectType = effectType;

    if (pendingDeferredPresentationUpdate) {
      return;
    }

    pendingDeferredPresentationUpdate = true;
    queueMicrotask(() => {
      pendingDeferredPresentationUpdate = false;
      const nextEffectType = deferredPresentationEffectType;
      deferredPresentationEffectType = "presentation.update";
      emitPresentationUpdate(nextEffectType);
    });
  };

  const rebuildViewportModel = () => {
    if (
      viewportModelRevision === state.revision &&
      viewportModelWrapColumns === presentation.viewport.wrapColumns &&
      viewportModelSoftWrap === presentation.viewport.softWrap &&
      presentation.viewport.visualRows.length > 0
    ) {
      return;
    }

    const nextInput = {
      state,
      filePath: presentation.filePath,
      searchState: presentation.search,
      highlights: [] as HighlightSpan[],
      diagnostics: [] as EditorDiagnostic[],
      lineChanges: [] as EditorLineChange[],
      commandLine: presentation.ui.commandLine,
      bottomMessage: presentation.ui.bottomMessage,
      picker: presentation.ui.picker,
      hover: presentation.ui.hover,
      flash: presentation.ui.flash,
      pendingAction:
        presentation.ui.pendingAction?.kind === "g" ||
        presentation.ui.pendingAction?.kind === "[" ||
        presentation.ui.pendingAction?.kind === "]" ||
        presentation.ui.pendingAction?.kind === "m" ||
        presentation.ui.pendingAction?.kind === "space" ||
        presentation.ui.pendingAction?.kind === "flash-target" ||
        presentation.ui.pendingAction?.kind === "z"
          ? presentation.ui.pendingAction
          : null,
      pendingCount: presentation.ui.pendingCount,
      viewport: {
        cols: Math.max(1, presentation.viewport.wrapColumns),
        rows: Math.max(1, presentation.viewport.visibleRowCapacity),
        topVisualRow: presentation.viewport.topVisualRow
      },
      softWrap: presentation.viewport.softWrap,
      indentGuides: {
        render: false,
        character: "│",
        skipLevels: 0,
        indentWidth: 2
      }
    };
    const { visualRows, lineVisualRanges } = buildVisualRows(nextInput);
    presentation.viewport.visualRows = visualRows;
    presentation.viewport.lineVisualRanges = lineVisualRanges;
    presentation.viewport.wrapRevision = state.revision;
    viewportModelRevision = state.revision;
    viewportModelWrapColumns = presentation.viewport.wrapColumns;
    viewportModelSoftWrap = presentation.viewport.softWrap;
    const maxTop = Math.max(0, visualRows.length - presentation.viewport.visibleRowCapacity);
    presentation.viewport.topVisualRow = Math.max(0, Math.min(maxTop, presentation.viewport.topVisualRow));
    syncVisibleViewportRows();
  };

  const getVisibleLineViewport = (): EditorLineRange => {
    rebuildViewportModel();
    const visualRows = presentation.viewport.visibleVisualRows;

    if (visualRows.length === 0) {
      return { fromLine: 0, toLine: Math.max(0, state.doc.lineCount - 1) };
    }
    const fromRow = visualRows[0];
    const toRow = visualRows[visualRows.length - 1];

    return {
      fromLine: fromRow?.docLine ?? 0,
      toLine: toRow?.docLine ?? Math.max(0, state.doc.lineCount - 1)
    };
  };

  const getVisibleHighlightViewport = (): EditorLineRange => {
    const viewport = getVisibleLineViewport();
    const contextLines = Math.max(4, presentation.viewport.visibleRowCapacity);

    return {
      fromLine: Math.max(0, viewport.fromLine - contextLines),
      toLine: Math.min(state.doc.lineCount - 1, viewport.toLine + contextLines)
    };
  };

  const syncVisibleLanguageDecorations = (): boolean => {
    const viewport = getVisibleLineViewport();
    const visibleHighlights: HighlightSpan[] = [];
    const visibleHighlightsByLine = new Map<number, HighlightSpan[]>();
    const visibleDiagnostics: EditorDiagnostic[] = [];
    const visibleLineChanges: EditorLineChange[] = [];
    const visibleSearchMatchesByLine = new Map<number, { from: number; to: number }[]>();

    for (let lineIndex = viewport.fromLine; lineIndex <= viewport.toLine; lineIndex += 1) {
      const highlights = presentation.language.highlightCache.get(lineIndex);
      if (highlights && highlights.length > 0) {
        visibleHighlights.push(...highlights);
        visibleHighlightsByLine.set(lineIndex, highlights);
      }

      const lineDiagnostics = presentation.language.diagnosticsByLine.get(lineIndex);
      if (lineDiagnostics && lineDiagnostics.length > 0) {
        for (const diagnostic of lineDiagnostics) {
          if (
            visibleDiagnostics.length === 0 ||
            visibleDiagnostics[visibleDiagnostics.length - 1] !== diagnostic
          ) {
            visibleDiagnostics.push(diagnostic);
          }
        }
      }

      const lineChange = presentation.language.lineChangesByLine.get(lineIndex);
      if (!lineChange) {
        const line = state.doc.lineAt(lineIndex);
        const lineEnd = line.start + line.text.length;
        const lineSearchMatches = searchMatchCache.filter((entry) => entry.from < lineEnd && entry.to > line.start);
        if (lineSearchMatches.length > 0) {
          visibleSearchMatchesByLine.set(lineIndex, lineSearchMatches);
        }
        continue;
      }

      if (lineChange.kind) {
        visibleLineChanges.push({ line: lineIndex, kind: lineChange.kind });
      }

      if (lineChange.deleted) {
        visibleLineChanges.push({ line: lineIndex, kind: "deleted" });
      }

      const line = state.doc.lineAt(lineIndex);
      const lineEnd = line.start + line.text.length;
      const lineSearchMatches = searchMatchCache.filter((entry) => entry.from < lineEnd && entry.to > line.start);
      if (lineSearchMatches.length > 0) {
        visibleSearchMatchesByLine.set(lineIndex, lineSearchMatches);
      }
    }

    const highlightsChanged = !spansEqual(presentation.language.visibleHighlights, visibleHighlights);
    const highlightsByLineChanged = !highlightMapsEqual(
      presentation.language.visibleHighlightsByLine,
      visibleHighlightsByLine
    );
    const diagnosticsChanged = !diagnosticsEqual(presentation.language.visibleDiagnostics, visibleDiagnostics);
    const lineChangesChanged = !lineChangesEqual(presentation.language.visibleLineChanges, visibleLineChanges);
    const searchChanged = !searchMatchesByLineEqual(presentation.search.visibleMatchesByLine, visibleSearchMatchesByLine);

    presentation.language.visibleHighlights = visibleHighlights;
    presentation.language.visibleHighlightsByLine = visibleHighlightsByLine;
    presentation.language.visibleDiagnostics = visibleDiagnostics;
    presentation.language.visibleLineChanges = visibleLineChanges;
    presentation.search.visibleMatchesByLine = visibleSearchMatchesByLine;

    return highlightsChanged || highlightsByLineChanged || diagnosticsChanged || lineChangesChanged || searchChanged;
  };

  const getSnapshot = () => ({
    revision: state.revision,
    doc: state.doc
  });

  const getHighlighter = () => presentation.language.services.find((services) => services.highlighter)?.highlighter;
  const getHoverSource = () => presentation.language.services.find((services) => services.hover)?.hover;
  const getDiagnosticsSource = () => presentation.language.services.find((services) => services.diagnostics)?.diagnostics;
  const getCodeActionSource = () => presentation.language.services.find((services) => services.codeActions)?.codeActions;
  const getFormatter = () => presentation.language.services.find((services) => services.formatter)?.formatter;

  const getActiveOffset = () => (state.mode === "insert" ? getCursorOffset(state.selection) : getActiveCharacterOffset(state));

  const hasMissingHighlightCoverage = (viewport: EditorLineRange): boolean => {
    for (let lineIndex = viewport.fromLine; lineIndex <= viewport.toLine; lineIndex += 1) {
      if (!presentation.language.highlightCoverage.has(lineIndex)) {
        return true;
      }
    }

    return false;
  };

  const getChangedHighlightViewport = (
    previousState: EditorState,
    nextState: EditorState,
    changes: readonly TextChange[]
  ): EditorLineRange | null => {
    if (changes.length === 0) {
      return null;
    }

    let fromLine = Number.POSITIVE_INFINITY;
    let toLine = 0;

    for (const change of changes) {
      const nextStartLine = nextState.doc.positionAt(change.from).line;
      const nextEndOffset = change.insert.length > 0 ? change.from + change.insert.length - 1 : change.from;
      const nextEndLine = nextState.doc.positionAt(Math.min(nextEndOffset, nextState.doc.length)).line;
      fromLine = Math.min(fromLine, nextStartLine);
      toLine = Math.max(toLine, nextEndLine);
    }

    if (!Number.isFinite(fromLine)) {
      return null;
    }

    return {
      fromLine: Math.max(0, fromLine - 2),
      toLine: Math.min(nextState.doc.lineCount - 1, toLine + 2)
    };
  };

  const replaceHighlightCache = (spans: HighlightSpan[], viewport: EditorLineRange): boolean => {
    const nextCache = buildHighlightCache(state.doc, spans);
    let hasVisibleDirty = false;

    for (let index = viewport.fromLine; index <= viewport.toLine; index += 1) {
      presentation.language.highlightCoverage.add(index);
      const previous = presentation.language.highlightCache.get(index) ?? [];
      const next = nextCache.get(index) ?? [];

      if (!spansEqual(previous, next)) {
        hasVisibleDirty = true;
      }

      if (next.length > 0) {
        presentation.language.highlightCache.set(index, next);
      } else {
        presentation.language.highlightCache.delete(index);
      }
    }

    return hasVisibleDirty;
  };

  const remapHighlightCacheForChanges = (previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]) => {
    if (changes.length === 0) {
      return;
    }

    const nextCache = new Map<number, HighlightSpan[]>();

    for (const spans of presentation.language.highlightCache.values()) {
      for (const span of spans) {
        const originalLength = Math.max(0, span.to - span.from);
        const hasOverlappingChange = changes.some((change) => change.from < span.to && change.to > span.from);
        const startAffinity = changes.some(
          (change) => change.from === span.from && change.to === span.from && change.insert.length > 0
        )
          ? "right"
          : "left";
        const mappedFrom = Math.max(
          0,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(span.from, changes, startAffinity))
        );
        const nextTo = Math.max(
          mappedFrom,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(span.to, changes, "right"))
        );
        const mappedTo = hasOverlappingChange
          ? nextTo
          : Math.max(mappedFrom, Math.min(nextState.doc.length, mappedFrom + originalLength));

        if (mappedTo <= mappedFrom) {
          continue;
        }

        const startLine = nextState.doc.positionAt(mappedFrom).line;
        const endLine = nextState.doc.positionAt(Math.max(mappedFrom, mappedTo - 1)).line;

        for (let line = startLine; line <= endLine; line += 1) {
          const lineInfo = nextState.doc.lineAt(line);
          const from = Math.max(mappedFrom, lineInfo.start);
          const to = Math.min(mappedTo, lineInfo.end);

          if (to <= from) {
            continue;
          }

          const entry = nextCache.get(line);
          const clipped = { from, to, role: span.role };

          if (entry) {
            entry.push(clipped);
          } else {
            nextCache.set(line, [clipped]);
          }
        }
      }
    }

    presentation.language.highlightCache = nextCache;
    syncVisibleLanguageDecorations();
  };

  const remapHighlightCoverageForChanges = (previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]) => {
    if (changes.length === 0) {
      return;
    }

    const nextCoverage = new Set<number>();

    for (const lineIndex of presentation.language.highlightCoverage) {
      const previousLine = previousState.doc.lineAt(lineIndex);
      const mappedOffset = Math.max(
        0,
        Math.min(nextState.doc.length, mapOffsetThroughChanges(previousLine.start, changes, "left"))
      );
      nextCoverage.add(nextState.doc.positionAt(mappedOffset).line);
    }

    presentation.language.highlightCoverage = nextCoverage;
  };

  const remapDiagnosticsForChanges = (previousState: EditorState, nextState: EditorState, changes: readonly TextChange[]) => {
    if (changes.length === 0 || presentation.language.diagnostics.length === 0) {
      return;
    }

    presentation.language.diagnostics = presentation.language.diagnostics
      .map((diagnostic) => {
        const from = Math.max(
          0,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(diagnostic.from, changes, "left"))
        );
        const to = Math.max(
          from,
          Math.min(nextState.doc.length, mapOffsetThroughChanges(Math.max(diagnostic.from + 1, diagnostic.to), changes, "right"))
        );

        if (to <= from) {
          return null;
        }

        return {
          ...diagnostic,
          from,
          to
        };
      })
      .filter((diagnostic): diagnostic is EditorDiagnostic => diagnostic !== null);

    presentation.language.diagnosticsByLine = buildDiagnosticsCache(state.doc, presentation.language.diagnostics);
    syncVisibleLanguageDecorations();
  };

  const invalidateHighlightViewport = (viewport: EditorLineRange) => {
    for (let index = viewport.fromLine; index <= viewport.toLine; index += 1) {
      presentation.language.highlightCoverage.delete(index);
    }
  };

  const refreshHighlights = async (viewport: EditorLineRange, force = false): Promise<void> => {
    const highlighter = getHighlighter();

    if (!highlighter || presentation.language.languageRevision < 0) {
      if (presentation.language.highlightCache.size > 0) {
        presentation.language.highlightCache.clear();
        presentation.language.highlightCoverage.clear();
        presentation.language.visibleHighlightsByLine.clear();
        syncVisibleLanguageDecorations();
        emitPresentationUpdate("language.highlights.clear");
      }
      return;
    }

    if (presentation.language.languageRevision !== state.revision) {
      return;
    }

    const needsViewportHighlights =
      force ||
      presentation.language.lastHighlightedRevision !== presentation.language.languageRevision ||
      hasMissingHighlightCoverage(viewport);

    if (!needsViewportHighlights) {
      return;
    }

    const requestId = ++presentation.language.highlightRequestId;
    const next = await highlighter.getHighlights(viewport, presentation.language.languageRevision);

    if (requestId !== presentation.language.highlightRequestId) {
      return;
    }

    const changed = replaceHighlightCache(next, viewport);
    presentation.language.lastHighlightedRevision = presentation.language.languageRevision;
    const visibleChanged = syncVisibleLanguageDecorations();

    if (changed || visibleChanged) {
      emitPresentationUpdate("language.highlights");
    }
  };

  const ensureVisibleHighlightCoverage = (force = false): Promise<void> => {
    const highlighter = getHighlighter();

    if (!highlighter || presentation.language.languageRevision < 0) {
      return Promise.resolve();
    }

    if (presentation.language.languageRevision !== state.revision) {
      return Promise.resolve();
    }

    const viewport = getVisibleHighlightViewport();
    const needsViewportHighlights =
      force ||
      presentation.language.lastHighlightedRevision !== presentation.language.languageRevision ||
      hasMissingHighlightCoverage(viewport);

    if (!needsViewportHighlights) {
      return Promise.resolve();
    }

    const requestKey = `${presentation.language.languageRevision}:${viewport.fromLine}:${viewport.toLine}:${force ? 1 : 0}`;

    if (inFlightVisibleHighlightRequestKey === requestKey) {
      return inFlightVisibleHighlightRequest ?? Promise.resolve();
    }

    inFlightVisibleHighlightRequestKey = requestKey;
    inFlightVisibleHighlightRequest = refreshHighlights(viewport, force).finally(() => {
      if (inFlightVisibleHighlightRequestKey === requestKey) {
        inFlightVisibleHighlightRequestKey = null;
        inFlightVisibleHighlightRequest = null;
      }
    });
    return inFlightVisibleHighlightRequest;
  };

  const refreshDiagnostics = async (): Promise<void> => {
    const diagnosticsSource = getDiagnosticsSource();
    const requestId = ++presentation.language.diagnosticsRequestId;

    if (!diagnosticsSource) {
      if (presentation.language.diagnostics.length > 0 || presentation.language.diagnosticsByLine.size > 0) {
        presentation.language.diagnostics = [];
        presentation.language.diagnosticsByLine.clear();
        syncVisibleLanguageDecorations();
        emitPresentationUpdate("language.diagnostics.clear");
      }
      return;
    }

    try {
      const nextDiagnostics = await diagnosticsSource.diagnostics(getSnapshot());

      if (requestId !== presentation.language.diagnosticsRequestId) {
        return;
      }

      presentation.language.diagnostics = nextDiagnostics;
      presentation.language.diagnosticsByLine = buildDiagnosticsCache(state.doc, nextDiagnostics);
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("language.diagnostics");
    } catch {
      if (requestId !== presentation.language.diagnosticsRequestId) {
        return;
      }

      presentation.language.diagnostics = [];
      presentation.language.diagnosticsByLine = new Map();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("language.diagnostics.error");
    }
  };

  const refreshLineChanges = async (): Promise<void> => {
    const getLineChanges = presentation.language.host?.getLineChanges;
    const requestId = ++presentation.language.lineChangesRequestId;

    if (!getLineChanges) {
      if (presentation.language.lineChangesByLine.size > 0) {
        presentation.language.lineChangesByLine.clear();
        syncVisibleLanguageDecorations();
        emitPresentationUpdate("language.line-changes.clear");
      }
      return;
    }

    try {
      const changes = await getLineChanges({
        filePath: presentation.filePath,
        text: state.doc.text
      });

      if (requestId !== presentation.language.lineChangesRequestId) {
        return;
      }

      presentation.language.lineChangesByLine = buildLineChangesMap(changes);
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("language.line-changes");
    } catch {
      if (requestId !== presentation.language.lineChangesRequestId) {
        return;
      }

      presentation.language.lineChangesByLine = new Map();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("language.line-changes.error");
    }
  };

  const syncLanguage = async (options: {
    changes?: readonly TextChange[];
    forceDocumentSync?: boolean;
    highlightViewport?: EditorLineRange;
    refreshHighlights?: boolean;
    refreshDiagnostics?: boolean;
    refreshLineChanges?: boolean;
  } = {}): Promise<void> => {
    const changes = options.changes ?? [];
    const forceDocumentSync = options.forceDocumentSync ?? false;
    const shouldRefreshHighlights = options.refreshHighlights ?? true;
    const shouldRefreshDiagnostics = options.refreshDiagnostics ?? true;
    const shouldRefreshLineChanges = options.refreshLineChanges ?? true;
    const highlightViewport = options.highlightViewport ?? getVisibleHighlightViewport();

    if (changes.length > 0) {
      invalidateHighlightViewport(highlightViewport);
    }

    const highlighter = getHighlighter();

    if (highlighter && shouldRefreshHighlights) {
      if (forceDocumentSync || presentation.language.languageRevision < 0) {
        await highlighter.open(getSnapshot());
        presentation.language.languageRevision = state.revision;
        presentation.language.lastHighlightedRevision = -1;
        await refreshHighlights(highlightViewport, true);
      } else if (changes.length > 0) {
        await highlighter.update(getSnapshot(), changes);
        presentation.language.languageRevision = state.revision;
        presentation.language.lastHighlightedRevision = -1;
        await refreshHighlights(highlightViewport, true);
      } else if (presentation.language.languageRevision === state.revision) {
        await refreshHighlights(highlightViewport, false);
      }

      await ensureVisibleHighlightCoverage(false);
    }

    if (shouldRefreshDiagnostics) {
      void refreshDiagnostics();
    }

    if (shouldRefreshLineChanges) {
      void refreshLineChanges();
    }
  };

  const getCodeActionContext = () => {
    const selection = getSelectionOffsets(state);
    const overlappingDiagnostics = presentation.language.diagnostics.filter(
      (entry) => entry.from < selection.to && entry.to > selection.from
    );
    const activeLine = state.doc.positionAt(getActiveOffset()).line;
    const fallbackDiagnostics =
      overlappingDiagnostics.length > 0
        ? overlappingDiagnostics
        : presentation.language.diagnosticsByLine.get(activeLine) ?? [];

    return {
      document: getSnapshot(),
      selection,
      diagnostics: fallbackDiagnostics
    };
  };

  const resolveCodeActionChanges = async (action: EditorCodeAction): Promise<readonly TextChange[] | null> => {
    if (action.changes && action.changes.length > 0) {
      return action.changes;
    }

    return (await action.apply?.(getCodeActionContext())) ?? null;
  };

  const revealSelectionWithinViewport = (): boolean => {
    rebuildViewportModel();
    const visual = getVisualRowForOffset(
      state,
      presentation.viewport.visualRows,
      presentation.viewport.lineVisualRanges,
      getActiveOffset(),
      presentation.viewport.softWrap,
      presentation.viewport.wrapColumns
    );
    const visibleCount = Math.max(1, presentation.viewport.visibleRowCapacity);
    const scrolloff = Math.max(0, Math.min(presentation.viewport.scrolloffRows, Math.floor((visibleCount - 1) / 2)));
    const maxTop = Math.max(0, presentation.viewport.visualRows.length - visibleCount);
    const minRow = presentation.viewport.topVisualRow + scrolloff;
    const maxRow = presentation.viewport.topVisualRow + visibleCount - 1 - scrolloff;
    const previousTop = presentation.viewport.topVisualRow;

    if (visual.rowIndex < minRow) {
      presentation.viewport.topVisualRow = Math.max(0, visual.rowIndex - scrolloff);
      return presentation.viewport.topVisualRow !== previousTop;
    }

    if (visual.rowIndex > maxRow) {
      presentation.viewport.topVisualRow = Math.min(maxTop, Math.max(0, visual.rowIndex + scrolloff - visibleCount + 1));
      return presentation.viewport.topVisualRow !== previousTop;
    }

    return false;
  };

  const trimJumpTail = () => {
    if (jumpCursor < jumpList.length) {
      jumpList.splice(jumpCursor);
    }
  };

  const pushJumpEntry = (entry: EditorJumpEntry): boolean => {
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
  };

  refreshSearchMatchCache();
  rebuildViewportModel();
  syncVisibleLanguageDecorations();

  return {
    getState() {
      return state;
    },
    getPresentationState() {
      return presentation;
    },
    dispatch,
    replaceState(nextState, transaction = { effects: [{ type: "controller.replace-state" }] }) {
      const prevState = state;
      state = {
        ...nextState,
        revision: prevState.revision + 1
      };
      history?.clear();
      refreshSearchMatchCache(state);
      presentation.language.languageRevision = -1;
      presentation.language.lastHighlightedRevision = -1;
      presentation.language.highlightRequestId = 0;
      inFlightVisibleHighlightRequestKey = null;
      inFlightVisibleHighlightRequest = null;
      presentation.language.diagnosticsRequestId = 0;
      presentation.language.lineChangesRequestId = 0;
      presentation.language.hoverRequestId = 0;
      presentation.language.highlightCache.clear();
      presentation.language.highlightCoverage.clear();
      presentation.language.visibleHighlightsByLine.clear();
      presentation.language.diagnostics = [];
      presentation.language.diagnosticsByLine.clear();
      presentation.language.lineChangesByLine.clear();
      rebuildViewportModel();
      syncVisibleLanguageDecorations();
      notify(prevState, state, transaction, { recordHistory: false });
    },
    execute(command, context = {}) {
      return command(state, dispatch, {
        ...context,
        history: historyControls
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSearchState() {
      return searchState;
    },
    setSearchState(next) {
      Object.assign(searchState, next);
      if (typeof next.query === "string") {
        registers.search = next.query;
      }
      refreshSearchMatchCache();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("search.update");
    },
    clearSearchState() {
      searchState.query = "";
      searchState.direction = "forward";
      searchState.lastMatch = null;
      refreshSearchMatchCache();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("search.clear");
    },
    pushJump() {
      const pushed = pushJumpEntry(createJumpEntry(state));
      presentation.jumps.cursor = jumpCursor;
      return pushed;
    },
    jumpBackward() {
      if (jumpList.length === 0) {
        return null;
      }

      if (jumpCursor === jumpList.length) {
        pushJumpEntry(createJumpEntry(state));
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
    },
    getRegister(name = null) {
      const normalized = normalizeRegisterName(name ?? registers.selected);
      if (!normalized || normalized === "\"") {
        return registers.unnamed;
      }
      if (normalized === "/") {
        return registers.search;
      }
      return registers.named[normalized] ?? null;
    },
    setRegister(name, value) {
      const normalized = normalizeRegisterName(name);
      if (!normalized || normalized === "\"") {
        registers.unnamed = value;
        return;
      }
      if (normalized === "/") {
        registers.search = value;
        return;
      }
      if (value === null) {
        delete registers.named[normalized];
      } else {
        registers.named[normalized] = value;
      }
    },
    selectRegister(name) {
      registers.selected = normalizeRegisterName(name);
      emitPresentationUpdate("register.select");
    },
    getSelectedRegister() {
      return registers.selected;
    },
    updatePresentationState(updater, effectType = "presentation.update", options = {}) {
      updater(presentation);
      if (options.defer) {
        schedulePresentationUpdate(effectType);
      } else {
        emitPresentationUpdate(effectType);
      }
    },
    setViewportMetrics(metrics) {
      presentation.viewport.visibleRowCapacity = Math.max(1, metrics.visibleRowCapacity);
      presentation.viewport.wrapColumns = Math.max(1, metrics.wrapColumns);
      presentation.viewport.softWrap = metrics.softWrap;
      viewportModelRevision = -1;
      rebuildViewportModel();
      const didReveal = revealSelectionWithinViewport();
      const viewportChanged = syncVisibleViewportRows() || didReveal;
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.metrics");
      if (viewportChanged) {
        ensureVisibleHighlightCoverage();
      }
    },
    scrollViewportBy(rowsDelta) {
      if (rowsDelta === 0) {
        return true;
      }

      rebuildViewportModel();
      const maxTop = Math.max(0, presentation.viewport.visualRows.length - presentation.viewport.visibleRowCapacity);
      presentation.viewport.topVisualRow = Math.max(0, Math.min(maxTop, presentation.viewport.topVisualRow + rowsDelta));
      const viewportChanged = syncVisibleViewportRows();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.scroll");
      if (viewportChanged) {
        ensureVisibleHighlightCoverage();
      }
      return true;
    },
    alignViewportToSelection(position) {
      rebuildViewportModel();
      const visual = getVisualRowForOffset(
        state,
        presentation.viewport.visualRows,
        presentation.viewport.lineVisualRanges,
        getActiveOffset(),
        presentation.viewport.softWrap,
        presentation.viewport.wrapColumns
      );
      const visibleCount = Math.max(1, presentation.viewport.visibleRowCapacity);
      const maxTop = Math.max(0, presentation.viewport.visualRows.length - visibleCount);
      const nextTop =
        position === "top"
          ? visual.rowIndex
          : position === "bottom"
            ? visual.rowIndex - visibleCount + 1
            : visual.rowIndex - Math.floor(visibleCount / 2);
      presentation.viewport.topVisualRow = Math.max(0, Math.min(maxTop, nextTop));
      const viewportChanged = syncVisibleViewportRows();
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.align");
      if (viewportChanged) {
        ensureVisibleHighlightCoverage();
      }
      return true;
    },
    revealSelection() {
      const didReveal = revealSelectionWithinViewport();
      const viewportChanged = syncVisibleViewportRows() || didReveal;
      syncVisibleLanguageDecorations();
      emitPresentationUpdate("viewport.reveal");
      if (viewportChanged) {
        ensureVisibleHighlightCoverage();
      }
    },
    setLanguageServices(languageServices) {
      presentation.language.services = normalizeLanguageServices(languageServices);
      presentation.language.languageRevision = -1;
      presentation.language.lastHighlightedRevision = -1;
      presentation.language.highlightRequestId = 0;
      inFlightVisibleHighlightRequestKey = null;
      inFlightVisibleHighlightRequest = null;
      presentation.language.diagnosticsRequestId = 0;
      presentation.language.lineChangesRequestId = 0;
      presentation.language.hoverRequestId = 0;
      presentation.language.highlightCache.clear();
      presentation.language.highlightCoverage.clear();
      presentation.language.visibleHighlightsByLine.clear();
      presentation.language.diagnostics = [];
      presentation.language.diagnosticsByLine.clear();
      presentation.language.lineChangesByLine.clear();
      presentation.language.visibleHighlights = [];
      presentation.language.visibleHighlightsByLine = new Map();
      presentation.language.visibleDiagnostics = [];
      presentation.language.visibleLineChanges = [];
      presentation.search.matches = [];
      presentation.search.visibleMatchesByLine = new Map();
      emitPresentationUpdate("language.services");
      void syncLanguage({
        forceDocumentSync: true,
        refreshHighlights: true,
        refreshDiagnostics: true,
        refreshLineChanges: true
      });
    },
    setHostServices(host) {
      presentation.language.host = host;
      emitPresentationUpdate("host.services");
      void syncLanguage({
        refreshHighlights: false,
        refreshDiagnostics: false,
        refreshLineChanges: true
      });
    },
    setFilePath(filePath) {
      presentation.filePath = filePath;
      emitPresentationUpdate("presentation.file-path");
      void syncLanguage({
        refreshHighlights: false,
        refreshDiagnostics: false,
        refreshLineChanges: true
      });
    },
    setThemeName(themeName) {
      presentation.themeName = themeName;
      emitPresentationUpdate("presentation.theme-name");
    },
    async refreshLanguage(options = {}) {
      await syncLanguage(options);
    },
    requestHover(offset) {
      const hoverSource = getHoverSource();

      if (!hoverSource) {
        return Promise.resolve(null);
      }

      const requestId = ++presentation.language.hoverRequestId;
      const revision = state.revision;
      return hoverSource.hover(getSnapshot(), offset).then((nextHover) => {
        if (requestId !== presentation.language.hoverRequestId || revision !== state.revision) {
          return null;
        }

        return nextHover;
      });
    },
    dismissHover() {
      presentation.language.hoverRequestId += 1;
    },
    requestCodeActions() {
      const codeActionSource = getCodeActionSource();

      if (!codeActionSource) {
        return Promise.resolve([]);
      }

      return codeActionSource.getCodeActions(getCodeActionContext()).catch(() => []);
    },
    applyCodeAction(action) {
      if (action.changes && action.changes.length > 0) {
        dispatch({
          changes: action.changes,
          effects: [{ type: "language.code-action", value: action.title }]
        });
        return Promise.resolve(true);
      }

      return resolveCodeActionChanges(action).then((changes) => {
        if (!changes || changes.length === 0) {
          return false;
        }

        dispatch({
          changes,
          effects: [{ type: "language.code-action", value: action.title }]
        });
        return true;
      });
    },
    formatDocument() {
      const formatter = getFormatter();

      if (!formatter) {
        return Promise.resolve(false);
      }

      return formatter
        .format({
          document: getSnapshot(),
          selection: getSelectionOffsets(state)
        })
        .then((changes) => {
          if (!changes || changes.length === 0) {
            return false;
          }

          dispatch({
            changes,
            effects: [{ type: "language.format" }]
          });
          return true;
        })
        .catch(() => false);
    },
    saveDocument(targetPath = presentation.filePath) {
      const writeFile = presentation.language.host?.writeFile;

      if (!writeFile) {
        return Promise.resolve(false);
      }

      const savedText = state.doc.text;
      return writeFile({
        filePath: targetPath,
        text: savedText
      })
        .then(() => {
          presentation.filePath = targetPath;
          emitPresentationUpdate("presentation.file-path");
          void refreshLineChanges();
          queueMicrotask(() => {
            void Promise.resolve(
              presentation.language.host?.didWriteFile?.({
                filePath: targetPath,
                text: savedText
              })
            ).catch(() => undefined);
          });
          return true;
        })
        .catch(() => false);
    }
  };
}
