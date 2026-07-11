import { Language, Parser, Query, type Tree } from "web-tree-sitter";

import type { HighlightRole, HighlightSpan, IndentationResult, SyntaxSelectionRange } from "@mewhhaha/wx-language";

import { mapCaptureNameToRole } from "./highlightMapping";
import { applyTextChange, buildTreeEdit, rebaseTextChanges } from "./incrementalEdits";
import { IncrementalLineIndex } from "./lineIndex";
import { isTreeSitterWorkerMessage, TREE_SITTER_WORKER_PROTOCOL_VERSION, type TreeSitterWorkerResponse, type WorkerTextChangeBatch } from "./messages";
import { expandSyntaxSelection, shrinkSyntaxSelection } from "./syntaxSelection";
import type { SyntaxNodeLike } from "./syntaxSelection";
import { indentationQueryOffset, queryIndentCaptures, resolveIndentCaptures } from "./indentQuery";

const globalScope = self as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: TreeSitterWorkerResponse): void;
};

let parser: Parser | null = null;
let language: Language | null = null;
let query: Query | null = null;
let indentQuery: Query | null = null;
let currentTree: Tree | null = null;
let currentText = "";
let currentRevision = 0;
const lineIndex = new IncrementalLineIndex();
const cancelledRequests = new Set<string>();

function post(message: { type: string; [key: string]: unknown }): void {
  globalScope.postMessage({ ...message, version: TREE_SITTER_WORKER_PROTOCOL_VERSION } as TreeSitterWorkerResponse);
}

function requestKey(generation: number, requestId: number): string { return `${generation}:${requestId}`; }

function toUtf16SyntaxNode(node: SyntaxNodeLike, parent: SyntaxNodeLike | null = null): SyntaxNodeLike {
  const children: SyntaxNodeLike[] = [];
  const converted: SyntaxNodeLike = {
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    parent,
    namedChildren: children
  };

  for (const child of node.namedChildren ?? []) {
    children.push(toUtf16SyntaxNode(child, converted));
  }

  return converted;
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

async function initialize(parserWasmUrl: string, languageWasmUrl: string, source: string, indentSource?: string): Promise<void> {
  const deno = (globalThis as typeof globalThis & {
    Deno?: { readFile(path: string | URL): Promise<Uint8Array> };
  }).Deno;
  const localResource = (value: string): string | URL => value.startsWith("file:") ? new URL(value) : value;
  if (deno) {
    const wasmBinary = await deno.readFile(localResource(parserWasmUrl));
    await Parser.init({ wasmBinary } as Parameters<typeof Parser.init>[0]);
    language = await Language.load(await deno.readFile(localResource(languageWasmUrl)));
  } else {
    await Parser.init({
      locateFile() {
        return parserWasmUrl;
      }
    });
    language = await Language.load(languageWasmUrl);
  }

  parser = new Parser();
  parser.setLanguage(language);
  query = new Query(language, source);
  indentQuery = indentSource ? new Query(language, indentSource) : null;
}

function buildIndentation(offset: number, action: "enter" | "open-below" | "open-above", revision: number): IndentationResult {
  if (revision !== currentRevision) return { revision, status: "stale" };
  if (!indentQuery || !currentTree) return { revision, status: "incomplete" };
  try {
    const queryOffset = indentationQueryOffset(currentText, offset, action);
    const captures = queryIndentCaptures(indentQuery, currentTree.rootNode, currentText.length, queryOffset);
    const answer = resolveIndentCaptures(captures, queryOffset);
    return answer.opaque
      ? { revision, status: "incomplete" }
      : { revision, status: "ok", indent: answer.indent, outdent: answer.outdent, ...(answer.alignColumn === undefined ? {} : { alignColumn: answer.alignColumn }) };
  } catch { return { revision, status: "incomplete" }; }
}

function parseText(text: string, revision: number): void {
  if (!parser) {
    throw new Error("tree-sitter parser not ready");
  }

  currentText = text;
  currentRevision = revision;
  lineIndex.reset(text);
  currentTree?.delete();
  currentTree = parser.parse(text);
}

function preflightBatches(batches: readonly WorkerTextChangeBatch[]): string {
  let text = currentText;
  for (const batch of batches) {
    for (const change of rebaseTextChanges(batch.changes)) {
      if (change.from < 0 || change.to < change.from || change.to > text.length) throw new RangeError("invalid edit");
      text = applyTextChange(text, change);
    }
  }
  return text;
}

function parseTextIncrementally(batches: readonly WorkerTextChangeBatch[], revision: number, expectedLength: number): "incremental" | "invalid-edit" | "length-mismatch" {
  if (!parser || !currentTree) return "invalid-edit";
  let expectedText: string;
  try { expectedText = preflightBatches(batches); }
  catch { return "invalid-edit"; }
  if (expectedText.length !== expectedLength) return "length-mismatch";

  try {
    let workingText = currentText;
    for (const batch of batches) {
      for (const change of rebaseTextChanges(batch.changes)) {
        currentTree.edit(buildTreeEdit(workingText, change, lineIndex) as Parameters<Tree["edit"]>[0]);
        workingText = lineIndex.applyChange(change);
      }
    }
    const previousTree = currentTree;
    currentText = workingText;
    currentRevision = revision;
    currentTree = parser.parse(workingText, previousTree);
    previousTree.delete();
    return "incremental";
  } catch {
    currentTree?.delete();
    currentTree = null;
    currentRevision = -1;
    return "invalid-edit";
  }
}

function buildHighlights(lines: { fromLine: number; toLine: number }, revision: number): HighlightSpan[] {
  if (!query || !currentTree || revision !== currentRevision) {
    return [];
  }

  const bounds = lineIndex.viewportBounds(lines);
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
      .map((span) => ({ ...span, role: span.role }))
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

  const root = toUtf16SyntaxNode(currentTree.rootNode);
  return mode === "expand"
    ? expandSyntaxSelection(root, selection)
    : shrinkSyntaxSelection(root, selection, activeOffset);
}

globalScope.addEventListener("message", async (event: MessageEvent<unknown>) => {
  try {
    const payload = event.data;

    if (!isTreeSitterWorkerMessage(payload)) {
      post({ type: "error", message: "Malformed or unsupported Tree-sitter worker request." });
      return;
    }

    switch (payload.type) {
      case "init":
        await initialize(payload.parserWasmUrl, payload.languageWasmUrl, payload.query, payload.indentQuery);
        post({ type: "ready" });
        return;
      case "open":
        parseText(payload.text, payload.revision);
        post({ type: "synced", generation: payload.generation, requestId: payload.requestId, revision: payload.revision, documentLength: currentText.length, mode: "open" });
        return;
      case "update": {
        if (payload.baseRevision !== currentRevision) {
          post({ type: "sync-required", generation: payload.generation, requestId: payload.requestId, revision: currentRevision, reason: "base-revision" });
          return;
        }
        const outcome = parseTextIncrementally(payload.batches, payload.revision, payload.documentLength);
        if (outcome !== "incremental") {
          post({ type: "sync-required", generation: payload.generation, requestId: payload.requestId, revision: currentRevision, reason: outcome });
          return;
        }
        post({ type: "synced", generation: payload.generation, requestId: payload.requestId, revision: payload.revision, documentLength: currentText.length, mode: "incremental" });
        return;
      }
      case "cancel":
        cancelledRequests.add(requestKey(payload.generation, payload.requestId));
        if (cancelledRequests.size > 128) cancelledRequests.clear();
        return;
      case "highlight":
        if (cancelledRequests.delete(requestKey(payload.generation, payload.requestId))) return;
        post({
          type: "highlights",
          generation: payload.generation,
          revision: payload.revision,
          requestId: payload.requestId,
          spans: buildHighlights(payload.lines, payload.revision)
        });
        return;
      case "indentation":
        if (cancelledRequests.delete(requestKey(payload.generation, payload.requestId))) return;
        post({ type: "indentation-result", generation: payload.generation, requestId: payload.requestId, result: buildIndentation(payload.offset, payload.action, payload.revision) });
        return;
      case "expand-selection":
        if (cancelledRequests.delete(requestKey(payload.generation, payload.requestId))) return;
        post({
          type: "selection",
          generation: payload.generation,
          revision: payload.revision,
          requestId: payload.requestId,
          selection: buildSyntaxSelection("expand", payload.selection, payload.activeOffset, payload.revision)
        });
        return;
      case "shrink-selection":
        if (cancelledRequests.delete(requestKey(payload.generation, payload.requestId))) return;
        post({
          type: "selection",
          generation: payload.generation,
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
