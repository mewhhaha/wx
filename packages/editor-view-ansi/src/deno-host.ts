/// <reference lib="deno.ns" />

import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { EditorHostServices } from "@mewhhaha/wx-controller";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"
]);

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isLikelyTextFile(path: string): boolean {
  return !/\.(png|jpe?g|gif|webp|bmp|ico|wasm|so|dll|dylib|exe|zip|gz|tar|jar|pdf)$/i.test(path);
}

function isInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== ".." && !value.startsWith("../") && !isAbsolute(value);
}

async function existingParent(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      return await Deno.realPath(current);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound) || dirname(current) === current) throw error;
      current = dirname(current);
    }
  }
}

/** Finds a Git root when `git` is available; otherwise preserves the supplied cwd. */
export async function resolveDenoProjectRoot(cwd = Deno.cwd()): Promise<string> {
  try {
    const result = await new Deno.Command("git", {
      args: ["-C", cwd, "rev-parse", "--show-toplevel"],
      stdout: "piped",
      stderr: "null"
    }).output();
    const root = new TextDecoder().decode(result.stdout).trim();
    return result.success && root ? root : cwd;
  } catch {
    return cwd;
  }
}

/** Deno filesystem adapter. All paths are contained beneath the resolved project root. */
export function createDenoHostServices(options: {
  cwd?: string;
  projectRoot?: string;
  ignoredDirectories?: Iterable<string>;
} = {}): EditorHostServices & Required<Pick<EditorHostServices, "readFile" | "writeFile" | "searchFiles" | "searchWorkspace" | "listFolders">> {
  const projectRoot = resolve(options.projectRoot ?? options.cwd ?? Deno.cwd());
  const ignoredDirectories = new Set(options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES);
  const walkCache = new Map<string, Promise<readonly string[]>>();
  const folderCache = new Map<string, Promise<readonly string[]>>();
  const gitCache = new Map<string, Promise<readonly string[] | null>>();
  const realProjectRoot = Deno.realPath(projectRoot);

  const resolveInsideProjectRoot = async (value: string, forWrite = false): Promise<string> => {
    const absolute = resolve(projectRoot, value);
    const root = await realProjectRoot;
    const existing = forWrite ? await existingParent(absolute) : await Deno.realPath(absolute);
    if (!isInside(root, existing)) throw new Error(`File path escapes project root: ${value}`);
    return absolute;
  };

  const listGitFiles = (): Promise<readonly string[] | null> => {
    const key = "git";
    const cached = gitCache.get(key);
    if (cached) return cached;
    const pending = (async () => {
      try {
        const result = await new Deno.Command("git", {
          args: ["-C", projectRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
          stdout: "piped", stderr: "null"
        }).output();
        if (!result.success) return null;
        return new TextDecoder().decode(result.stdout).split("\0").filter(Boolean)
          .map(normalizeRelativePath).sort((a, b) => a.localeCompare(b));
      } catch {
        return null;
      }
    })();
    gitCache.set(key, pending);
    return pending;
  };

  const walk = (folders: boolean): Promise<readonly string[]> => {
    const cache = folders ? folderCache : walkCache;
    const key = folders ? "folders" : "files";
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = (async () => {
      const values = new Set<string>(folders ? ["."] : []);
      const stack = [projectRoot];
      while (stack.length) {
        const current = stack.pop()!;
        try {
          for await (const entry of Deno.readDir(current)) {
            if (entry.isDirectory) {
              if (!ignoredDirectories.has(entry.name)) {
                const absolute = join(current, entry.name);
                if (folders) values.add(normalizeRelativePath(relative(projectRoot, absolute)));
                stack.push(absolute);
              }
            } else if (!folders && entry.isFile) {
              values.add(normalizeRelativePath(relative(projectRoot, join(current, entry.name))));
            }
          }
        } catch { /* unreadable directories are omitted from picker results */ }
      }
      return [...values].sort((a, b) => a === "." ? -1 : b === "." ? 1 : a.localeCompare(b));
    })();
    cache.set(key, pending);
    return pending;
  };

  const invalidate = () => { walkCache.clear(); folderCache.clear(); gitCache.clear(); };
  return {
    async readFile(context) { return { text: await Deno.readTextFile(await resolveInsideProjectRoot(context.filePath)) }; },
    async writeFile(context) {
      const absolute = await resolveInsideProjectRoot(context.filePath, true);
      if (context.expectedText !== undefined) {
        let current: string | null = null;
        try { current = await Deno.readTextFile(absolute); } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
        if (current !== context.expectedText) throw new Error(`File changed on disk: ${context.filePath}`);
      }
      await Deno.mkdir(dirname(absolute), { recursive: true });
      await Deno.writeTextFile(absolute, context.text);
      invalidate();
    },
    async searchFiles(context) {
      const query = context.query.trim().toLowerCase();
      const files = (await listGitFiles()) ?? await walk(false);
      return files.filter((path) => path !== context.filePath && isLikelyTextFile(path) && (!query || path.toLowerCase().includes(query)))
        .slice(0, 200).map((filePath) => ({ filePath }));
    },
    async searchWorkspace(context) {
      const files = (await listGitFiles()) ?? await walk(false);
      const limit = Math.max(1, Math.min(1000, Math.trunc(context.limit || 200)));
      const sensitive = context.case === "sensitive" || (context.case === "smart" && /[A-Z]/.test(context.query));
      let expression: RegExp;
      try { expression = new RegExp(context.mode === "literal" ? context.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : context.query, `${sensitive ? "" : "i"}gu`); }
      catch { throw new Error("Invalid workspace search regular expression"); }
      const glob = (value: string, patterns?: readonly string[]) => !patterns?.length || patterns.some((pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value));
      const results: Array<{ filePath: string; line: number; fromColumn: number; toColumn: number; preview: string; truncated?: boolean }> = [];
      for (const filePath of files) {
        if (context.signal?.aborted) break;
        if (!isLikelyTextFile(filePath) || !glob(filePath, context.include) || (context.exclude?.length && glob(filePath, context.exclude))) continue;
        const bytes = await Deno.readFile(await resolveInsideProjectRoot(filePath));
        if (bytes.includes(0)) continue;
        const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
        for (let line = 0; line < lines.length; line += 1) {
          expression.lastIndex = 0;
          for (const match of lines[line]!.matchAll(expression)) {
            results.push({ filePath, line, fromColumn: match.index, toColumn: match.index + match[0].length, preview: lines[line]! });
            if (results.length >= limit) { results[results.length - 1]!.truncated = true; return results; }
          }
        }
      }
      return results;
    },
    async listFolders() {
      const files = await listGitFiles();
      if (!files) return (await walk(true)).map((folderPath) => ({ folderPath }));
      const folders = new Set<string>(["."]);
      for (const file of files) {
        const parts = file.split("/"); parts.pop(); let current = "";
        for (const part of parts) { current = current ? `${current}/${part}` : part; folders.add(current); }
      }
      return [...folders].sort((a, b) => a === "." ? -1 : b === "." ? 1 : a.localeCompare(b)).map((folderPath) => ({ folderPath }));
    },
    didWriteFile: invalidate
  };
}
