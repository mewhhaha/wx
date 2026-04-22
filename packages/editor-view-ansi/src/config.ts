import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

import {
  createLanguageRegistry,
  type EditorLanguageServices,
  type LanguageRegistry
} from "@mewhhaha/wx-language";
import { createNodeTreeSitterLanguageServices } from "@wx/editor-tree-sitter/node";

export interface WxTerminalConfigFile {
  theme?: string;
  indentGuides?: {
    render?: boolean;
    character?: string;
    skipLevels?: number;
    indentWidth?: number;
  };
  ignoredDirectories?: string[];
}

export interface WxTerminalLanguageConfigEntry {
  id: string;
  extensions?: string[];
  filenames?: string[];
  grammar?: string;
  query?: string;
  queryFile?: string;
  languageWasmPath?: string;
  parserRuntimePath?: string;
  parserWasmPath?: string;
}

interface WxTerminalLanguageConfigFile {
  languages?: WxTerminalLanguageConfigEntry[];
}

interface LoadWxTerminalConfigOptions {
  configDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  workerModuleUrl?: string | URL;
  createLanguageServices?: (options: {
    parserRuntimeUrl?: string;
    parserWasmUrl: string;
    languageWasmUrl: string;
    query: string;
    workerModuleUrl?: string | URL;
  }) => EditorLanguageServices;
}

export interface LoadedWxTerminalConfig {
  configDir: string;
  themeName: string | null;
  indentGuides: WxTerminalConfigFile["indentGuides"] | null;
  ignoredDirectories: readonly string[];
  languageRegistry: LanguageRegistry | null;
}

function resolveOptionalFile(path: string): string | null {
  return existsSync(path) ? path : null;
}

function resolveWebTreeSitterDependencyPath(relativePath: string): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("web-tree-sitter/package.json");
  return resolve(dirname(packageJsonPath), relativePath);
}

function resolveConfigPath(configDir: string, value: string): string {
  return resolve(configDir, value);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }

    throw error;
  }
}

function normalizeLanguagesConfig(input: WxTerminalLanguageConfigFile | WxTerminalLanguageConfigEntry[] | null): WxTerminalLanguageConfigEntry[] {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? input : input.languages ?? [];
}

export function resolveWxConfigDir(options: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
} = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const wxConfigHome = env.WX_CONFIG_HOME;

  if (wxConfigHome) {
    return resolve(wxConfigHome);
  }

  if (platform === "win32") {
    return resolve(env.APPDATA ?? join(homeDir, "AppData", "Roaming"), "wx");
  }

  if (platform === "darwin") {
    return resolve(homeDir, "Library", "Application Support", "wx");
  }

  return resolve(env.XDG_CONFIG_HOME ?? join(homeDir, ".config"), "wx");
}

export async function loadWxTerminalConfig(options: LoadWxTerminalConfigOptions = {}): Promise<LoadedWxTerminalConfig> {
  const configDir = options.configDir ?? resolveWxConfigDir({
    env: options.env,
    platform: options.platform,
    homeDir: options.homeDir
  });
  const configPath = join(configDir, "config.json");
  const languagesPath = join(configDir, "languages.json");
  const grammarDir = join(configDir, "grammars");
  const config = await readJsonFile<WxTerminalConfigFile>(configPath);
  const languagesConfig = normalizeLanguagesConfig(
    await readJsonFile<WxTerminalLanguageConfigFile | WxTerminalLanguageConfigEntry[]>(languagesPath)
  );

  let languageRegistry: LanguageRegistry | null = null;
  if (languagesConfig.length > 0) {
    const parserRuntimeUrl =
      resolveOptionalFile(join(grammarDir, "web-tree-sitter.js")) ?? resolveWebTreeSitterDependencyPath("web-tree-sitter.js");
    const parserWasmUrl =
      resolveOptionalFile(join(grammarDir, "web-tree-sitter.wasm")) ?? resolveWebTreeSitterDependencyPath("web-tree-sitter.wasm");
    const createLanguageServices =
      options.createLanguageServices ??
      ((serviceOptions: {
        parserRuntimeUrl?: string;
        parserWasmUrl: string;
        languageWasmUrl: string;
        query: string;
        workerModuleUrl?: string | URL;
      }) => createNodeTreeSitterLanguageServices(serviceOptions));
    const registrations = await Promise.all(
      languagesConfig.map(async (entry) => {
        const grammarStem = entry.grammar ?? entry.id;
        const languageWasmUrl = resolveConfigPath(
          grammarDir,
          entry.languageWasmPath ?? `${grammarStem}.wasm`
        );
        const query =
          entry.query ??
          (await readFile(resolveConfigPath(grammarDir, entry.queryFile ?? `${grammarStem}.scm`), "utf8"));

        if (!existsSync(languageWasmUrl)) {
          throw new Error(`Missing grammar wasm for ${entry.id}: ${languageWasmUrl}`);
        }

        return {
          id: entry.id,
          extensions: entry.extensions,
          filenames: entry.filenames,
          services: createLanguageServices({
            parserRuntimeUrl: entry.parserRuntimePath ? resolveConfigPath(configDir, entry.parserRuntimePath) : parserRuntimeUrl,
            parserWasmUrl: entry.parserWasmPath ? resolveConfigPath(configDir, entry.parserWasmPath) : parserWasmUrl,
            languageWasmUrl,
            query,
            workerModuleUrl: options.workerModuleUrl
          })
        };
      })
    );

    languageRegistry = createLanguageRegistry(registrations);
  }

  return {
    configDir,
    themeName: config?.theme ?? null,
    indentGuides: config?.indentGuides ?? null,
    ignoredDirectories: config?.ignoredDirectories ?? [],
    languageRegistry
  };
}
