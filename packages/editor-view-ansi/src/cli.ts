import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { createEditorController } from "@mewhhaha/wx-controller";
import { graphiteTheme, mintTheme, phTheme } from "@mewhhaha/wx-theme";

import { loadWxTerminalConfig } from "./config";
import { createNodeHostServices, resolveGitAwareProjectRoot } from "./node-host";
import { createAnsiEditorTerminal } from "./terminal";

const THEMES = [phTheme, graphiteTheme, mintTheme] as const;

interface CliOptions {
  filePath: string | null;
  themeName: string;
  themeExplicit: boolean;
}

function printHelp(): void {
  process.stdout.write(
    [
      "wx",
      "",
      "Usage:",
      "  wx [file]",
      "  wx --theme <name> [file]",
      "",
      "Themes:",
      ...THEMES.map((theme) => `  ${theme.name}`),
      "",
      "Keys:",
      "  Ctrl+C  quit",
      "  :q      quit",
      "  :w      save"
    ].join("\n") + "\n"
  );
}

function parseArgs(argv: readonly string[]): CliOptions {
  let filePath: string | null = null;
  let themeName = phTheme.name;
  let themeExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--theme") {
      const nextThemeName = argv[index + 1];
      if (!nextThemeName) {
        throw new Error("Missing value for --theme");
      }
      themeName = nextThemeName;
      themeExplicit = true;
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (filePath !== null) {
      throw new Error(`Unexpected extra path: ${arg}`);
    }

    filePath = arg;
  }

  return { filePath, themeName, themeExplicit };
}

function normalizeEditorFilePath(projectRoot: string, filePath: string): string {
  const absolute = resolve(projectRoot, filePath);
  if (isAbsolute(filePath)) {
    return filePath;
  }

  const relativePath = relative(projectRoot, absolute);
  return relativePath && relativePath !== "" ? relativePath.replace(/\\/g, "/") : filePath.replace(/\\/g, "/");
}

async function readInitialValue(projectRoot: string, filePath: string | null): Promise<string> {
  if (!filePath) {
    return "";
  }

  try {
    return await readFile(resolve(projectRoot, filePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = await resolveGitAwareProjectRoot(process.cwd());
  const loadedConfig = await loadWxTerminalConfig({
    workerModuleUrl: new URL("./nodeWorker.js", import.meta.url)
  });
  const resolvedThemeName = options.themeExplicit ? options.themeName : loadedConfig.themeName ?? options.themeName;
  const theme = THEMES.find((entry) => entry.name === resolvedThemeName);
  if (!theme) {
    throw new Error(`Unknown theme: ${resolvedThemeName}`);
  }

  const editorFilePath = options.filePath ? normalizeEditorFilePath(projectRoot, options.filePath) : null;
  const controller = createEditorController({
    value: await readInitialValue(projectRoot, editorFilePath),
    filePath: editorFilePath ?? undefined,
    languageRegistry: loadedConfig.languageRegistry
  });

  controller.setHostServices(
    createNodeHostServices({
      projectRoot,
      ignoredDirectories: loadedConfig.ignoredDirectories
    })
  );

  const terminal = createAnsiEditorTerminal({
    controller,
    input: process.stdin,
    output: process.stdout,
    write: (text) => process.stdout.write(text),
    theme,
    availableThemes: THEMES,
    cols: process.stdout.columns ?? 100,
    rows: process.stdout.rows ?? 28,
    enterAltScreen: true,
    indentGuides: loadedConfig.indentGuides ?? {
      render: true,
      character: "│",
      skipLevels: 1,
      indentWidth: 2
    },
    exit: (code = 0) => process.exit(code)
  });

  terminal.mount();
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`wx: ${message}\n`);
  process.exit(1);
});
