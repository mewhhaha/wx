import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createEditorState, createSelection } from "../../editor-core/src/index";

import { buildEditorLayout, buildFlashLabels, buildVisualRows } from "./index";

function collectSearchMatches(text: string, query: string): Array<{ from: number; to: number }> {
  if (!query) {
    return [];
  }

  const pattern = new RegExp(query, "gu");
  const matches: Array<{ from: number; to: number }> = [];
  let result = pattern.exec(text);

  while (result) {
    const matchedText = result[0] ?? "";
    matches.push({ from: result.index, to: result.index + Math.max(1, matchedText.length) });

    if (matchedText.length === 0) {
      pattern.lastIndex = result.index + 1;
    }

    result = pattern.exec(text);
  }

  return matches;
}

function buildVisibleSearchMatchesByLine(
  state: ReturnType<typeof createEditorState>,
  matches: readonly { from: number; to: number }[],
  fromLine = 0,
  toLine = state.doc.lineCount - 1
): Map<number, { from: number; to: number }[]> {
  const next = new Map<number, { from: number; to: number }[]>();

  for (const match of matches) {
    const startLine = state.doc.positionAt(match.from).line;
    const endLine = state.doc.positionAt(Math.max(match.from, match.to - 1)).line;

    if (endLine < fromLine || startLine > toLine) {
      continue;
    }

    for (let line = Math.max(fromLine, startLine); line <= Math.min(toLine, endLine); line += 1) {
      const entry = next.get(line);
      if (entry) {
        entry.push(match);
      } else {
        next.set(line, [match]);
      }
    }
  }

  return next;
}

function withViewport<T extends ReturnType<typeof createInput>>(
  input: T,
  overrides: Partial<T["presentation"]["viewport"]>
): T {
  const viewport = {
    ...input.presentation.viewport,
    ...overrides
  };
  const { visualRows, lineVisualRanges } = buildVisualRows({
    state: input.state,
    viewport: {
      cols: viewport.wrapColumns,
      rows: viewport.visibleRowCapacity,
      topVisualRow: viewport.topVisualRow
    },
    softWrap: viewport.softWrap
  });

  return {
    ...input,
    presentation: {
      ...input.presentation,
      viewport: {
        ...viewport,
        visualRows,
        visibleVisualRows: visualRows.slice(viewport.topVisualRow, viewport.topVisualRow + viewport.visibleRowCapacity),
        lineVisualRanges,
        wrapRevision: input.state.revision
      }
    }
  };
}

function createInput(value: string) {
  const state = createEditorState({ value });
  const viewport = {
    topVisualRow: 0,
    visibleRowCapacity: 12,
    scrolloffRows: 3,
    wrapColumns: 8,
    softWrap: false
  };
  const { visualRows, lineVisualRanges } = buildVisualRows({
    state,
    viewport: {
      cols: viewport.wrapColumns,
      rows: viewport.visibleRowCapacity,
      topVisualRow: viewport.topVisualRow
    },
    softWrap: viewport.softWrap
  });
  return {
    state,
    presentation: {
      filePath: "examples/test.ts",
      themeName: null,
      viewport: {
        ...viewport,
        visualRows,
        visibleVisualRows: visualRows.slice(0, viewport.visibleRowCapacity),
        lineVisualRanges,
        wrapRevision: state.revision
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
        highlightCoverage: new Set<number>(),
        diagnostics: [],
        diagnosticsByLine: new Map(),
        lineChangesByLine: new Map(),
        visibleHighlights: [],
        visibleHighlightsByLine: new Map(),
        visibleDiagnostics: [],
        visibleLineChanges: []
      },
      ui: {
        commandLine: {
          active: false,
          value: "",
          prompt: ":" as const
        },
        commandCompletionIndex: 0,
        commandCompletionItems: [],
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
          tone: "info" as const,
          left: 0,
          top: 0
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
        direction: "forward" as const,
        lastMatch: null,
        matches: [],
        visibleMatchesByLine: new Map()
      },
      jumps: {
        items: [],
        cursor: 0
      },
      registers: {
        unnamed: null,
        search: null,
        named: {},
        selected: null
      }
    },
    hoverAnchor: {
      col: 0,
      row: 0
    },
    indentGuides: {
      render: false,
      character: "|",
      skipLevels: 0,
      indentWidth: 2
    }
  };
}

describe("buildEditorLayout", () => {
  it("builds one visual row per line without wrapping", () => {
    const layout = buildEditorLayout(createInput("alpha\nbeta"));

    expect(layout.document.totalVisualRows).toBe(2);
    expect(layout.document.rows).toHaveLength(2);
    expect(layout.document.rows[0]?.contentRuns.map((run) => run.text).join("")).toBe("alpha");
    expect(layout.document.rows[1]?.gutterRuns[1]?.text).toBe("2");
  });

  it("wraps long lines in soft-wrap mode", () => {
    const layout = buildEditorLayout(withViewport(createInput("abcdefghij"), { softWrap: true, wrapColumns: 4 }));

    expect(layout.document.totalVisualRows).toBe(3);
    expect(layout.document.rows.map((row) => row.contentRuns.map((run) => run.text).join(""))).toEqual([
      "abcd",
      "efgh",
      "ij"
    ]);
    expect(layout.document.rows[1]?.isContinuation).toBe(true);
  });

  it("marks the active row and block cursor in normal mode", () => {
    const layout = buildEditorLayout(createInput("alpha"));

    expect(layout.document.rows[0]?.isActive).toBe(true);
    expect(layout.document.rows[0]?.contentRuns.some((run) => run.cursorBlock)).toBe(true);
  });

  it("emits an insert-mode cursor-line overlay", () => {
    const layout = buildEditorLayout({
      ...createInput("alpha"),
      state: createEditorState({ value: "alpha", mode: "insert" })
    });

    expect(layout.document.rows[0]?.overlays).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "cursor-line", col: 0 })])
    );
  });

  it("marks selected content across wrapped visual rows", () => {
    const input = createInput("abcdefghij");
    const state = createEditorState({ value: "abcdefghij", selection: createSelection(2, 7), mode: "visual" });
    const layout = buildEditorLayout(withViewport({ ...input, state }, { softWrap: true, wrapColumns: 4 }));

    expect(layout.document.rows[0]?.contentRuns.some((run) => run.selected)).toBe(true);
    expect(layout.document.rows[1]?.contentRuns.some((run) => run.selected)).toBe(true);
  });

  it("applies search and current-search tokens", () => {
    const input = createInput("alpha beta alpha");
    const matches = collectSearchMatches(input.state.doc.text, "alpha");
    const layout = buildEditorLayout({
      ...input,
      presentation: {
        ...input.presentation,
        search: {
          query: "alpha",
          direction: "forward",
          lastMatch: { from: 11, to: 16 },
          matches,
          visibleMatchesByLine: buildVisibleSearchMatchesByLine(input.state, matches)
        }
      }
    });

    expect(layout.document.rows[0]?.contentRuns.some((run) => run.searchMatch)).toBe(true);
    expect(layout.document.rows[0]?.contentRuns.some((run) => run.currentSearchMatch)).toBe(true);
  });

  it("renders inline and end-of-line diagnostics", () => {
    const input = createInput("const bad = value;");
    const diagnostics = [
      { from: 0, to: 5, severity: "warning" as const, message: "Warn" },
      { from: 6, to: 9, severity: "error" as const, message: "Err" }
    ];
    const diagnosticsByLine = new Map([[0, diagnostics]]);
    const layout = buildEditorLayout({
      ...input,
      presentation: {
        ...input.presentation,
        language: {
          ...input.presentation.language,
          diagnostics,
          diagnosticsByLine,
          visibleDiagnostics: diagnostics
        }
      }
    });

    expect(layout.document.rows[0]?.overlays).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "inline-diagnostic", text: "Warn" }),
        expect.objectContaining({ kind: "inline-diagnostic", text: "Err" })
      ])
    );
  });

  it("renders flash hints and bottom-row flash state", () => {
    const layout = buildEditorLayout({
      ...createInput("alpha beta gamma"),
      presentation: {
        ...createInput("alpha beta gamma").presentation,
        ui: {
          ...createInput("alpha beta gamma").presentation.ui,
          flash: {
            active: true,
            target: "a",
            input: "a",
            hints: [
              { offset: 0, label: "a" },
              { offset: 4, label: "s" }
            ]
          }
        }
      }
    });

    expect(layout.bottomBar.runs[0]?.text).toBe(",a a");
    expect(layout.document.rows[0]?.overlays.filter((overlay) => overlay.kind === "flash-hint")).toHaveLength(2);
  });

  it("derives status and bottom command rows", () => {
    const layout = buildEditorLayout({
      ...createInput("alpha"),
      presentation: {
        ...createInput("alpha").presentation,
        ui: {
          ...createInput("alpha").presentation.ui,
          commandLine: {
            active: true,
            value: "wq",
            prompt: ":"
          }
        }
      }
    });

    expect(layout.statusBar.find((run) => run.part === "status-mode")?.text).toBe("NOR");
    expect(layout.bottomBar.runs.find((run) => run.part === "command-prompt")?.text).toBe(":");
    expect(layout.bottomBar.runs.find((run) => run.part === "command-text")?.text).toBe("wq");
  });

  it("builds a tooltip panel from hover content", () => {
    const layout = buildEditorLayout({
      ...createInput("alpha"),
      presentation: {
        ...createInput("alpha").presentation,
        ui: {
          ...createInput("alpha").presentation.ui,
          hover: {
            active: true,
            pinned: false,
            offset: 0,
            content: "body line",
            source: "source",
            tone: "warning",
            left: 0,
            top: 0
          }
        }
      },
      hoverAnchor: {
        col: 4,
        row: 2
      }
    });

    expect(layout.panels).toHaveLength(1);
    expect(layout.panels[0]?.anchor).toEqual({ col: 4, row: 2 });
    expect(layout.panels[0]?.rows.flat().map((run) => run.text)).toEqual(["source", "body line"]);
  });

  it("keeps the package free of DOM globals", () => {
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

    expect(source.includes("document.")).toBe(false);
    expect(source.includes("window.")).toBe(false);
    expect(source.includes("HTMLElement")).toBe(false);
  });

  it("provides stable flash labels", () => {
    expect(buildFlashLabels("a", 3)).toHaveLength(3);
  });
});
