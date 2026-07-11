/// <reference lib="deno.ns" />

import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLanguageRegistry, type EditorLanguageServices, type LanguageRegistry } from "@mewhhaha/wx-language";
import { compileKeymap, decodeKeymapConfig, defaultKeymap, KeymapConfigurationError, type KeymapConfig } from "@mewhhaha/wx-controller";

export interface DenoTerminalLanguageConfigEntry { id: string; aliases?: string[]; extensions?: string[]; filenames?: string[]; grammar?: string; wasm?: string; languageWasmPath?: string; queryFile?: string; indentQueryFile?: string; }
export interface DenoTerminalConfig { themeName: string | null; ignoredDirectories: readonly string[]; indentGuides: { render: boolean; character: string; skipLevels: number; indentWidth: number } | null; languageRegistry: LanguageRegistry | null; keymap: KeymapConfig | null; }
interface DenoTerminalConfigFile { theme?: unknown; ignoredDirectories?: unknown; indentGuides?: unknown; languages?: unknown; keymap?: unknown; }
export interface LoadDenoTerminalConfigOptions { createLanguageServices?: (options: { parserWasmUrl: string; languageWasmUrl: string; query: string; indentQuery?: string; owner: "controller" }) => EditorLanguageServices | Promise<EditorLanguageServices>; }

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringArray(value: unknown, field: string, id: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) throw new Error(`Invalid languages entry ${id}: ${field} must be an array of non-empty strings`);
  return [...value] as string[];
}
function languageEntries(value: unknown): DenoTerminalLanguageConfigEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid .wx/config.json: languages must be an array");
  return value.map((candidate, index) => {
    const entry = record(candidate); const id = entry?.id;
    if (!entry || typeof id !== "string" || id.length === 0) throw new Error(`Invalid languages entry ${index}: id must be a non-empty string`);
    const optional = (field: "grammar" | "wasm" | "languageWasmPath" | "queryFile" | "indentQueryFile") => {
      const value = entry[field]; if (value !== undefined && (typeof value !== "string" || value.length === 0)) throw new Error(`Invalid languages entry ${id}: ${field} must be a non-empty string`); return value as string | undefined;
    };
    return { id, aliases: stringArray(entry.aliases, "aliases", id), extensions: stringArray(entry.extensions, "extensions", id), filenames: stringArray(entry.filenames, "filenames", id), grammar: optional("grammar"), wasm: optional("wasm"), languageWasmPath: optional("languageWasmPath"), queryFile: optional("queryFile"), indentQueryFile: optional("indentQueryFile") };
  });
}
function keymapConfig(value: unknown): KeymapConfig | null {
  if (value === undefined) return null;
  const decoded = decodeKeymapConfig(value);
  const compiled = compileKeymap(defaultKeymap, value);
  if (compiled.issues.length > 0) throw new KeymapConfigurationError(compiled.issues);
  return decoded.config;
}
function containedPath(root: string, value: string, label: string): string { const absolute = resolve(root, value); const path = relative(root, absolute); if (path === ".." || path.startsWith("../") || isAbsolute(path)) throw new Error(`${label} escapes .wx/grammars: ${value}`); return absolute; }
async function canonicalGrammarRoot(projectRoot: string, root: string): Promise<string> {
  try {
    const [canonicalProjectRoot, canonicalRoot] = await Promise.all([Deno.realPath(projectRoot), Deno.realPath(root)]);
    const contained = relative(canonicalProjectRoot, canonicalRoot);
    if (contained === ".." || contained.startsWith("../") || isAbsolute(contained)) {
      throw new Error(`.wx/grammars escapes the project root through a symlink: ${root}`);
    }
    return canonicalRoot;
  }
  catch (error) { if (error instanceof Deno.errors.NotFound) throw new Error(`Missing .wx/grammars directory: ${root}`); throw error; }
}
async function requiredFile(root: string, value: string, label: string): Promise<string> {
  const path = containedPath(root, value, label);
  try {
    const info = await Deno.stat(path); if (!info.isFile) throw new Error(`${label} is not a file: ${path}`);
    const canonical = await Deno.realPath(path); const contained = relative(root, canonical);
    if (contained === ".." || contained.startsWith("../") || isAbsolute(contained)) throw new Error(`${label} escapes .wx/grammars through a symlink: ${value}`);
    return canonical;
  }
  catch (error) { if (error instanceof Deno.errors.NotFound) throw new Error(`Missing ${label}: ${path}`); throw error; }
}

/** Loads terminal config. The Tree-sitter adapter is imported only for configured languages. */
export async function loadDenoTerminalConfig(projectRoot: string, options: LoadDenoTerminalConfigOptions = {}): Promise<DenoTerminalConfig> {
  let value: unknown;
  try { value = JSON.parse(await Deno.readTextFile(`${projectRoot}/.wx/config.json`)); }
  catch (error) { if (error instanceof Deno.errors.NotFound) return { themeName: null, ignoredDirectories: [], indentGuides: null, languageRegistry: null, keymap: null }; if (error instanceof SyntaxError) throw new Error(`Invalid JSON in ${projectRoot}/.wx/config.json: ${error.message}`); throw error; }
  const config = record(value) as DenoTerminalConfigFile | null;
  if (!config) throw new Error("Invalid .wx/config.json: expected an object");
  const guides = record(config.indentGuides); const languages = languageEntries(config.languages); const grammarRoot = resolve(projectRoot, ".wx", "grammars");
  let languageRegistry: LanguageRegistry | null = null;
  if (languages.length > 0) {
    const canonicalRoot = await canonicalGrammarRoot(projectRoot, grammarRoot);
    const parserWasmPath = await requiredFile(canonicalRoot, "web-tree-sitter.wasm", "Tree-sitter parser wasm");
    const descriptors = await Promise.all(languages.map(async (entry) => {
      const grammar = entry.grammar ?? entry.id;
      const languageWasmPath = await requiredFile(canonicalRoot, entry.wasm ?? entry.languageWasmPath ?? `${grammar}.wasm`, `grammar wasm for ${entry.id}`);
      const queryPath = await requiredFile(canonicalRoot, entry.queryFile ?? `${grammar}.scm`, `highlight query for ${entry.id}`);
      const indentPath = entry.indentQueryFile === undefined ? null : await requiredFile(canonicalRoot, entry.indentQueryFile, `indent query for ${entry.id}`);
      return { entry, languageWasmPath, query: await Deno.readTextFile(queryPath), ...(indentPath ? { indentQuery: await Deno.readTextFile(indentPath) } : {}) };
    }));
    const createLanguageServices = options.createLanguageServices ?? (await import("@wx/editor-tree-sitter/deno")).createDenoTreeSitterLanguageServices;
    languageRegistry = createLanguageRegistry(await Promise.all(descriptors.map(async ({ entry, languageWasmPath, query, indentQuery }) => ({ id: entry.id, aliases: entry.aliases, extensions: entry.extensions, filenames: entry.filenames, services: await createLanguageServices({ parserWasmUrl: pathToFileURL(parserWasmPath).href, languageWasmUrl: pathToFileURL(languageWasmPath).href, query, ...(indentQuery ? { indentQuery } : {}), owner: "controller" }) }))));
  }
  return { themeName: typeof config.theme === "string" ? config.theme : null, ignoredDirectories: Array.isArray(config.ignoredDirectories) ? config.ignoredDirectories.filter((entry): entry is string => typeof entry === "string") : [], indentGuides: guides ? { render: guides.render !== false, character: typeof guides.character === "string" ? guides.character : "│", skipLevels: typeof guides.skipLevels === "number" ? guides.skipLevels : 1, indentWidth: typeof guides.indentWidth === "number" ? guides.indentWidth : 2 } : null, languageRegistry, keymap: keymapConfig(config.keymap) };
}
