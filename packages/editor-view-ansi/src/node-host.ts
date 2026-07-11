import type { EditorHostServices } from "@mewhhaha/wx-controller";

export interface NodeTerminalWritable {
  write(text: string, callback: (error?: Error | null) => void): boolean;
  once(event: "drain", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  off?(event: "drain", listener: () => void): unknown;
  off?(event: "error", listener: (error: Error) => void): unknown;
  removeListener?(event: "drain", listener: () => void): unknown;
  removeListener?(event: "error", listener: (error: Error) => void): unknown;
}

function removeWritableListener(
  output: NodeTerminalWritable,
  event: "drain" | "error",
  listener: (() => void) | ((error: Error) => void)
): void {
  if (output.off) output.off(event as "drain", listener as () => void);
  else output.removeListener?.(event as "drain", listener as () => void);
}

/** Resolves only when Node has flushed a write and, after `false`, accepted more data on `drain`. */
export function createNodeTerminalWrite(output: NodeTerminalWritable): (text: string) => Promise<void> {
  return (text) => new Promise<void>((resolve, reject) => {
    let callbackComplete = false;
    let drainComplete = false;
    let needsDrain = false;
    let writeReturned = false;
    let settled = false;

    const cleanup = () => {
      removeWritableListener(output, "drain", onDrain);
      removeWritableListener(output, "error", onError);
    };
    const finish = (error?: Error | null) => {
      if (settled) return;
      if (error) {
        settled = true;
        cleanup();
        reject(error);
        return;
      }
      // `false` means Writable's own buffer is full.  Its `drain` event is the
      // admission signal we need before scheduling another terminal frame; do
      // not additionally depend on a callback that test doubles (and a few
      // minimal Writable adapters) need not provide.  For an immediately
      // accepted write, retain the callback so callback-only write failures
      // still reject this promise.
      if (!writeReturned || (needsDrain ? !drainComplete : !callbackComplete)) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onDrain = () => {
      drainComplete = true;
      finish();
    };
    const onError = (error: Error) => finish(error);

    output.once("drain", onDrain);
    output.once("error", onError);
    try {
      needsDrain = output.write(text, (error) => {
        callbackComplete = true;
        finish(error);
      }) === false;
      writeReturned = true;
      if (!needsDrain) drainComplete = true;
      finish();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo"
]);

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isLikelyTextFile(path: string): boolean {
  return !/\.(png|jpe?g|gif|webp|bmp|ico|wasm|so|dll|dylib|exe|zip|gz|tar|jar|pdf)$/i.test(path);
}

export async function resolveGitAwareProjectRoot(cwd = process.cwd()): Promise<string> {
  try {
    const { execFile } = await import("node:child_process");
    const resolved = await new Promise<string>((resolve, reject) => {
      execFile("git", ["-C", cwd, "rev-parse", "--show-toplevel"], (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stdout.trim());
      });
    });

    return resolved || cwd;
  } catch {
    return cwd;
  }
}

export function createNodeHostServices(options: {
  cwd?: string;
  projectRoot?: string;
  ignoredDirectories?: Iterable<string>;
} = {}): EditorHostServices & Required<Pick<EditorHostServices, "readFile" | "writeFile" | "searchFiles" | "searchWorkspace" | "listFolders">> {
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = options.projectRoot ?? cwd;
  const ignoredDirectories = new Set(options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES);
  const walkCache = new Map<string, Promise<readonly string[]>>();
  const folderCache = new Map<string, Promise<readonly string[]>>();
  const gitCache = new Map<string, Promise<readonly string[] | null>>();
  const realProjectRoot = import("node:fs/promises").then((fs) => fs.realpath(projectRoot));

  const resolveInsideProjectRoot = async (value: string, forWrite = false) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const absolute = path.resolve(projectRoot, value);
    const root = await realProjectRoot;
    let existing = absolute;
    while (true) {
      try {
        existing = await fs.realpath(existing);
        break;
      } catch (error) {
        if (!forWrite || path.dirname(existing) === existing) throw error;
        existing = path.dirname(existing);
      }
    }
    const relative = path.relative(root, existing);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`File path escapes project root: ${value}`);
    }
    return absolute;
  };

  const listGitFiles = (rootPath: string): Promise<readonly string[] | null> => {
    const cacheKey = `git:${rootPath}`;
    const cached = gitCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      try {
        const { execFile } = await import("node:child_process");
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile("git", ["-C", rootPath, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], (error, out) => {
            if (error) {
              reject(error);
              return;
            }

            resolve(out);
          });
        });

        return stdout
          .split("\u0000")
          .filter((entry) => entry.length > 0)
          .map((entry) => normalizeRelativePath(entry))
          .sort((left, right) => left.localeCompare(right));
      } catch {
        return null;
      }
    })();

    gitCache.set(cacheKey, pending);
    return pending;
  };

  const walkFiles = (rootPath: string): Promise<readonly string[]> => {
    const cacheKey = `walk:${rootPath}`;
    const cached = walkCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const files: string[] = [];
      const stack = [rootPath];

      while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;

        try {
          entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          const absolute = path.join(current, entry.name);

          if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) {
              stack.push(absolute);
            }
            continue;
          }

          if (!entry.isFile()) {
            continue;
          }

          files.push(normalizeRelativePath(path.relative(projectRoot, absolute)));
        }
      }

      files.sort((left, right) => left.localeCompare(right));
      return files;
    })();

    walkCache.set(cacheKey, pending);
    return pending;
  };

  const foldersFromFiles = (files: readonly string[]): readonly string[] => {
    const folders = new Set<string>(["."]);

    for (const filePath of files) {
      const parts = filePath.split("/");
      parts.pop();
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        folders.add(current);
      }
    }

    return [...folders].sort((left, right) => (left === "." ? -1 : right === "." ? 1 : left.localeCompare(right)));
  };

  const walkFolders = (rootPath: string): Promise<readonly string[]> => {
    const cacheKey = `folders:${rootPath}`;
    const cached = folderCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const folders = new Set<string>(["."]);
      const stack = [rootPath];

      while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: Array<{ name: string; isDirectory(): boolean }>;

        try {
          entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) {
            continue;
          }

          const absolute = path.join(current, entry.name);
          folders.add(normalizeRelativePath(path.relative(projectRoot, absolute)));
          stack.push(absolute);
        }
      }

      return [...folders].sort((left, right) => (left === "." ? -1 : right === "." ? 1 : left.localeCompare(right)));
    })();

    folderCache.set(cacheKey, pending);
    return pending;
  };

  return {
    async readFile(context) {
      const fs = await import("node:fs/promises");
      const absolute = await resolveInsideProjectRoot(context.filePath);
      return { text: await fs.readFile(absolute, "utf8") };
    },
    async writeFile(context) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const absolute = await resolveInsideProjectRoot(context.filePath, true);
      if (context.expectedText !== undefined) {
        let currentText: string | null = null;
        try {
          currentText = await fs.readFile(absolute, "utf8");
        } catch {
          currentText = null;
        }
        if (currentText !== context.expectedText) {
          throw new Error(`File changed on disk: ${context.filePath}`);
        }
      }
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, context.text, "utf8");
      walkCache.clear();
      folderCache.clear();
      gitCache.clear();
    },
    async searchFiles(context) {
      const normalizedQuery = context.query.trim().toLowerCase();
      const files = (await listGitFiles(projectRoot)) ?? (await walkFiles(projectRoot));

      return files
        .filter((filePath) => filePath !== context.filePath)
        .filter((filePath) => isLikelyTextFile(filePath))
        .filter((filePath) => !normalizedQuery || filePath.toLowerCase().includes(normalizedQuery))
        .slice(0, 200)
        .map((filePath) => ({ filePath }));
    },
    async searchWorkspace(context) {
      const fs = await import("node:fs/promises");
      const files = (await listGitFiles(projectRoot)) ?? (await walkFiles(projectRoot));
      const limit = Math.max(1, Math.min(1000, Math.trunc(context.limit || 200)));
      const sensitive = context.case === "sensitive" || (context.case === "smart" && /[A-Z]/.test(context.query));
      const flags = `${sensitive ? "" : "i"}gu`;
      let expression: RegExp;
      try { expression = new RegExp(context.mode === "literal" ? context.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : context.query, flags); }
      catch { throw new Error("Invalid workspace search regular expression"); }
      const glob = (value: string, patterns?: readonly string[]) => !patterns?.length || patterns.some((pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value));
      const results: Array<{ filePath: string; line: number; fromColumn: number; toColumn: number; preview: string; truncated?: boolean }> = [];
      for (const filePath of files) {
        if (context.signal?.aborted) break;
        if (!isLikelyTextFile(filePath) || !glob(filePath, context.include) || (context.exclude?.length && glob(filePath, context.exclude))) continue;
        const absolute = await resolveInsideProjectRoot(filePath);
        const bytes = await fs.readFile(absolute);
        if (bytes.includes(0)) continue;
        const lines = bytes.toString("utf8").split(/\r?\n/);
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
      const gitFiles = await listGitFiles(projectRoot);
      const folders = gitFiles ? foldersFromFiles(gitFiles) : await walkFolders(projectRoot);
      return folders.map((folderPath) => ({ folderPath }));
    },
    didWriteFile() {
      walkCache.clear();
      folderCache.clear();
      gitCache.clear();
    }
  };
}
