/// <reference lib="deno.ns" />

import { isAbsolute, relative, resolve } from "node:path";

import { createEditorController } from "@mewhhaha/wx-controller";
import { graphiteTheme, mintTheme, phTheme } from "@mewhhaha/wx-theme";

import { loadDenoTerminalConfig } from "./deno-config";
import { createDenoHostServices, resolveDenoProjectRoot } from "./deno-host";
import { createAnsiEditorTerminal } from "./terminal";

const THEMES = [phTheme, graphiteTheme, mintTheme] as const;
const encoder = new TextEncoder();

interface CliOptions { filePath: string | null; themeName: string; themeExplicit: boolean; benchmarkEvents: boolean; }

/** Test-only hooks are passed by an importing harness; ordinary CLI runs never enable them. */
export interface DenoCliTestOptions {
  crashAfterMount?: boolean;
}

function printHelp(): void {
  Deno.stdout.writeSync(encoder.encode([
    "wx (Deno terminal)", "", "Usage:", "  wx [file]", "  wx --theme <name> [file]", "",
    "Permissions:", "  --allow-read --allow-write --allow-run=git", "", "Keys:", "  Ctrl+C  quit", "  :q      quit", "  :w      save"
  ].join("\n") + "\n"));
}

function parseArgs(argv: readonly string[]): CliOptions {
  let filePath: string | null = null;
  let themeName = phTheme.name;
  let themeExplicit = false;
  let benchmarkEvents = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") { printHelp(); return { filePath: null, themeName, themeExplicit, benchmarkEvents }; }
    // Intentionally undocumented: used only by the benchmark harness to expose
    // terminal output/state boundaries without a timing heuristic.
    if (arg === "--benchmark-events") { benchmarkEvents = true; continue; }
    if (arg === "--theme") {
      const next = argv[++index];
      if (!next) throw new Error("Missing value for --theme");
      themeName = next; themeExplicit = true; continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    if (filePath !== null) throw new Error(`Unexpected extra path: ${arg}`);
    filePath = arg;
  }
  return { filePath, themeName, themeExplicit, benchmarkEvents };
}

function filePathWithinRoot(root: string, path: string): string {
  const absolute = resolve(root, path);
  const value = relative(root, absolute);
  if (value === ".." || value.startsWith("../") || isAbsolute(value)) throw new Error(`File path escapes project root: ${path}`);
  return value || ".";
}

function createDenoInput(afterData?: () => void) {
  let listener: ((chunk: Uint8Array) => void) | null = null;
  let reading = false;
  let paused = false;
  let closed = false;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const read = async () => {
    if (reading || closed) return;
    reading = true;
    const reader = Deno.stdin.readable.getReader();
    activeReader = reader;
    try {
      while (!paused && !closed) {
        const result = await reader.read();
        if (result.done) break;
        listener?.(result.value);
        afterData?.();
      }
    } finally {
      if (activeReader === reader) activeReader = null;
      reader.releaseLock();
      reading = false;
      if (!paused && !closed) void read();
    }
  };
  return {
    isTTY: Deno.stdin.isTerminal(),
    on(_event: "data", next: (chunk: Uint8Array) => void) { listener = next; },
    off() { listener = null; },
    resume() { paused = false; void read(); },
    pause() { paused = true; },
    close() {
      closed = true;
      paused = true;
      listener = null;
      void activeReader?.cancel().catch(() => {});
    },
    setRawMode(mode: boolean) { Deno.stdin.setRaw(mode, { cbreak: true }); }
  };
}

/** Run the Deno-native CLI. Kept separate from the Node entrypoint and its optional syntax stack. */
export async function runDenoCli(argv = Deno.args, testOptions: DenoCliTestOptions = {}): Promise<void> {
  const options = parseArgs(argv);
  if (argv.includes("--help") || argv.includes("-h")) return;
  const projectRoot = await resolveDenoProjectRoot();
  const config = await loadDenoTerminalConfig(projectRoot);
  const themeName = options.themeExplicit ? options.themeName : config.themeName ?? options.themeName;
  const theme = THEMES.find((entry) => entry.name === themeName);
  if (!theme) throw new Error(`Unknown theme: ${themeName}`);
  const filePath = options.filePath ? filePathWithinRoot(projectRoot, options.filePath) : null;
  const host = createDenoHostServices({ projectRoot, ignoredDirectories: config.ignoredDirectories });
  let value = "";
  if (filePath) {
    const readFile = host.readFile;
    if (!readFile) throw new Error("Deno host does not provide file reads");
    try {
      const payload = await readFile({ filePath });
      value = typeof payload === "string" ? payload : payload.text;
    }
    catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  }
  if (!Deno.stdin.isTerminal()) throw new Error("wx requires an interactive terminal");
  const controller = createEditorController({ value, filePath: filePath ?? undefined, languageRegistry: config.languageRegistry, keymap: config.keymap ?? undefined });
  controller.setHostServices(host);
  let closed = false;
  let resolveExit: (() => void) | null = null;
  // The benchmark marker is opt-in and emitted only after the terminal reports an
  // output/state boundary. It is an OSC control sequence, not a timer heuristic.
  const benchmarkEvents = options.benchmarkEvents;
  const emitBenchmarkEvent = (boundary: "mounted" | "input") => {
    if (!benchmarkEvents) return;
    const memory = Deno.memoryUsage();
    Deno.stdout.writeSync(encoder.encode(`\x1b]wx-benchmark;${boundary};${memory.heapUsed};${memory.rss}\x07`));
  };
  let terminal!: ReturnType<typeof createAnsiEditorTerminal>;
  const input = createDenoInput(() => { if (benchmarkEvents) void terminal.whenIdle().then(() => emitBenchmarkEvent("input")); });
  terminal = createAnsiEditorTerminal({
    controller, input, write: (text) => { Deno.stdout.writeSync(encoder.encode(text)); },
    theme, availableThemes: THEMES, cols: Deno.consoleSize().columns, rows: Deno.consoleSize().rows,
    enterAltScreen: true, indentGuides: config.indentGuides ?? { render: true, character: "│", skipLevels: 1, indentWidth: 2 },
    exit: () => { closed = true; terminal.destroy(); resolveExit?.(); }
  });
  const cleanup = () => { if (!closed) { closed = true; terminal.destroy(); } resolveExit?.(); };
  const onSignal = () => cleanup();
  const onResize = () => {
    const size = Deno.consoleSize();
    terminal.resize({ cols: size.columns, rows: size.rows });
  };
  Deno.addSignalListener("SIGINT", onSignal);
  Deno.addSignalListener("SIGTERM", onSignal);
  Deno.addSignalListener("SIGWINCH", onResize);
  try {
    terminal.mount();
    await terminal.whenIdle();
    emitBenchmarkEvent("mounted");
    if (testOptions.crashAfterMount) throw new Error("Injected recoverable terminal crash");
    await new Promise<void>((resolve) => { resolveExit = resolve; });
  }
  finally {
    cleanup();
    Deno.removeSignalListener("SIGINT", onSignal);
    Deno.removeSignalListener("SIGTERM", onSignal);
    Deno.removeSignalListener("SIGWINCH", onResize);
  }
}

if (import.meta.main) {
  try { await runDenoCli(); }
  catch (error) { Deno.stderr.writeSync(encoder.encode(`wx: ${error instanceof Error ? error.message : String(error)}\n`)); Deno.exit(1); }
}
