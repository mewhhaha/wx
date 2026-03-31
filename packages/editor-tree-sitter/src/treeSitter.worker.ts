import type { TextChange } from "@whx/editor-core";
import { Language, Parser, Query } from "web-tree-sitter";

import type { HighlightRole, HighlightSpan, SyntaxSelectionRange } from "@whx/editor-language";

import { mapCaptureNameToRole } from "./highlightMapping";
import { applyTextChange, buildTreeEdit, rebaseTextChanges } from "./incrementalEdits";
import type { TreeSitterWorkerMessage, TreeSitterWorkerResponse } from "./messages";
import { expandSyntaxSelection, shrinkSyntaxSelection } from "./syntaxSelection";

const globalScope = self as DedicatedWorkerGlobalScope;

let parser: Parser | null = null;
let language: Language | null = null;
let query: Query | null = null;
let currentTree: Parser.Tree | null = null;
let currentText = "";
let currentRevision = 0;

function post(message: TreeSitterWorkerResponse): void {
  globalScope.postMessage(message);
}

function lineOffsets(text: string): number[] {
  const offsets = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function viewportBounds(text: string, lines: { fromLine: number; toLine: number }): { from: number; to: number } {
  const offsets = lineOffsets(text);
  const fromLine = Math.max(0, Math.min(offsets.length - 1, lines.fromLine));
  const toLine = Math.max(fromLine, Math.min(offsets.length - 1, lines.toLine));
  const from = offsets[fromLine];
  const to = toLine + 1 < offsets.length ? offsets[toLine + 1] - 1 : text.length;
  return { from, to };
}

function sortAndCompact(spans: HighlightSpan[]): HighlightSpan[] {
  const sorted = [...spans].sort((left, right) => left.from - right.from || left.to - right.to);
  const compacted: HighlightSpan[] = [];

  for (const span of sorted) {
    const previous = compacted.at(-1);

    if (!previous) {
      compacted.push(span);
      continue;
    }

    if (span.from < previous.to) {
      if (span.to > previous.to) {
        compacted.push({ ...span, from: previous.to });
      }
      continue;
    }

    if (previous.role === span.role && previous.to === span.from) {
      previous.to = span.to;
      continue;
    }

    compacted.push(span);
  }

  return compacted;
}

async function initialize(parserWasmUrl: string, languageWasmUrl: string, source: string): Promise<void> {
  await Parser.init({
    locateFile() {
      return parserWasmUrl;
    }
  });

  language = await Language.load(languageWasmUrl);
  parser = new Parser();
  parser.setLanguage(language);
  query = new Query(language, source);
}

function parseText(text: string, revision: number): void {
  if (!parser) {
    throw new Error("tree-sitter parser not ready");
  }

  currentText = text;
  currentRevision = revision;
  currentTree?.delete();
  currentTree = parser.parse(text);
}

function parseTextIncrementally(text: string, revision: number, changes: readonly TextChange[]): void {
  if (!parser || !currentTree || changes.length === 0) {
    parseText(text, revision);
    return;
  }

  const rebasedChanges = rebaseTextChanges(changes);
  let workingText = currentText;

  for (const change of rebasedChanges) {
    currentTree.edit(buildTreeEdit(workingText, change));
    workingText = applyTextChange(workingText, change);
  }

  if (workingText !== text) {
    parseText(text, revision);
    return;
  }

  const previousTree = currentTree;
  currentText = text;
  currentRevision = revision;
  currentTree = parser.parse(text, previousTree);
  previousTree.delete();
}

function buildHighlights(lines: { fromLine: number; toLine: number }, revision: number): HighlightSpan[] {
  if (!query || !currentTree || revision !== currentRevision) {
    return [];
  }

  const bounds = viewportBounds(currentText, lines);
  const captures = query.captures(currentTree.rootNode, {
    startPosition: { row: lines.fromLine, column: 0 },
    endPosition: { row: lines.toLine + 1, column: 0 }
  });

  return sortAndCompact(
    captures
      .map((capture) => ({
        from: capture.node.startIndex,
        to: capture.node.endIndex,
        role: mapCaptureNameToRole(capture.name)
      }))
      .filter((span) => span.from < bounds.to && span.to > bounds.from)
      .map((span) => ({
        ...span,
        from: Math.max(span.from, bounds.from),
        to: Math.min(span.to, bounds.to)
      }))
      .filter((span) => span.to > span.from)
  );
}

function buildSyntaxSelection(
  mode: "expand" | "shrink",
  selection: SyntaxSelectionRange,
  activeOffset: number,
  revision: number
): SyntaxSelectionRange | null {
  if (!currentTree || revision !== currentRevision) {
    return null;
  }

  return mode === "expand"
    ? expandSyntaxSelection(currentTree.rootNode, selection)
    : shrinkSyntaxSelection(currentTree.rootNode, selection, activeOffset);
}

globalScope.addEventListener("message", async (event: MessageEvent<TreeSitterWorkerMessage>) => {
  try {
    const payload = event.data;

    switch (payload.type) {
      case "init":
        await initialize(payload.parserWasmUrl, payload.languageWasmUrl, payload.query);
        post({ type: "ready" });
        return;
      case "open":
        parseText(payload.text, payload.revision);
        return;
      case "update":
        parseTextIncrementally(payload.text, payload.revision, payload.changes);
        return;
      case "highlight":
        post({
          type: "highlights",
          revision: payload.revision,
          requestId: payload.requestId,
          spans: buildHighlights(payload.lines, payload.revision)
        });
        return;
      case "expand-selection":
        post({
          type: "selection",
          revision: payload.revision,
          requestId: payload.requestId,
          selection: buildSyntaxSelection("expand", payload.selection, payload.activeOffset, payload.revision)
        });
        return;
      case "shrink-selection":
        post({
          type: "selection",
          revision: payload.revision,
          requestId: payload.requestId,
          selection: buildSyntaxSelection("shrink", payload.selection, payload.activeOffset, payload.revision)
        });
        return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    post({ type: "error", message });
  }
});
