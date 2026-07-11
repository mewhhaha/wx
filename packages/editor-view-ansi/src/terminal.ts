import { createEditorController, normalizeLanguageServices } from "@mewhhaha/wx-controller";
import { languageProviderToServices } from "@mewhhaha/wx-language";
import { defaultTheme, normalizeCommandThemes } from "@mewhhaha/wx-theme";

import { createAnsiFramePatch } from "./damage";
import { createEditorAnsiFrameSnapshot, createEditorAnsiWorkspaceFrameSnapshot } from "./frame";
import type {
  AnsiEditorMirror,
  AnsiEditorTerminal,
  AnsiFramePatch,
  AnsiFrameSnapshot,
  AnsiTerminalMetrics,
  CreateAnsiEditorMirrorOptions,
  CreateAnsiEditorTerminalOptions
} from "./terminal-types";

const ANSI_ENTER_ALT = "\u001b[?1049h\u001b[?25l\u001b[2J\u001b[H";
const ANSI_EXIT_ALT = "\u001b[0m\u001b[?25h\u001b[?1049l";
const ANSI_RESTORE = "\u001b[0m\u001b[?25h";
const encoder = new TextEncoder();

function normalizeIndentGuides(input: CreateAnsiEditorMirrorOptions["indentGuides"]) {
  return {
    render: input?.render ?? false,
    character: input?.character ?? "│",
    skipLevels: input?.skipLevels ?? 0,
    indentWidth: input?.indentWidth ?? 2
  };
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
  target.removeListener?.(event, listener);
}

const ANSI_KEY_SEQUENCES: readonly { sequence: string; key: string }[] = [
  { sequence: "\u001b[A", key: "ArrowUp" },
  { sequence: "\u001b[B", key: "ArrowDown" },
  { sequence: "\u001b[C", key: "ArrowRight" },
  { sequence: "\u001b[D", key: "ArrowLeft" },
  { sequence: "\u001b[H", key: "Home" },
  { sequence: "\u001bOH", key: "Home" },
  { sequence: "\u001b[F", key: "End" },
  { sequence: "\u001bOF", key: "End" },
  { sequence: "\u001b[5~", key: "PageUp" },
  { sequence: "\u001b[6~", key: "PageDown" },
  { sequence: "\u001b[3~", key: "Delete" },
  { sequence: "\u001b[Z", key: "Shift+Tab" },
  { sequence: "\u001bOQ", key: "F2" },
  { sequence: "\u001b[12~", key: "F2" }
];

type ParsedAnsiInput = { kind: "key"; key: string; next: number } | { kind: "incomplete" };

function parseAnsiInputAt(text: string, index: number, final: boolean): ParsedAnsiInput {
  const slice = text.slice(index);
  for (const entry of ANSI_KEY_SEQUENCES) {
    if (slice.startsWith(entry.sequence)) {
      return { kind: "key", key: entry.key, next: index + entry.sequence.length };
    }
  }
  if (!final && slice.startsWith("\u001b") && ANSI_KEY_SEQUENCES.some((entry) => entry.sequence.startsWith(slice))) {
    return { kind: "incomplete" };
  }

  const codePoint = text.codePointAt(index);
  const char = codePoint === undefined ? "" : String.fromCodePoint(codePoint);
  const next = index + char.length;
  const code = char.charCodeAt(0);
  if (char === "\u001b") {
    const nextCodePoint = text.codePointAt(next);
    const nextChar = nextCodePoint === undefined ? "" : String.fromCodePoint(nextCodePoint);
    if (nextChar && nextChar !== "[" && nextChar !== "O") {
      return { kind: "key", key: `Alt+${nextChar}`, next: next + nextChar.length };
    }
    if (!final && nextChar && (nextChar === "[" || nextChar === "O")) {
      const tail = slice.slice(2);
      const hasFinalByte = Array.from(tail).some((value) => {
        const candidate = value.charCodeAt(0);
        return candidate >= 0x40 && candidate <= 0x7e;
      });
      if (!hasFinalByte) return { kind: "incomplete" };
    }
    if (!final && !nextChar) return { kind: "incomplete" };
    return { kind: "key", key: "Escape", next };
  }
  if (char === "\r" || char === "\n") return { kind: "key", key: "Enter", next };
  if (char === "\t") return { kind: "key", key: "Tab", next };
  if (char === "\u007f") return { kind: "key", key: "Backspace", next };
  if (code === 0) return { kind: "key", key: "Ctrl+Space", next };
  if (code >= 1 && code <= 26) return { kind: "key", key: `Ctrl+${String.fromCharCode(96 + code)}`, next };
  return { kind: "key", key: char, next };
}

export function parseAnsiInput(chunk: Uint8Array | string): string[] {
  const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
  const keys: string[] = [];
  for (let index = 0; index < text.length; ) {
    const parsed = parseAnsiInputAt(text, index, true);
    if (parsed.kind === "incomplete") break;
    if (parsed.key) keys.push(parsed.key);
    index = parsed.next;
  }
  return keys;
}

function getContentCols(cols: number, lineCount: number): { gutterCols: number; contentCols: number } {
  const digits = Math.max(2, String(Math.max(1, lineCount)).length);
  const gutterCols = digits + 4;
  return { gutterCols, contentCols: Math.max(1, cols - gutterCols) };
}

function createMetrics(): AnsiTerminalMetrics {
  return {
    bytesWritten: 0,
    writes: 0,
    fullRepaints: 0,
    rowPatches: 0,
    cursorPatches: 0,
    skippedFrames: 0,
    damagedRows: 0,
    lastWriteBytes: 0,
    outputQueueDepth: 0,
    maxOutputQueueDepth: 0,
    maxOutputQueueAgeMs: 0,
    inputQueueDepth: 0,
    maxInputQueueDepth: 0,
    maxInputQueueAgeMs: 0,
    inputBacklogBytes: 0,
    maxInputBacklogBytes: 0,
    inputBacklogAgeMs: 0,
    maxInputBacklogAgeMs: 0,
    inputPausedCount: 0,
    inputCommands: 0,
    desynchronizations: 0
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null && "then" in value;
}

interface PendingFrame {
  snapshot: AnsiFrameSnapshot;
  forceFull: boolean;
  prefix: string;
  enqueuedAt: number;
}

interface PendingControl {
  text: string;
  enqueuedAt: number;
}

export function createAnsiEditorMirror(options: CreateAnsiEditorMirrorOptions): AnsiEditorMirror {
  if (options.controller !== undefined && options.keymap !== undefined) {
    throw new Error("createAnsiEditorMirror cannot apply keymap when controller is supplied; configure the controller instead");
  }
  const controller =
    options.controller ??
    createEditorController({
      value: options.value ?? "",
      filePath: options.filePath,
      languageRegistry: options.languageRegistry,
      keymap: options.keymap
    });
  const indentGuides = normalizeIndentGuides(options.indentGuides);
  const now = options.now ?? (() => performance.now());
  const metrics = createMetrics();
  const idleWaiters = new Set<() => void>();
  let theme = options.theme ?? defaultTheme;
  let cols = Math.max(1, options.cols);
  let rows = Math.max(2, options.rows);
  let mounted = false;
  let destroyed = false;
  let pendingRender = false;
  let forceFullNext = true;
  let outputInFlight = false;
  let pendingFrame: PendingFrame | null = null;
  let pendingControl: PendingControl | null = null;
  let committedSnapshot: AnsiFrameSnapshot | null = null;
  let unsubscribe = () => {};

  const hasExplicitLanguage = options.language !== undefined || options.languageServices !== undefined;
  const normalizedLanguageServices = normalizeLanguageServices(
    options.languageServices ?? languageProviderToServices(options.language ?? null)
  );
  if (options.languageRegistry !== undefined) controller.setLanguageRegistry(options.languageRegistry);
  if (options.filePath !== undefined) controller.setFilePath(options.filePath);
  if (options.host !== undefined) controller.setHostServices(options.host);
  if (options.theme) controller.setThemeName(options.theme.name);
  if (hasExplicitLanguage) controller.setLanguageServices(normalizedLanguageServices);

  const isIdle = () => !pendingRender && !outputInFlight && pendingFrame === null && pendingControl === null;
  const notifyIdle = () => {
    if (!isIdle()) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };
  const publishMetrics = () => options.onMetrics?.({ ...metrics });
  const updateOutputDepth = () => {
    metrics.outputQueueDepth = (outputInFlight ? 1 : 0) + (pendingFrame ? 1 : 0);
    metrics.maxOutputQueueDepth = Math.max(metrics.maxOutputQueueDepth, metrics.outputQueueDepth);
    publishMetrics();
  };
  const recordAcceptedWrite = (text: string, patch: AnsiFramePatch | null) => {
    const bytes = encoder.encode(text).byteLength;
    metrics.bytesWritten += bytes;
    metrics.lastWriteBytes = bytes;
    metrics.writes += 1;
    if (patch?.kind === "full") metrics.fullRepaints += 1;
    else if (patch?.kind === "rows") metrics.rowPatches += 1;
    else if (patch?.kind === "cursor") metrics.cursorPatches += 1;
    if (patch) metrics.damagedRows += patch.damagedRows.length;
  };
  const recordWriteFailure = (error: unknown) => {
    committedSnapshot = null;
    forceFullNext = true;
    metrics.desynchronizations += 1;
    options.onWriteError?.(error);
  };

  const syncViewportMetrics = () => {
    const { contentCols } = getContentCols(cols, controller.getState().doc.lineCount);
    controller.setViewportMetrics({
      visibleRowCapacity: Math.max(1, rows - 2),
      wrapColumns: contentCols,
      softWrap: controller.getPresentationState().viewport.softWrap
    });
  };

  const buildSnapshot = (): AnsiFrameSnapshot => {
    const workspace = controller.getWorkspacePresentationState();
    return workspace.panes.length > 1
      ? createEditorAnsiWorkspaceFrameSnapshot({ workspace, theme, cols, rows, indentGuides })
      : createEditorAnsiFrameSnapshot({
          state: controller.getState(),
          presentation: controller.getPresentationState(),
          theme,
          cols,
          rows,
          indentGuides
        });
  };

  let pumpOutput = () => {};
  const startWrite = (
    text: string,
    enqueuedAt: number,
    patch: AnsiFramePatch | null,
    accepted: () => void
  ) => {
    outputInFlight = true;
    metrics.maxOutputQueueAgeMs = Math.max(metrics.maxOutputQueueAgeMs, Math.max(0, now() - enqueuedAt));
    updateOutputDepth();
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error === undefined) {
        recordAcceptedWrite(text, patch);
        accepted();
      } else {
        recordWriteFailure(error);
      }
      outputInFlight = false;
      updateOutputDepth();
      pumpOutput();
      notifyIdle();
    };

    try {
      const result = options.write(text);
      if (isThenable(result)) void Promise.resolve(result).then(() => finish(), (error) => finish(error));
      else finish();
    } catch (error) {
      finish(error);
    }
  };

  pumpOutput = () => {
    if (outputInFlight) return;
    if (pendingControl) {
      const control = pendingControl;
      pendingControl = null;
      startWrite(control.text, control.enqueuedAt, null, () => {});
      return;
    }
    if (!pendingFrame) {
      updateOutputDepth();
      notifyIdle();
      return;
    }

    const frame = pendingFrame;
    pendingFrame = null;
    const patch = createAnsiFramePatch(committedSnapshot, frame.snapshot, { forceFull: frame.forceFull });
    const text = `${frame.prefix}${patch.text}`;
    if (!text) {
      committedSnapshot = frame.snapshot;
      metrics.skippedFrames += 1;
      updateOutputDepth();
      pumpOutput();
      return;
    }
    startWrite(text, frame.enqueuedAt, patch, () => {
      committedSnapshot = frame.snapshot;
    });
  };

  const enqueueCurrentFrame = (forceFull = false, prefix = "") => {
    if (!mounted) return;
    const next: PendingFrame = {
      snapshot: buildSnapshot(),
      forceFull: forceFull || forceFullNext,
      prefix,
      enqueuedAt: now()
    };
    forceFullNext = false;
    if (pendingFrame) {
      next.forceFull ||= pendingFrame.forceFull;
      next.prefix = `${pendingFrame.prefix}${next.prefix}`;
      next.enqueuedAt = Math.min(next.enqueuedAt, pendingFrame.enqueuedAt);
      metrics.skippedFrames += 1;
    }
    pendingFrame = next;
    updateOutputDepth();
    pumpOutput();
  };

  const scheduleRender = () => {
    if (!mounted || pendingRender) return;
    pendingRender = true;
    queueMicrotask(() => {
      pendingRender = false;
      if (mounted) enqueueCurrentFrame();
      notifyIdle();
    });
  };

  return {
    mount() {
      if (mounted) return;
      mounted = true;
      destroyed = false;
      committedSnapshot = null;
      forceFullNext = true;
      syncViewportMetrics();
      unsubscribe = controller.subscribe(scheduleRender);
      enqueueCurrentFrame(true, options.enterAltScreen ?? true ? ANSI_ENTER_ALT : "\u001b[?25h");
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      mounted = false;
      pendingRender = false;
      pendingFrame = null;
      unsubscribe();
      unsubscribe = () => {};
      committedSnapshot = null;
      pendingControl = {
        text: options.enterAltScreen ?? true ? ANSI_EXIT_ALT : ANSI_RESTORE,
        enqueuedAt: now()
      };
      updateOutputDepth();
      pumpOutput();
    },
    resize(nextViewport) {
      cols = Math.max(1, nextViewport.cols);
      rows = Math.max(2, nextViewport.rows);
      forceFullNext = true;
      syncViewportMetrics();
      scheduleRender();
    },
    setTheme(nextTheme) {
      if (nextTheme === theme) return;
      theme = nextTheme;
      forceFullNext = true;
      scheduleRender();
    },
    renderNow() {
      enqueueCurrentFrame(true);
    },
    resume() {
      forceFullNext = true;
      enqueueCurrentFrame(true);
    },
    markDesynchronized() {
      committedSnapshot = null;
      forceFullNext = true;
      metrics.desynchronizations += 1;
      enqueueCurrentFrame(true);
    },
    getMetrics() {
      return { ...metrics };
    },
    whenIdle() {
      if (isIdle()) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.add(resolve));
    }
  };
}

export function createAnsiEditorTerminal(options: CreateAnsiEditorTerminalOptions): AnsiEditorTerminal {
  if (options.controller !== undefined && options.keymap !== undefined) {
    throw new Error("createAnsiEditorTerminal cannot apply keymap when controller is supplied; configure the controller instead");
  }
  const controller = options.controller ?? createEditorController({
    value: options.value ?? "",
    filePath: options.filePath,
    languageRegistry: options.languageRegistry,
    keymap: options.keymap
  });
  const input = options.input;
  const output = options.output;
  const availableThemes = normalizeCommandThemes(options.availableThemes, options.theme ?? defaultTheme);
  const exit = options.exit ?? (() => {});
  const now = options.now ?? (() => performance.now());
  const inputQueueLimit = Math.max(1, options.inputQueueLimit ?? 256);
  const inputLowWater = Math.max(0, Math.floor(inputQueueLimit / 2));
  const escapeSequenceTimeoutMs = Math.max(0, options.escapeSequenceTimeoutMs ?? 25);
  const inputDecoder = new TextDecoder();
  const inputQueue: Array<{ key: string; enqueuedAt: number; bytes: number }> = [];
  const inputIdleWaiters = new Set<() => void>();
  let mounted = false;
  let destroyed = false;
  let drainingInput = false;
  let inputPaused = false;
  let activeInput: { key: string; enqueuedAt: number; bytes: number } | null = null;
  let bufferedInput = "";
  let bufferedInputOffset = 0;
  let bufferedInputBytes = 0;
  let bufferedInputSince = 0;
  let queuedInputBytes = 0;
  let escapeSequenceTimer: ReturnType<typeof setTimeout> | null = null;
  let inputCommands = 0;
  let inputPausedCount = 0;
  let maxInputQueueDepth = 0;
  let maxInputQueueAgeMs = 0;
  let maxInputBacklogBytes = 0;
  let maxInputBacklogAgeMs = 0;
  let mirror!: AnsiEditorMirror;

  const inputDepth = () => inputQueue.length + (activeInput ? 1 : 0);
  const inputBacklogBytes = () => bufferedInputBytes + queuedInputBytes + (activeInput?.bytes ?? 0);
  const oldestInputTimestamp = () => {
    const values = [
      activeInput?.enqueuedAt,
      inputQueue[0]?.enqueuedAt,
      bufferedInputBytes > 0 ? bufferedInputSince : undefined
    ].filter((value): value is number => value !== undefined);
    return values.length > 0 ? Math.min(...values) : null;
  };
  const inputBacklogAge = () => {
    const oldest = oldestInputTimestamp();
    return oldest === null ? 0 : Math.max(0, now() - oldest);
  };
  const updateInputMetrics = () => {
    maxInputQueueDepth = Math.max(maxInputQueueDepth, inputDepth());
    maxInputBacklogBytes = Math.max(maxInputBacklogBytes, inputBacklogBytes());
    maxInputBacklogAgeMs = Math.max(maxInputBacklogAgeMs, inputBacklogAge());
  };
  const inputIsIdle = () =>
    !drainingInput &&
    activeInput === null &&
    inputQueue.length === 0 &&
    bufferedInputBytes === 0 &&
    escapeSequenceTimer === null;
  const notifyInputIdle = () => {
    if (!inputIsIdle()) return;
    for (const resolve of inputIdleWaiters) resolve();
    inputIdleWaiters.clear();
  };
  const getMetrics = (): Readonly<AnsiTerminalMetrics> => {
    updateInputMetrics();
    return {
      ...mirror.getMetrics(),
      inputQueueDepth: inputDepth(),
      maxInputQueueDepth,
      maxInputQueueAgeMs,
      inputBacklogBytes: inputBacklogBytes(),
      maxInputBacklogBytes,
      inputBacklogAgeMs: inputBacklogAge(),
      maxInputBacklogAgeMs,
      inputPausedCount,
      inputCommands
    };
  };
  const publishMetrics = () => options.onMetrics?.(getMetrics());

  const { keymap: _keymap, ...mirrorOptions } = options;
  mirror = createAnsiEditorMirror({
    ...mirrorOptions,
    controller,
    onMetrics: publishMetrics
  });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    mounted = false;
    removeListener(input, "data", handleData);
    removeListener(output ?? {}, "resize", handleResize);
    input.setRawMode?.(false);
    input.pause?.();
    input.close?.();
    if (escapeSequenceTimer) clearTimeout(escapeSequenceTimer);
    escapeSequenceTimer = null;
    inputQueue.length = 0;
    queuedInputBytes = 0;
    activeInput = null;
    bufferedInput = "";
    bufferedInputOffset = 0;
    bufferedInputBytes = 0;
    mirror.destroy();
    notifyInputIdle();
  };

  const handleKey = async (key: string) => {
    if (destroyed) return;
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
    const shiftTab = key === "Shift+Tab";
    const terminalCtrlIAsTab =
      key === "Tab" &&
      stateBeforeKey.mode !== "insert" &&
      !presentationBeforeKey.ui.commandLine.active &&
      !presentationBeforeKey.ui.picker.active &&
      !presentationBeforeKey.ui.completion.active;
    const alt = key.startsWith("Alt+");
    const ctrl = key.startsWith("Ctrl+") || terminalCtrlIAsTab;
    const normalizedKey =
      key === "Ctrl+Space"
        ? " "
        : shiftTab
          ? "Tab"
          : terminalCtrlIAsTab
            ? "i"
            : ctrl
              ? key.slice(5)
              : alt
                ? key.slice(4)
                : key;
    const result = await controller.handleKeyInput(
      {
        key: normalizedKey,
        ctrl,
        alt,
        shift: shiftTab || (normalizedKey.length === 1 && normalizedKey !== normalizedKey.toLowerCase()),
        source: "ansi",
        text: normalizedKey.length === 1 ? normalizedKey : undefined
      },
      { themeNames: availableThemes.map((entry) => entry.name) }
    );

    const presentation = controller.getPresentationState();
    const effectiveThemeName = presentation.ui.previewTheme ?? result.themeName ?? presentation.themeName;
    if (effectiveThemeName) {
      const nextTheme = availableThemes.find((entry) => entry.name === effectiveThemeName);
      if (nextTheme) mirror.setTheme(nextTheme);
    }
    if (result.quit) {
      destroy();
      exit(0);
    }
  };

  const pauseInput = () => {
    if (inputPaused) return;
    inputPaused = true;
    inputPausedCount += 1;
    input.pause?.();
    publishMetrics();
  };
  const resumeInput = () => {
    if (!inputPaused || destroyed || !mounted) return;
    inputPaused = false;
    input.resume();
  };
  const cancelEscapeSequenceTimer = () => {
    if (escapeSequenceTimer) clearTimeout(escapeSequenceTimer);
    escapeSequenceTimer = null;
  };
  let drainInput = () => {};
  const scheduleEscapeSequenceTimer = () => {
    if (escapeSequenceTimer || destroyed) return;
    escapeSequenceTimer = setTimeout(() => {
      escapeSequenceTimer = null;
      fillInputQueue(true);
      drainInput();
      notifyInputIdle();
    }, escapeSequenceTimeoutMs);
  };
  const fillInputQueue = (final = false) => {
    let incompleteSequence = false;
    while (inputDepth() < inputQueueLimit && bufferedInputOffset < bufferedInput.length) {
      const start = bufferedInputOffset;
      const parsed = parseAnsiInputAt(bufferedInput, start, final);
      if (parsed.kind === "incomplete") {
        incompleteSequence = true;
        scheduleEscapeSequenceTimer();
        break;
      }
      const sourceBytes = encoder.encode(bufferedInput.slice(start, parsed.next)).byteLength;
      bufferedInputOffset = parsed.next;
      bufferedInputBytes = Math.max(0, bufferedInputBytes - sourceBytes);
      if (parsed.key) {
        inputQueue.push({ key: parsed.key, enqueuedAt: bufferedInputSince, bytes: sourceBytes });
        queuedInputBytes += sourceBytes;
      }
    }
    if (bufferedInputOffset >= bufferedInput.length) {
      bufferedInput = "";
      bufferedInputOffset = 0;
      bufferedInputBytes = 0;
      bufferedInputSince = 0;
      cancelEscapeSequenceTimer();
    } else if (bufferedInputOffset > 0) {
      bufferedInput = bufferedInput.slice(bufferedInputOffset);
      bufferedInputOffset = 0;
    }
    updateInputMetrics();
    if (incompleteSequence && inputDepth() < inputQueueLimit) {
      // The retained prefix is at most the longest supported escape sequence.
      resumeInput();
    } else if (bufferedInputBytes === 0 && inputDepth() <= inputLowWater) {
      resumeInput();
    } else {
      pauseInput();
    }
    publishMetrics();
  };

  drainInput = () => {
    if (drainingInput || destroyed) return;
    drainingInput = true;
    void (async () => {
      try {
        while (!destroyed) {
          fillInputQueue();
          const entry = inputQueue.shift();
          if (!entry) break;
          queuedInputBytes = Math.max(0, queuedInputBytes - entry.bytes);
          activeInput = entry;
          maxInputQueueAgeMs = Math.max(maxInputQueueAgeMs, Math.max(0, now() - entry.enqueuedAt));
          updateInputMetrics();
          publishMetrics();
          try {
            await handleKey(entry.key);
          } catch {
            if (!destroyed) controller.setBottomMessage({ tone: "error", text: "Terminal input failed" });
          }
          activeInput = null;
          inputCommands += 1;
          fillInputQueue();
          publishMetrics();
        }
      } finally {
        activeInput = null;
        drainingInput = false;
        if (!destroyed && (inputQueue.length > 0 || (bufferedInputBytes > 0 && escapeSequenceTimer === null))) {
          drainInput();
        }
        else notifyInputIdle();
      }
    })();
  };

  function handleData(chunk: Uint8Array | string) {
    if (destroyed) return;
    // Pause before retaining the delivered transport chunk. A compliant Readable
    // therefore contributes at most one chunk beyond the fixed parsed window.
    pauseInput();
    cancelEscapeSequenceTimer();
    const text = typeof chunk === "string" ? chunk : inputDecoder.decode(chunk, { stream: true });
    if (!text) {
      resumeInput();
      return;
    }
    if (!bufferedInput) bufferedInputSince = now();
    else if (bufferedInputOffset > 0) {
      bufferedInput = bufferedInput.slice(bufferedInputOffset);
      bufferedInputOffset = 0;
    }
    bufferedInput += text;
    bufferedInputBytes += encoder.encode(text).byteLength;
    updateInputMetrics();
    fillInputQueue();
    drainInput();
  }

  function handleResize() {
    if (!output) return;
    mirror.resize({ cols: Math.max(1, output.columns ?? 80), rows: Math.max(2, output.rows ?? 24) });
  }

  return {
    mount() {
      if (mounted) return;
      mounted = true;
      destroyed = false;
      mirror.mount();
      input.setRawMode?.(true);
      input.pause?.();
      input.on("data", handleData);
      output?.on?.("resize", handleResize);
      inputPaused = false;
      input.resume();
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
    },
    resume() {
      mirror.resume();
      resumeInput();
    },
    markDesynchronized() {
      mirror.markDesynchronized();
    },
    getMetrics,
    async whenIdle() {
      while (true) {
        if (!inputIsIdle()) await new Promise<void>((resolve) => inputIdleWaiters.add(resolve));
        await mirror.whenIdle();
        if (inputIsIdle()) return;
      }
    }
  };
}
