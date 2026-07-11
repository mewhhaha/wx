import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";
import {
  wxHostRoutes,
  type WxHostErrorResponse,
  type WxLineChangeKind,
  type WxLineChangesRequest,
  type WxReadFileRequest,
  type WxSearchFilesRequest,
  type WxSearchWorkspaceRequest,
  type WxWriteFileRequest
} from "./src/host-contract";

type LineChange = { line: number; kind: WxLineChangeKind };

class HostBridgeError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: WxHostErrorResponse["error"]["code"], message: string) {
    super(message);
  }
}

function readRequestBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

function splitLines(text: string): string[] { return text.split("\n"); }

function patienceAnchors(baseLines: readonly string[], currentLines: readonly string[]): Array<[number, number]> {
  const baseOccurrences = new Map<string, { count: number; index: number }>();
  const currentOccurrences = new Map<string, { count: number; index: number }>();
  for (let index = 0; index < baseLines.length; index += 1) {
    const line = baseLines[index]!;
    const entry = baseOccurrences.get(line);
    baseOccurrences.set(line, entry ? { count: entry.count + 1, index: entry.index } : { count: 1, index });
  }
  for (let index = 0; index < currentLines.length; index += 1) {
    const line = currentLines[index]!;
    const entry = currentOccurrences.get(line);
    currentOccurrences.set(line, entry ? { count: entry.count + 1, index: entry.index } : { count: 1, index });
  }

  const candidates: Array<[number, number]> = [];
  for (const [line, base] of baseOccurrences) {
    const current = currentOccurrences.get(line);
    if (base.count === 1 && current?.count === 1) candidates.push([base.index, current.index]);
  }
  candidates.sort((left, right) => left[0] - right[0]);

  // Longest increasing subsequence of current indexes: O(n log n) memory/time.
  const tails: number[] = [];
  const previous = new Array<number>(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index += 1) {
    const currentIndex = candidates[index]![1];
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[tails[middle]!]![1] < currentIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  }
  if (tails.length === 0) return [];
  const result: Array<[number, number]> = [];
  for (let index = tails.at(-1)!; index >= 0; index = previous[index]!) result.push(candidates[index]!);
  return result.reverse();
}

/**
 * Linear-space patience diff for gutter markers. Duplicate-only regions use a
 * conservative changed-block fallback; the browser never runs an LCS matrix.
 */
export function computeLineChanges(baseText: string, currentText: string): LineChange[] {
  const baseLines = splitLines(baseText);
  const currentLines = splitLines(currentText);
  let prefix = 0;
  while (prefix < baseLines.length && prefix < currentLines.length && baseLines[prefix] === currentLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < baseLines.length - prefix &&
    suffix < currentLines.length - prefix &&
    baseLines[baseLines.length - suffix - 1] === currentLines[currentLines.length - suffix - 1]
  ) suffix += 1;
  const middleBase = baseLines.slice(prefix, baseLines.length - suffix);
  const middleCurrent = currentLines.slice(prefix, currentLines.length - suffix);
  const matches = patienceAnchors(middleBase, middleCurrent).map(([base, current]) => [base + prefix, current + prefix] as [number, number]);
  for (let index = 0; index < prefix; index += 1) matches.unshift([prefix - index - 1, prefix - index - 1]);
  for (let index = suffix; index > 0; index -= 1) matches.push([baseLines.length - index, currentLines.length - index]);
  const anchors: Array<[number, number]> = [[-1, -1], ...matches, [baseLines.length, currentLines.length]];
  const changes: LineChange[] = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const [baseAnchor, currentAnchor] = anchors[index]!;
    const [nextBase, nextCurrent] = anchors[index + 1]!;
    const baseCount = nextBase - baseAnchor - 1;
    const currentCount = nextCurrent - currentAnchor - 1;
    if (baseCount > currentCount) { changes.push({ line: Math.max(0, currentAnchor), kind: "deleted" }); }
    if (currentCount > 0) {
      const kind: WxLineChangeKind = baseCount === 0 ? "added" : "modified";
      for (let line = currentAnchor + 1; line < nextCurrent; line += 1) { changes.push({ line, kind }); }
    }
  }
  return changes;
}

function isWithin(root: string, target: string): boolean { return target === root || target.startsWith(`${root}${sep}`); }

function parseJsonObject(rawBody: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(rawBody);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new HostBridgeError(400, "bad_request", "Expected a JSON object request body.");
  }
}

function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) throw new HostBridgeError(400, "bad_request", `Expected a non-empty string ${field}.`);
  return value;
}

function requireText(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string") throw new HostBridgeError(400, "bad_request", `Expected a string ${field}.`);
  return value;
}

export interface WxDevBridgeOptions {
  /** Test-only seam used to prove path replacement cannot escape the workspace. */
  beforeFileOpen?: (filePath: string) => void;
  /** Test-only seam used to prove the in-process file walker handles a missing ripgrep executable. */
  runRipgrep?: (cwd: string) => string;
}

export function createWxDevBridge(repoRoot: string, options: WxDevBridgeOptions = {}): Plugin {
  const realRoot = realpathSync(repoRoot);
  const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"]);
  const maximumFallbackFiles = 10_000;

  function isNoFollowError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ELOOP");
  }

  function hasNodeCode(error: unknown, code: string): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
  }

  /**
   * Open a workspace file through a chain of no-follow directory descriptors.
   * Node does not expose openat(2), but /proc/self/fd lets Linux CI resolve each
   * child relative to an already-verified descriptor rather than a mutable path.
   */
  function openWorkspaceFile(filePath: string, flags: number, createParents = false): number {
    const resolvedPath = resolveWorkspacePath(filePath, createParents);
    const relativePath = relative(repoRoot, resolvedPath);
    const parts = relativePath.split(sep).filter(Boolean);
    const filename = parts.pop();
    if (!filename || parts.some((part) => part === "." || part === "..")) throw new HostBridgeError(400, "bad_request", "Invalid filePath.");

    const descriptors: number[] = [];
    try {
      let directoryFd = openSync(realRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      descriptors.push(directoryFd);
      for (const part of parts) {
        const childPath = `/proc/self/fd/${directoryFd}/${part}`;
        if (createParents && !existsSync(childPath)) {
          try { mkdirSync(childPath); } catch (error) { if (!hasNodeCode(error, "EEXIST")) throw error; }
        }
        directoryFd = openSync(childPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        descriptors.push(directoryFd);
      }
      options.beforeFileOpen?.(filePath);
      const fileFd = openSync(`/proc/self/fd/${directoryFd}/${filename}`, flags | constants.O_NOFOLLOW, 0o666);
      if (!fstatSync(fileFd).isFile()) { closeSync(fileFd); throw new HostBridgeError(400, "bad_request", "filePath must identify a regular file."); }
      return fileFd;
    } catch (error) {
      if (error instanceof HostBridgeError) throw error;
      if (isNoFollowError(error)) throw new HostBridgeError(400, "bad_request", "filePath resolves through a symbolic link.");
      throw error;
    } finally {
      for (const descriptor of descriptors) closeSync(descriptor);
    }
  }

  function readWorkspaceFile(filePath: string): string {
    let fileFd: number | undefined;
    try { fileFd = openWorkspaceFile(filePath, constants.O_RDONLY); return readFileSync(fileFd, "utf8"); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") throw new HostBridgeError(404, "not_found", "File does not exist.");
      throw error;
    } finally { if (fileFd !== undefined) closeSync(fileFd); }
  }

  function writeWorkspaceFile(filePath: string, text: string, expectedText: string | null | undefined): void {
    let fileFd: number | undefined;
    try {
      try { fileFd = openWorkspaceFile(filePath, constants.O_RDWR, true); }
      catch (error) {
        if (!hasNodeCode(error, "ENOENT")) throw error;
        if (expectedText !== undefined && expectedText !== null) throw new HostBridgeError(409, "conflict", "File changed on disk.");
        try { fileFd = openWorkspaceFile(filePath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, true); }
        catch (createError) {
          if (!hasNodeCode(createError, "EEXIST")) throw createError;
          fileFd = openWorkspaceFile(filePath, constants.O_RDWR, true);
        }
      }
      const currentText = readFileSync(fileFd, "utf8");
      if (expectedText !== undefined && currentText !== expectedText) throw new HostBridgeError(409, "conflict", "File changed on disk.");
      if (expectedText !== undefined) {
        let currentPathFd: number | undefined;
        try {
          currentPathFd = openWorkspaceFile(filePath, constants.O_RDONLY);
          const opened = fstatSync(fileFd);
          const current = fstatSync(currentPathFd);
          if (opened.dev !== current.dev || opened.ino !== current.ino) throw new HostBridgeError(409, "conflict", "File changed on disk.");
        } finally { if (currentPathFd !== undefined) closeSync(currentPathFd); }
      }
      // Mutate the opened inode, never a path re-resolved after comparison. If an
      // attacker replaces the name meanwhile, their replacement is not overwritten.
      ftruncateSync(fileFd, 0);
      writeSync(fileFd, text, 0, "utf8");
    } finally { if (fileFd !== undefined) closeSync(fileFd); }
  }

  function resolveWorkspacePath(filePath: string, forWrite = false): string {
    let resolved: string;
    try { resolved = resolve(repoRoot, filePath); } catch { throw new HostBridgeError(400, "bad_request", "Invalid filePath."); }
    if (!isWithin(repoRoot, resolved)) throw new HostBridgeError(400, "bad_request", "filePath must stay within the workspace.");
    let existingPath = resolved;
    while (!existsSync(existingPath) && existingPath !== dirname(existingPath)) existingPath = dirname(existingPath);
    let realExisting: string;
    try { realExisting = realpathSync(existingPath); } catch { throw new HostBridgeError(400, "bad_request", "filePath has no accessible parent directory."); }
    if (!isWithin(realRoot, realExisting)) throw new HostBridgeError(400, "bad_request", "filePath resolves outside the workspace.");
    if (!forWrite && !existsSync(resolved)) throw new HostBridgeError(404, "not_found", "File does not exist.");
    if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
      const realTarget = realpathSync(resolved);
      if (!isWithin(realRoot, realTarget)) throw new HostBridgeError(400, "bad_request", "filePath resolves outside the workspace.");
    }
    return resolved;
  }

  function readGitBaseline(filePath: string, fallbackText: string): string {
    try { return execFileSync("git", ["show", `HEAD:${filePath}`], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
    catch { try { return readWorkspaceFile(filePath); } catch { return fallbackText; } }
  }

  function isLikelyTextFile(filePath: string): boolean {
    return !/\.(png|jpe?g|gif|webp|bmp|ico|wasm|so|dll|dylib|exe|zip|gz|tar|jar|pdf)$/i.test(filePath);
  }

  function runRipgrep(cwd: string): string {
    return options.runRipgrep?.(cwd) ?? execFileSync("rg", ["--files"], { cwd, encoding: "utf8" });
  }

  function walkWorkspaceFiles(cwd: string): string[] {
    const files: string[] = [];
    const directories = [cwd];
    while (directories.length > 0 && files.length < maximumFallbackFiles) {
      const directory = directories.pop()!;
      let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
      try { entries = readdirSync(directory, { withFileTypes: true }); }
      catch { continue; }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (files.length >= maximumFallbackFiles) break;
        const absolutePath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name)) directories.push(absolutePath);
          continue;
        }
        if (entry.isFile()) files.push(relative(repoRoot, absolutePath).replaceAll("\\", "/"));
      }
    }
    return files.sort((left, right) => left.localeCompare(right));
  }

  function workspaceFiles(cwd: string): string[] {
    try {
      return runRipgrep(cwd).split("\n").filter(Boolean)
        .map((entry) => relative(repoRoot, resolve(cwd, entry)).replaceAll("\\", "/"));
    } catch (error) {
      if (!hasNodeCode(error, "ENOENT")) throw error;
      return walkWorkspaceFiles(cwd);
    }
  }

  function searchWorkspaceFiles(filePath: string, scope: "repo" | "folder", query: string, limit = 50) {
    const resolvedFilePath = resolveWorkspacePath(filePath);
    const cwd = scope === "repo" ? repoRoot : dirname(resolvedFilePath);
    const normalizedQuery = query.trim().toLowerCase();
    const files = workspaceFiles(cwd)
      .filter((entry) => !normalizedQuery || entry.toLowerCase().includes(normalizedQuery)).slice(0, limit);
    return files.map((filePath) => ({ filePath, detail: scope === "folder" ? "folder" : "repo" }));
  }

  function listWorkspaceFolders() {
    const folders = new Set<string>(["."]);
    for (const filePath of workspaceFiles(repoRoot)) {
      const parts = filePath.replaceAll("\\", "/").split("/"); parts.pop(); let current = "";
      for (const part of parts) { current = current ? `${current}/${part}` : part; folders.add(current); }
    }
    return [...folders].sort((left, right) => left === "." ? -1 : right === "." ? 1 : left.localeCompare(right)).map((folderPath) => ({ folderPath }));
  }

  function optionalGlobPatterns(payload: Record<string, unknown>, field: "include" | "exclude"): string[] | undefined {
    const value = payload[field];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 64 || value.some((pattern) => typeof pattern !== "string" || pattern.length === 0 || pattern.length > 256)) {
      throw new HostBridgeError(400, "bad_request", `${field} must be an array of at most 64 non-empty patterns up to 256 characters.`);
    }
    return value as string[];
  }

  function matchesGlob(filePath: string, patterns: readonly string[] | undefined): boolean {
    return !patterns?.length || patterns.some((pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(filePath));
  }

  function sendJson(response: import("node:http").ServerResponse, status: number, payload: unknown) {
    response.statusCode = status; response.setHeader("content-type", "application/json; charset=utf-8"); response.end(JSON.stringify(payload));
  }
  function sendError(response: import("node:http").ServerResponse, status: number, code: WxHostErrorResponse["error"]["code"], message: string) { sendJson(response, status, { error: { code, message } } satisfies WxHostErrorResponse); }

  const knownRoutes = new Set<string>(Object.values(wxHostRoutes));
  return { name: "wx-dev-bridge", configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const pathname = request.url ? new URL(request.url, "http://127.0.0.1").pathname : "";
      if (!pathname.startsWith("/__wx__/")) { next(); return; }
      if (!knownRoutes.has(pathname)) { sendError(response, 404, "not_found", "Unknown playground host route."); return; }
      if (request.method !== "POST") { response.setHeader("allow", "POST"); sendError(response, 405, "method_not_allowed", "Playground host routes require POST."); return; }
      try {
        const payload = parseJsonObject(await readRequestBody(request));
        if (pathname === wxHostRoutes.readFile) {
          const requestPayload: WxReadFileRequest = { filePath: requireString(payload, "filePath") };
          sendJson(response, 200, { text: readWorkspaceFile(requestPayload.filePath) }); return;
        }
        if (pathname === wxHostRoutes.searchFiles) {
          const scope = payload.scope;
          if (scope !== "repo" && scope !== "folder") throw new HostBridgeError(400, "bad_request", "Expected scope to be repo or folder.");
          const requestPayload: WxSearchFilesRequest = { filePath: requireString(payload, "filePath"), scope, query: typeof payload.query === "string" ? payload.query : "" };
          sendJson(response, 200, { files: searchWorkspaceFiles(requestPayload.filePath, requestPayload.scope, requestPayload.query) }); return;
        }
        if (pathname === wxHostRoutes.searchWorkspace) {
          const mode = payload.mode, casePolicy = payload.case;
          if ((mode !== "literal" && mode !== "regex") || !["sensitive", "insensitive", "smart"].includes(String(casePolicy))) throw new HostBridgeError(400, "bad_request", "Invalid workspace search mode or case policy.");
          const requestPayload: WxSearchWorkspaceRequest = {
            filePath: requireString(payload, "filePath"),
            query: requireText(payload, "query"),
            mode,
            case: casePolicy as WxSearchWorkspaceRequest["case"],
            include: optionalGlobPatterns(payload, "include"),
            exclude: optionalGlobPatterns(payload, "exclude"),
            limit: Math.max(1, Math.min(1000, Number(payload.limit) || 200))
          };
          const sensitive = requestPayload.case === "sensitive" || (requestPayload.case === "smart" && /[A-Z]/.test(requestPayload.query));
          let expression: RegExp; try { expression = new RegExp(requestPayload.mode === "literal" ? requestPayload.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : requestPayload.query, `${sensitive ? "" : "i"}gu`); } catch { throw new HostBridgeError(400, "bad_request", "Invalid regular expression."); }
          const results: Array<{ filePath: string; line: number; fromColumn: number; toColumn: number; preview: string; truncated?: boolean }> = [];
          for (const file of searchWorkspaceFiles(requestPayload.filePath, "repo", "", maximumFallbackFiles)) {
            if (!isLikelyTextFile(file.filePath) || !matchesGlob(file.filePath, requestPayload.include) || (requestPayload.exclude?.length && matchesGlob(file.filePath, requestPayload.exclude))) continue;
            const text = readWorkspaceFile(file.filePath);
            if (text.includes("\0")) continue;
            const lines = text.split(/\r?\n/);
            for (let line = 0; line < lines.length; line += 1) {
              expression.lastIndex = 0;
              for (const match of lines[line]!.matchAll(expression)) {
                results.push({ filePath: file.filePath, line, fromColumn: match.index, toColumn: match.index + match[0].length, preview: lines[line]! });
                if (results.length >= requestPayload.limit) { results[results.length - 1]!.truncated = true; sendJson(response, 200, { results }); return; }
              }
            }
          }
          sendJson(response, 200, { results }); return;
        }
        if (pathname === wxHostRoutes.listFolders) {
          resolveWorkspacePath(requireString(payload, "filePath")); sendJson(response, 200, { folders: listWorkspaceFolders() }); return;
        }
        if (pathname === wxHostRoutes.writeFile) {
          const expectedText = payload.expectedText;
          if (expectedText !== undefined && expectedText !== null && typeof expectedText !== "string") throw new HostBridgeError(400, "bad_request", "expectedText must be a string or null.");
          const requestPayload: WxWriteFileRequest = { filePath: requireString(payload, "filePath"), text: requireText(payload, "text"), ...(expectedText === undefined ? {} : { expectedText }) };
          writeWorkspaceFile(requestPayload.filePath, requestPayload.text, requestPayload.expectedText);
          sendJson(response, 200, { ok: true }); return;
        }
        const requestPayload: WxLineChangesRequest = { filePath: requireString(payload, "filePath"), text: requireText(payload, "text") };
        resolveWorkspacePath(requestPayload.filePath);
        const baseText = readGitBaseline(requestPayload.filePath, requestPayload.text);
        sendJson(response, 200, { changes: computeLineChanges(baseText, requestPayload.text) });
      } catch (error) {
        if (error instanceof HostBridgeError) { sendError(response, error.status, error.code, error.message); return; }
        sendError(response, 500, "internal_error", "Playground host bridge failed.");
      }
    });
  }};
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_ACTIONS === "true" && repositoryName ? `/${repositoryName}/` : "/";
export default defineConfig({ base, plugins: [createWxDevBridge(repoRoot)], server: { port: 4173, fs: { allow: [repoRoot] } }, worker: { format: "es" } });
