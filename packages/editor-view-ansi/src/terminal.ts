import { createEditorController } from "../../editor-controller/src/index";
import {
  languageProviderToServices,
  type EditorLanguageServiceInput,
  type EditorLanguageServices
} from "../../editor-language/src/index";
import { defaultTheme, type ThemeSpec } from "../../editor-theme/src/index";

import { renderEditorAnsiFrame } from "./frame";
import type {
  AnsiEditorMirror,
  AnsiEditorTerminal,
  CreateAnsiEditorMirrorOptions,
  CreateAnsiEditorTerminalOptions
} from "./index";

const ANSI_ENTER_ALT = "\u001b[?1049h\u001b[2J\u001b[H";
const ANSI_EXIT_ALT = "\u001b[0m\u001b[?25h\u001b[?1049l";

function normalizeIndentGuides(input: CreateAnsiEditorMirrorOptions["indentGuides"]) {
  return {
    render: input?.render ?? false,
    character: input?.character ?? "│",
    skipLevels: input?.skipLevels ?? 0,
    indentWidth: input?.indentWidth ?? 2
  };
}

function normalizeLanguageServices(input: EditorLanguageServiceInput | null | undefined): EditorLanguageServices[] {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? [...input] : [input];
}

function normalizeCommandThemes(themes: readonly ThemeSpec[] | undefined, activeTheme: ThemeSpec): ThemeSpec[] {
  const seen = new Set<string>();
  const nextThemes: ThemeSpec[] = [];

  for (const theme of [activeTheme, defaultTheme, ...(themes ?? [])]) {
    const key = theme.name.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextThemes.push(theme);
  }

  return nextThemes;
}

function removeListener<T extends (...args: never[]) => void>(
  target: { off?(event: string, listener: T): unknown; removeListener?(event: string, listener: T): unknown },
  event: string,
  listener: T
): void {
  if (target.off) {
    target.off(event, listener);
    return;
  }

  if (target.removeListener) {
    target.removeListener(event, listener);
  }
}

export function parseAnsiInput(chunk: Buffer | string): string[] {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const keys: string[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const slice = text.slice(index);

    if (slice.startsWith("\u001b[A")) {
      keys.push("ArrowUp");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[B")) {
      keys.push("ArrowDown");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[C")) {
      keys.push("ArrowRight");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[D")) {
      keys.push("ArrowLeft");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[H") || slice.startsWith("\u001bOH")) {
      keys.push("Home");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[F") || slice.startsWith("\u001bOF")) {
      keys.push("End");
      index += 2;
      continue;
    }

    if (slice.startsWith("\u001b[5~")) {
      keys.push("PageUp");
      index += 3;
      continue;
    }

    if (slice.startsWith("\u001b[6~")) {
      keys.push("PageDown");
      index += 3;
      continue;
    }

    if (slice.startsWith("\u001b[3~")) {
      keys.push("Delete");
      index += 3;
      continue;
    }

    const char = text[index] ?? "";
    const code = char.charCodeAt(0);

    if (char === "\u001b") {
      keys.push("Escape");
      continue;
    }

    if (char === "\r" || char === "\n") {
      keys.push("Enter");
      continue;
    }

    if (char === "\t") {
      keys.push("Tab");
      continue;
    }

    if (char === "\u007f") {
      keys.push("Backspace");
      continue;
    }

    if (code >= 1 && code <= 26) {
      keys.push(`Ctrl+${String.fromCharCode(96 + code)}`);
      continue;
    }

    if (char) {
      keys.push(char);
    }
  }

  return keys;
}

function getContentCols(cols: number, lineCount: number): { gutterCols: number; contentCols: number } {
  const digits = Math.max(2, String(Math.max(1, lineCount)).length);
  const gutterCols = digits + 4;
  return {
    gutterCols,
    contentCols: Math.max(1, cols - gutterCols)
  };
}

export function createAnsiEditorMirror(options: CreateAnsiEditorMirrorOptions): AnsiEditorMirror {
  const controller = options.controller ?? createEditorController({ value: options.value ?? "" });
  const write = options.write;
  const indentGuides = normalizeIndentGuides(options.indentGuides);
  let theme = options.theme ?? defaultTheme;
  let cols = Math.max(1, options.cols);
  let rows = Math.max(2, options.rows);
  let mounted = false;
  let pendingRender = false;
  let unsubscribe = () => {};
  const normalizedLanguageServices = normalizeLanguageServices(
    options.languageServices ?? languageProviderToServices(options.language ?? null)
  );

  if (options.filePath !== undefined) {
    controller.setFilePath(options.filePath);
  }

  if (options.host !== undefined) {
    controller.setHostServices(options.host);
  }

  if (options.theme) {
    controller.setThemeName(options.theme.name);
  }

  if (options.language !== undefined || options.languageServices !== undefined) {
    controller.setLanguageServices(normalizedLanguageServices);
  }

  const syncViewportMetrics = () => {
    const { contentCols } = getContentCols(cols, controller.getState().doc.lineCount);
    controller.setViewportMetrics({
      visibleRowCapacity: Math.max(1, rows - 2),
      wrapColumns: contentCols,
      softWrap: controller.getPresentationState().viewport.softWrap
    });
  };

  const renderNow = () => {
    if (!mounted) {
      return;
    }

    write(
      renderEditorAnsiFrame({
        state: controller.getState(),
        presentation: controller.getPresentationState(),
        theme,
        cols,
        rows,
        indentGuides
      })
    );
  };

  const scheduleRender = () => {
    if (!mounted || pendingRender) {
      return;
    }

    pendingRender = true;
    queueMicrotask(() => {
      pendingRender = false;
      renderNow();
    });
  };

  return {
    mount() {
      if (mounted) {
        return;
      }

      mounted = true;
      if (options.enterAltScreen ?? true) {
        write(ANSI_ENTER_ALT);
      } else {
        write("\u001b[?25h");
      }
      syncViewportMetrics();
      unsubscribe = controller.subscribe(() => {
        scheduleRender();
      });
      renderNow();
    },
    destroy() {
      if (!mounted) {
        return;
      }

      mounted = false;
      pendingRender = false;
      unsubscribe();
      unsubscribe = () => {};
      if (options.enterAltScreen ?? true) {
        write(ANSI_EXIT_ALT);
      } else {
        write("\u001b[0m\u001b[?25h");
      }
    },
    resize(nextViewport) {
      cols = Math.max(1, nextViewport.cols);
      rows = Math.max(2, nextViewport.rows);
      syncViewportMetrics();
      scheduleRender();
    },
    setTheme(nextTheme) {
      theme = nextTheme;
      scheduleRender();
    },
    renderNow
  };
}

export function createAnsiEditorTerminal(options: CreateAnsiEditorTerminalOptions): AnsiEditorTerminal {
  const controller = options.controller ?? createEditorController({ value: options.value ?? "" });
  const mirror = createAnsiEditorMirror({
    ...options,
    controller
  });
  const input = options.input;
  const output = options.output;
  const availableThemes = normalizeCommandThemes(options.availableThemes, options.theme ?? defaultTheme);
  const exit = options.exit ?? (() => {});
  let mounted = false;
  let destroyed = false;
  let keyQueue = Promise.resolve();

  const destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    mounted = false;
    removeListener(input, "data", handleData);
    removeListener(output ?? {}, "resize", handleResize);
    input.setRawMode?.(false);
    input.pause?.();
    mirror.destroy();
  };

  const handleKey = async (key: string) => {
    if (destroyed) {
      return;
    }

    if (key === "Ctrl+c") {
      destroy();
      exit(0);
      return;
    }

    if (key === "Ctrl+l") {
      mirror.renderNow();
      return;
    }

    const presentationBeforeKey = controller.getPresentationState();
    const stateBeforeKey = controller.getState();
    const terminalCtrlIAsTab =
      key === "Tab" &&
      stateBeforeKey.mode !== "insert" &&
      !presentationBeforeKey.ui.commandLine.active &&
      !presentationBeforeKey.ui.picker.active;
    const ctrl = key.startsWith("Ctrl+") || terminalCtrlIAsTab;
    const normalizedKey = terminalCtrlIAsTab ? "i" : ctrl ? key.slice(5) : key;
    const result = await controller.handleKeyInput(
      {
        key: normalizedKey,
        ctrl,
        shift: normalizedKey.length === 1 && normalizedKey !== normalizedKey.toLowerCase(),
        source: "ansi",
        text: normalizedKey.length === 1 ? normalizedKey : undefined
      },
      {
        themeNames: availableThemes.map((entry) => entry.name)
      }
    );

    const presentation = controller.getPresentationState();
    const effectiveThemeName = presentation.ui.previewTheme ?? result.themeName ?? presentation.themeName;
    if (effectiveThemeName) {
      const nextTheme = availableThemes.find((entry) => entry.name === effectiveThemeName);
      if (nextTheme) {
        mirror.setTheme(nextTheme);
      }
    }

    if (result.quit) {
      destroy();
      exit(0);
    }
  };

  const handleData = (chunk: Buffer | string) => {
    for (const key of parseAnsiInput(chunk)) {
      keyQueue = keyQueue.then(() => handleKey(key));
    }
  };

  const handleResize = () => {
    if (!output) {
      return;
    }

    mirror.resize({
      cols: Math.max(1, output.columns ?? 80),
      rows: Math.max(2, output.rows ?? 24)
    });
  };

  return {
    mount() {
      if (mounted) {
        return;
      }

      mounted = true;
      destroyed = false;
      mirror.mount();
      input.setEncoding?.("utf8");
      input.setRawMode?.(true);
      input.resume();
      input.on("data", handleData);
      output?.on?.("resize", handleResize);
      controller.setBottomMessage({ tone: "info", text: "Ctrl+C or :q to quit" });
    },
    destroy,
    resize(viewport) {
      mirror.resize(viewport);
    },
    setTheme(theme) {
      mirror.setTheme(theme);
      controller.setThemeName(theme.name);
    },
    renderNow() {
      mirror.renderNow();
    }
  };
}
