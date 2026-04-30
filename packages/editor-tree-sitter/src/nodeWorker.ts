import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parentPort } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { TextChange } from "@mewhhaha/wx-core";
import type { HighlightSpan, SyntaxSelectionRange } from "@mewhhaha/wx-language";

import { mapCaptureNameToRole } from "./highlightMapping";
import { applyTextChange, buildTreeEdit, rebaseTextChanges } from "./incrementalEdits";
import type { TreeSitterWorkerMessage, TreeSitterWorkerResponse } from "./messages";
import { utf16OffsetToUtf8ByteOffset, utf8ByteOffsetToUtf16Offset, utf8ByteRangeToUtf16Range } from "./offsets";
import { expandSyntaxSelection, shrinkSyntaxSelection } from "./syntaxSelection";

interface ParserModule {
  Language: {
    load(languageWasmUrl: string): Promise<unknown>;
  };
  Parser: {
    new (): {
      setLanguage(language: unknown): void;
      parse(text: string, previousTree?: unknown): TreeLike;
    };
    init(options: { locateFile(): string }): Promise<void>;
  };
  Query: new (language: unknown, source: string) => QueryLike;
}

interface TreeLike {
  rootNode: SyntaxNodeLike;
  edit(edit: ReturnType<typeof buildTreeEdit>): void;
  delete(): void;
}

interface SyntaxNodeLike {
  startIndex: number;
  endIndex: number;
  parent: SyntaxNodeLike | null;
  namedChildren?: readonly SyntaxNodeLike[];
}

interface QueryLike {
  captures(
    rootNode: unknown,
    options: {
      startPosition: { row: number; column: number };
      endPosition: { row: number; column: number };
    }
  ): Array<{ node: { startIndex: number; endIndex: number }; name: string }>;
}

let parser: InstanceType<ParserModule["Parser"]> | null = null;
let query: QueryLike | null = null;
let currentTree: TreeLike | null = null;
let currentText = "";
let currentRevision = 0;

function post(message: TreeSitterWorkerResponse): void {
  parentPort?.postMessage(message);
}

function toPath(value: string): string {
  return value.startsWith("file:") ? fileURLToPath(value) : value;
}

function resolveWorkerDependency(candidates: readonly string[]): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = resolve(here, "..", "..", "..");

  for (const candidate of candidates) {
    const absolute = resolve(workspaceRoot, candidate);
    if (existsSync(absolute)) {
      return absolute;
    }
  }

  throw new Error(`Could not locate tree-sitter runtime dependency. Tried: ${candidates.join(", ")}`);
}

async function loadParserModule(parserRuntimeUrl: string | undefined, parserWasmUrl: string): Promise<ParserModule> {
  const parserWasmPath = toPath(parserWasmUrl);
  const runtimePath =
    parserRuntimeUrl !== undefined
      ? toPath(parserRuntimeUrl)
      : resolve(dirname(parserWasmPath), "web-tree-sitter.js");
  const modulePath = existsSync(runtimePath)
    ? runtimePath
    : resolveWorkerDependency([
        "node_modules/.pnpm/web-tree-sitter@0.26.8/node_modules/web-tree-sitter/web-tree-sitter.js",
        "node_modules/web-tree-sitter/web-tree-sitter.js"
      ]);

  return (await import(pathToFileURL(modulePath).href)) as ParserModule;
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

function viewportByteBounds(text: string, lines: { fromLine: number; toLine: number }): { from: number; to: number } {
  const bounds = viewportBounds(text, lines);
  return {
    from: utf16OffsetToUtf8ByteOffset(text, bounds.from),
    to: utf16OffsetToUtf8ByteOffset(text, bounds.to)
  };
}

function toUtf16SyntaxNode(node: SyntaxNodeLike, text: string, parent: SyntaxNodeLike | null = null): SyntaxNodeLike {
  const children: SyntaxNodeLike[] = [];
  const converted: SyntaxNodeLike = {
    startIndex: utf8ByteOffsetToUtf16Offset(text, node.startIndex),
    endIndex: utf8ByteOffsetToUtf16Offset(text, node.endIndex),
    parent,
    namedChildren: children
  };

  for (const child of node.namedChildren ?? []) {
    children.push(toUtf16SyntaxNode(child, text, converted));
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

async function initialize(parserWasmUrl: string, parserRuntimeUrl: string | undefined, languageWasmUrl: string, source: string): Promise<void> {
  const parserModule = await loadParserModule(parserRuntimeUrl, parserWasmUrl);

  await parserModule.Parser.init({
    locateFile() {
      return parserWasmUrl;
    }
  });

  const language = await parserModule.Language.load(languageWasmUrl);
  parser = new parserModule.Parser();
  parser.setLanguage(language);
  query = new parserModule.Query(language, source) as QueryLike;
}

function parseText(text: string, revision: number): void {
  if (!parser) {
    throw new Error("tree-sitter parser not ready");
  }

  currentText = text;
  currentRevision = revision;
  currentTree?.delete();
  currentTree = parser.parse(text) as TreeLike;
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
  currentTree = parser.parse(text, previousTree) as TreeLike;
  previousTree.delete();
}

function buildHighlights(lines: { fromLine: number; toLine: number }, revision: number): HighlightSpan[] {
  if (!query || !currentTree || revision !== currentRevision) {
    return [];
  }

  const bounds = viewportByteBounds(currentText, lines);
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
      .map((span) => ({
        ...utf8ByteRangeToUtf16Range(currentText, span),
        role: span.role
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

  const root = toUtf16SyntaxNode(currentTree.rootNode as SyntaxNodeLike, currentText);
  return mode === "expand"
    ? expandSyntaxSelection(root, selection)
    : shrinkSyntaxSelection(root, selection, activeOffset);
}

parentPort?.on("message", async (payload: TreeSitterWorkerMessage) => {
  try {
    switch (payload.type) {
      case "init":
        await initialize(payload.parserWasmUrl, payload.parserRuntimeUrl, payload.languageWasmUrl, payload.query);
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
