import {
  combineEditorState,
  createEditorState,
  createSelectionSet,
  remapEditorViewState,
  splitEditorState,
  type EditorBufferDocumentState,
  type EditorState,
  type EditorViewState,
  type TextChange
} from "@wx/editor-core";

import type {
  EditorCompletionState,
  EditorHoverState,
  EditorLanguagePresentationState,
  EditorPaneTreeNode,
  EditorPresentationState,
  EditorViewportPresentationState,
  EditorWorkspacePanePresentationState,
  EditorWorkspacePresentationState,
  EditorWorkspaceSplitAxis
} from "./types";

interface WorkspaceBufferSession {
  id: string;
  filePath: string;
  dirty: boolean;
  buffer: EditorBufferDocumentState;
  language: EditorLanguagePresentationState;
  viewTemplate: EditorViewState;
}

interface WorkspacePaneSession {
  id: string;
  bufferId: string;
  view: EditorViewState;
  viewport: EditorViewportPresentationState;
  completion: EditorCompletionState;
  hover: EditorHoverState;
}

interface CreateWorkspaceRuntimeOptions {
  state: EditorState;
  presentation: EditorPresentationState;
}

export interface WorkspaceRuntime {
  getActivePaneId(): string;
  getActiveBufferId(): string;
  getPaneIds(): readonly string[];
  getLayoutTree(): EditorPaneTreeNode;
  getBuffers(): Array<{ id: string; filePath: string; dirty: boolean }>;
  getBufferById(bufferId: string): WorkspaceBufferSession | null;
  findBufferByFilePath(filePath: string): WorkspaceBufferSession | null;
  getBufferState(filePath: string): EditorState | null;
  syncActiveFilePath(filePath: string): void;
  markActiveSaved(filePath?: string): void;
  createStateForText(text: string, template: EditorState): EditorState;
  storeBufferState(filePath: string, state: EditorState, dirty?: boolean): WorkspaceBufferSession;
  bindActivePaneToBuffer(bufferId: string): boolean;
  splitActivePane(axis: EditorWorkspaceSplitAxis): boolean;
  closeActivePane(): { changed: boolean; nextActivePaneId: string | null };
  onlyActivePane(): boolean;
  swapActivePane(direction: "left" | "right" | "up" | "down"): boolean;
  focusPane(direction: "left" | "right" | "up" | "down"): string | null;
  focusNextPane(): string | null;
  setActivePane(paneId: string): boolean;
  syncFromActiveState(state: EditorState, presentation: EditorPresentationState, options?: { docChanged?: boolean }): void;
  loadActivePaneInto(state: EditorState, presentation: EditorPresentationState): EditorState;
  applyBufferChangesToSiblingPanes(changes: readonly TextChange[]): void;
  getWorkspacePresentationState(
    state: EditorState,
    presentation: EditorPresentationState
  ): EditorWorkspacePresentationState;
}

function cloneLanguageState(language: EditorLanguagePresentationState): EditorLanguagePresentationState {
  return {
    ...language,
    services: [...language.services],
    highlightCache: new Map([...language.highlightCache].map(([line, spans]) => [line, spans.map((span) => ({ ...span }))])),
    highlightCoverage: new Set(language.highlightCoverage),
    diagnostics: language.diagnostics.map((entry) => ({ ...entry })),
    diagnosticsByLine: new Map(
      [...language.diagnosticsByLine].map(([line, entries]) => [line, entries.map((entry) => ({ ...entry }))])
    ),
    lineChangesByLine: new Map([...language.lineChangesByLine].map(([line, entry]) => [line, { ...entry }])),
    visibleHighlights: language.visibleHighlights.map((span) => ({ ...span })),
    visibleHighlightsByLine: new Map(
      [...language.visibleHighlightsByLine].map(([line, spans]) => [line, spans.map((span) => ({ ...span }))])
    ),
    visibleDiagnostics: language.visibleDiagnostics.map((entry) => ({ ...entry })),
    visibleLineChanges: language.visibleLineChanges.map((entry) => ({ ...entry }))
  };
}

function mutateLanguageState(target: EditorLanguagePresentationState, source: EditorLanguagePresentationState): void {
  target.services = [...source.services];
  target.host = source.host;
  target.languageRevision = source.languageRevision;
  target.lastHighlightedRevision = source.lastHighlightedRevision;
  target.highlightRequestId = source.highlightRequestId;
  target.diagnosticsRequestId = source.diagnosticsRequestId;
  target.lineChangesRequestId = source.lineChangesRequestId;
  target.hoverRequestId = source.hoverRequestId;
  target.completionRequestId = source.completionRequestId;
  target.navigationRequestId = source.navigationRequestId;
  target.renameRequestId = source.renameRequestId;
  target.symbolsRequestId = source.symbolsRequestId;
  target.highlightCache = new Map([...source.highlightCache].map(([line, spans]) => [line, spans.map((span) => ({ ...span }))]));
  target.highlightCoverage = new Set(source.highlightCoverage);
  target.diagnostics = source.diagnostics.map((entry) => ({ ...entry }));
  target.diagnosticsByLine = new Map(
    [...source.diagnosticsByLine].map(([line, entries]) => [line, entries.map((entry) => ({ ...entry }))])
  );
  target.lineChangesByLine = new Map([...source.lineChangesByLine].map(([line, entry]) => [line, { ...entry }]));
  target.visibleHighlights = source.visibleHighlights.map((span) => ({ ...span }));
  target.visibleHighlightsByLine = new Map(
    [...source.visibleHighlightsByLine].map(([line, spans]) => [line, spans.map((span) => ({ ...span }))])
  );
  target.visibleDiagnostics = source.visibleDiagnostics.map((entry) => ({ ...entry }));
  target.visibleLineChanges = source.visibleLineChanges.map((entry) => ({ ...entry }));
}

function cloneViewportState(viewport: EditorViewportPresentationState): EditorViewportPresentationState {
  return {
    ...viewport,
    visualRows: viewport.visualRows.map((entry) => ({ ...entry })),
    visibleVisualRows: viewport.visibleVisualRows.map((entry) => ({ ...entry })),
    lineVisualRanges: viewport.lineVisualRanges.map((entry) => ({ ...entry }))
  };
}

function mutateViewportState(target: EditorViewportPresentationState, source: EditorViewportPresentationState): void {
  target.topVisualRow = source.topVisualRow;
  target.visibleRowCapacity = source.visibleRowCapacity;
  target.scrolloffRows = source.scrolloffRows;
  target.wrapColumns = source.wrapColumns;
  target.softWrap = source.softWrap;
  target.visualRows = source.visualRows.map((entry) => ({ ...entry }));
  target.visibleVisualRows = source.visibleVisualRows.map((entry) => ({ ...entry }));
  target.lineVisualRanges = source.lineVisualRanges.map((entry) => ({ ...entry }));
  target.wrapRevision = source.wrapRevision;
}

function cloneCompletionState(completion: EditorCompletionState): EditorCompletionState {
  return {
    ...completion,
    items: completion.items.map((item) => ({ ...item }))
  };
}

function cloneHoverState(hover: EditorHoverState): EditorHoverState {
  return { ...hover };
}

function cloneViewState(view: EditorViewState): EditorViewState {
  return {
    ...view,
    selection: createSelectionSet(view.selection.ranges, view.selection.primaryIndex),
    insertSession: view.insertSession ? { ...view.insertSession } : null
  };
}

function cloneBufferState(buffer: EditorBufferDocumentState): EditorBufferDocumentState {
  return {
    ...buffer,
    doc: buffer.doc
  };
}

function cloneTree(node: EditorPaneTreeNode): EditorPaneTreeNode {
  return node.kind === "pane"
    ? { ...node }
    : {
        kind: "split",
        axis: node.axis,
        ratio: node.ratio,
        first: cloneTree(node.first),
        second: cloneTree(node.second)
      };
}

function replacePaneNode(
  node: EditorPaneTreeNode,
  targetPaneId: string,
  replacement: EditorPaneTreeNode
): EditorPaneTreeNode {
  if (node.kind === "pane") {
    return node.paneId === targetPaneId ? replacement : node;
  }

  return {
    ...node,
    first: replacePaneNode(node.first, targetPaneId, replacement),
    second: replacePaneNode(node.second, targetPaneId, replacement)
  };
}

function removePaneNode(node: EditorPaneTreeNode, targetPaneId: string): EditorPaneTreeNode | null {
  if (node.kind === "pane") {
    return node.paneId === targetPaneId ? null : node;
  }

  const nextFirst = removePaneNode(node.first, targetPaneId);
  const nextSecond = removePaneNode(node.second, targetPaneId);

  if (!nextFirst && !nextSecond) {
    return null;
  }

  if (!nextFirst) {
    return nextSecond;
  }

  if (!nextSecond) {
    return nextFirst;
  }

  return {
    ...node,
    first: nextFirst,
    second: nextSecond
  };
}

function swapPaneIds(node: EditorPaneTreeNode, firstPaneId: string, secondPaneId: string): EditorPaneTreeNode {
  if (node.kind === "pane") {
    if (node.paneId === firstPaneId) {
      return { kind: "pane", paneId: secondPaneId };
    }

    if (node.paneId === secondPaneId) {
      return { kind: "pane", paneId: firstPaneId };
    }

    return node;
  }

  return {
    ...node,
    first: swapPaneIds(node.first, firstPaneId, secondPaneId),
    second: swapPaneIds(node.second, firstPaneId, secondPaneId)
  };
}

function collectPaneRects(
  node: EditorPaneTreeNode,
  x: number,
  y: number,
  width: number,
  height: number,
  output: Array<{ paneId: string; x: number; y: number; width: number; height: number }>
): void {
  if (node.kind === "pane") {
    output.push({ paneId: node.paneId, x, y, width, height });
    return;
  }

  if (node.axis === "vertical") {
    const firstWidth = width * node.ratio;
    collectPaneRects(node.first, x, y, firstWidth, height, output);
    collectPaneRects(node.second, x + firstWidth, y, width - firstWidth, height, output);
    return;
  }

  const firstHeight = height * node.ratio;
  collectPaneRects(node.first, x, y, width, firstHeight, output);
  collectPaneRects(node.second, x, y + firstHeight, width, height - firstHeight, output);
}

function collectPaneIds(node: EditorPaneTreeNode, output: string[]): void {
  if (node.kind === "pane") {
    output.push(node.paneId);
    return;
  }

  collectPaneIds(node.first, output);
  collectPaneIds(node.second, output);
}

function chooseFocusedPane(
  rects: readonly { paneId: string; x: number; y: number; width: number; height: number }[],
  activePaneId: string,
  direction: "left" | "right" | "up" | "down"
): string | null {
  const active = rects.find((entry) => entry.paneId === activePaneId);
  if (!active) {
    return null;
  }

  const activeCenterX = active.x + active.width / 2;
  const activeCenterY = active.y + active.height / 2;
  let best: { paneId: string; score: number } | null = null;

  for (const rect of rects) {
    if (rect.paneId === activePaneId) {
      continue;
    }

    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const dx = centerX - activeCenterX;
    const dy = centerY - activeCenterY;

    if (direction === "left" && dx >= 0) {
      continue;
    }

    if (direction === "right" && dx <= 0) {
      continue;
    }

    if (direction === "up" && dy >= 0) {
      continue;
    }

    if (direction === "down" && dy <= 0) {
      continue;
    }

    const primaryDistance = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    const crossDistance = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primaryDistance * 1000 + crossDistance;

    if (!best || score < best.score) {
      best = { paneId: rect.paneId, score };
    }
  }

  return best?.paneId ?? null;
}

export function createWorkspaceRuntime(options: CreateWorkspaceRuntimeOptions): WorkspaceRuntime {
  let nextBufferId = 2;
  let nextPaneId = 2;
  const split = splitEditorState(options.state);
  const buffers = new Map<string, WorkspaceBufferSession>();
  const panes = new Map<string, WorkspacePaneSession>();
  const initialBuffer: WorkspaceBufferSession = {
    id: "buffer-1",
    filePath: options.presentation.filePath,
    dirty: false,
    buffer: cloneBufferState(split.buffer),
    language: cloneLanguageState(options.presentation.language),
    viewTemplate: cloneViewState(split.view)
  };
  const initialPane: WorkspacePaneSession = {
    id: "pane-1",
    bufferId: initialBuffer.id,
    view: cloneViewState(split.view),
    viewport: cloneViewportState(options.presentation.viewport),
    completion: cloneCompletionState(options.presentation.ui.completion),
    hover: cloneHoverState(options.presentation.ui.hover)
  };
  buffers.set(initialBuffer.id, initialBuffer);
  panes.set(initialPane.id, initialPane);

  let activeBufferId = initialBuffer.id;
  let activePaneId = initialPane.id;
  let layoutTree: EditorPaneTreeNode = { kind: "pane", paneId: initialPane.id };

  const findBufferByFilePath = (filePath: string) => {
    for (const entry of buffers.values()) {
      if (entry.filePath === filePath) {
        return entry;
      }
    }
    return null;
  };

  const getActivePane = () => panes.get(activePaneId) ?? initialPane;
  const getActiveBuffer = () => buffers.get(activeBufferId) ?? initialBuffer;

  const ensureActivePair = () => {
    const pane = getActivePane();
    const buffer = buffers.get(pane.bufferId) ?? getActiveBuffer();
    activePaneId = pane.id;
    activeBufferId = buffer.id;
    return { pane, buffer };
  };

  const createPanePresentation = (
    pane: WorkspacePaneSession,
    buffer: WorkspaceBufferSession,
    presentation: EditorPresentationState,
    active: boolean
  ): EditorWorkspacePanePresentationState => {
    const panePresentation: EditorPresentationState = {
      ...presentation,
      filePath: buffer.filePath,
      viewport: cloneViewportState(pane.viewport),
      language: cloneLanguageState(buffer.language),
      ui: {
        ...presentation.ui,
        commandLine: active ? { ...presentation.ui.commandLine } : { active: false, value: "", prompt: ":" },
        picker: active
          ? {
              ...presentation.ui.picker,
              items: presentation.ui.picker.items.map((item) => ({ ...item }))
            }
          : {
              active: false,
              loading: false,
              title: "",
              items: [],
              selectedIndex: 0,
              error: null,
              query: "",
              variant: "bar",
              previewTitle: "",
              previewContent: "",
              previewLoading: false
            },
        bottomMessage: active ? presentation.ui.bottomMessage && { ...presentation.ui.bottomMessage } : null,
        hover: active ? cloneHoverState(pane.hover) : { active: false, pinned: false, offset: null, content: "", tone: "info" },
        flash: active
          ? {
              ...presentation.ui.flash,
              hints: presentation.ui.flash.hints.map((hint) => ({ ...hint }))
            }
          : { active: false, target: "", input: "", hints: [] },
        pendingAction: active ? presentation.ui.pendingAction : null,
        pendingCount: active ? presentation.ui.pendingCount : "",
        stickyViewMode: active ? presentation.ui.stickyViewMode : false,
        previewTheme: active ? presentation.ui.previewTheme : null,
        lastRepeatableMotion: active ? presentation.ui.lastRepeatableMotion : null,
        commandCompletionIndex: active ? presentation.ui.commandCompletionIndex : 0,
        commandCompletionItems: active
          ? presentation.ui.commandCompletionItems.map((item) => ({ ...item }))
          : [],
        completion: active
          ? cloneCompletionState(pane.completion)
          : {
              active: false,
              loading: false,
              anchorOffset: null,
              items: [],
              selectedIndex: 0,
              error: null
            },
        rename: active ? { ...presentation.ui.rename } : { active: false, anchorOffset: null, value: "", error: null }
      },
      search: {
        ...presentation.search,
        matches: presentation.search.matches.map((entry) => ({ ...entry })),
        visibleMatchesByLine: new Map(
          [...presentation.search.visibleMatchesByLine].map(([line, entries]) => [line, entries.map((entry) => ({ ...entry }))])
        )
      },
      jumps: {
        items: presentation.jumps.items.map((entry) => ({
          ...entry,
          selection: createSelectionSet(entry.selection.ranges, entry.selection.primaryIndex)
        })),
        cursor: presentation.jumps.cursor
      },
      registers: {
        ...presentation.registers,
        named: { ...presentation.registers.named }
      }
    };

    const state = combineEditorState(buffer.buffer, pane.view);
    return {
      paneId: pane.id,
      bufferId: buffer.id,
      active,
      filePath: buffer.filePath,
      buffer: cloneBufferState(buffer.buffer),
      view: cloneViewState(pane.view),
      state,
      presentation: panePresentation
    };
  };

  return {
    getActivePaneId() {
      return activePaneId;
    },
    getActiveBufferId() {
      return activeBufferId;
    },
    getPaneIds() {
      return [...panes.keys()];
    },
    getLayoutTree() {
      return cloneTree(layoutTree);
    },
    getBuffers() {
      return [...buffers.values()].map(({ id, filePath, dirty }) => ({ id, filePath, dirty }));
    },
    getBufferById(bufferId) {
      return buffers.get(bufferId) ?? null;
    },
    findBufferByFilePath,
    getBufferState(filePath) {
      const entry = findBufferByFilePath(filePath);
      if (!entry) {
        return null;
      }

      return combineEditorState(entry.buffer, entry.viewTemplate);
    },
    syncActiveFilePath(filePath) {
      const buffer = getActiveBuffer();
      buffer.filePath = filePath;
    },
    markActiveSaved(filePath) {
      const buffer = getActiveBuffer();
      if (filePath) {
        buffer.filePath = filePath;
      }
      buffer.dirty = false;
    },
    createStateForText(text, template) {
      return createEditorState({
        value: text,
        language: template.language,
        theme: template.theme
      });
    },
    storeBufferState(filePath, state, dirty = false) {
      const splitState = splitEditorState(state);
      const existing = findBufferByFilePath(filePath);

      if (existing) {
        existing.filePath = filePath;
        existing.dirty = dirty;
        existing.buffer = cloneBufferState(splitState.buffer);
        existing.viewTemplate = cloneViewState(splitState.view);

        for (const pane of panes.values()) {
          if (pane.bufferId === existing.id) {
            pane.view = cloneViewState(splitState.view);
          }
        }

        if (existing.id === activeBufferId) {
          mutateLanguageState(existing.language, options.presentation.language);
        }

        return existing;
      }

      const entry: WorkspaceBufferSession = {
        id: `buffer-${nextBufferId++}`,
        filePath,
        dirty,
        buffer: cloneBufferState(splitState.buffer),
        language: cloneLanguageState(options.presentation.language),
        viewTemplate: cloneViewState(splitState.view)
      };
      buffers.set(entry.id, entry);
      return entry;
    },
    bindActivePaneToBuffer(bufferId) {
      const pane = getActivePane();
      const buffer = buffers.get(bufferId);

      if (!pane || !buffer) {
        return false;
      }

      pane.bufferId = bufferId;
      pane.view = cloneViewState(buffer.viewTemplate);
      activeBufferId = bufferId;
      return true;
    },
    splitActivePane(axis) {
      const currentPane = getActivePane();
      if (!currentPane) {
        return false;
      }

      const nextPane: WorkspacePaneSession = {
        id: `pane-${nextPaneId++}`,
        bufferId: currentPane.bufferId,
        view: cloneViewState(currentPane.view),
        viewport: cloneViewportState(currentPane.viewport),
        completion: cloneCompletionState(currentPane.completion),
        hover: cloneHoverState(currentPane.hover)
      };
      panes.set(nextPane.id, nextPane);
      layoutTree = replacePaneNode(layoutTree, currentPane.id, {
        kind: "split",
        axis,
        ratio: 0.5,
        first: { kind: "pane", paneId: currentPane.id },
        second: { kind: "pane", paneId: nextPane.id }
      });
      activePaneId = nextPane.id;
      activeBufferId = nextPane.bufferId;
      return true;
    },
    closeActivePane() {
      if (panes.size <= 1) {
        return { changed: false, nextActivePaneId: null };
      }

      const currentPaneId = activePaneId;
      const nextTree = removePaneNode(layoutTree, currentPaneId);
      if (!nextTree) {
        return { changed: false, nextActivePaneId: null };
      }

      panes.delete(currentPaneId);
      layoutTree = nextTree;
      const nextPaneId = panes.keys().next().value ?? null;
      if (!nextPaneId) {
        return { changed: false, nextActivePaneId: null };
      }

      activePaneId = nextPaneId;
      activeBufferId = panes.get(nextPaneId)?.bufferId ?? activeBufferId;
      return { changed: true, nextActivePaneId: nextPaneId };
    },
    onlyActivePane() {
      if (panes.size <= 1) {
        return false;
      }

      const currentPane = getActivePane();
      panes.clear();
      panes.set(currentPane.id, currentPane);
      layoutTree = { kind: "pane", paneId: currentPane.id };
      activePaneId = currentPane.id;
      activeBufferId = currentPane.bufferId;
      return true;
    },
    swapActivePane(direction) {
      const targetPaneId = this.focusPane(direction);
      if (!targetPaneId || targetPaneId === activePaneId) {
        return false;
      }

      layoutTree = swapPaneIds(layoutTree, activePaneId, targetPaneId);
      return true;
    },
    focusPane(direction) {
      const rects: Array<{ paneId: string; x: number; y: number; width: number; height: number }> = [];
      collectPaneRects(layoutTree, 0, 0, 1, 1, rects);
      return chooseFocusedPane(rects, activePaneId, direction);
    },
    focusNextPane() {
      const paneIds: string[] = [];
      collectPaneIds(layoutTree, paneIds);
      if (paneIds.length <= 1) {
        return null;
      }

      const currentIndex = paneIds.indexOf(activePaneId);
      if (currentIndex < 0) {
        return paneIds[0] ?? null;
      }

      return paneIds[(currentIndex + 1) % paneIds.length] ?? null;
    },
    setActivePane(paneId) {
      if (!panes.has(paneId)) {
        return false;
      }

      activePaneId = paneId;
      activeBufferId = panes.get(paneId)?.bufferId ?? activeBufferId;
      return true;
    },
    syncFromActiveState(state, presentation, runtimeOptions = {}) {
      const { pane, buffer } = ensureActivePair();
      const splitState = splitEditorState(state);
      pane.view = cloneViewState(splitState.view);
      pane.viewport = cloneViewportState(presentation.viewport);
      pane.completion = cloneCompletionState(presentation.ui.completion);
      pane.hover = cloneHoverState(presentation.ui.hover);

      buffer.filePath = presentation.filePath;
      buffer.buffer = cloneBufferState(splitState.buffer);
      buffer.viewTemplate = cloneViewState(splitState.view);
      if (runtimeOptions.docChanged) {
        buffer.dirty = true;
      }
      mutateLanguageState(buffer.language, presentation.language);
      activeBufferId = buffer.id;
    },
    loadActivePaneInto(_state, presentation) {
      const { pane, buffer } = ensureActivePair();
      const nextState = combineEditorState(buffer.buffer, pane.view);
      presentation.filePath = buffer.filePath;
      mutateViewportState(presentation.viewport, pane.viewport);
      mutateLanguageState(presentation.language, buffer.language);
      presentation.ui.completion = cloneCompletionState(pane.completion);
      presentation.ui.hover = cloneHoverState(pane.hover);
      return nextState;
    },
    applyBufferChangesToSiblingPanes(changes) {
      if (changes.length === 0) {
        return;
      }

      const { pane: activePane, buffer } = ensureActivePair();
      for (const pane of panes.values()) {
        if (pane.id === activePane.id || pane.bufferId !== buffer.id) {
          continue;
        }

        pane.view = remapEditorViewState(pane.view, buffer.buffer.doc, changes);
      }
    },
    getWorkspacePresentationState(state, presentation) {
      const paneSnapshots: EditorWorkspacePanePresentationState[] = [];

      for (const pane of panes.values()) {
        const buffer = buffers.get(pane.bufferId);
        if (!buffer) {
          continue;
        }

        paneSnapshots.push(createPanePresentation(pane, buffer, presentation, pane.id === activePaneId));
      }

      return {
        activePaneId,
        activeBufferId,
        layoutTree: cloneTree(layoutTree),
        panes: paneSnapshots
      };
    }
  };
}
