import type { EditorHostServices } from "@mewhhaha/wx-controller";

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
} = {}): EditorHostServices {
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = options.projectRoot ?? cwd;
  const ignoredDirectories = new Set(options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES);
  const walkCache = new Map<string, Promise<readonly string[]>>();
  const gitCache = new Map<string, Promise<readonly string[] | null>>();

  const resolveInsideProjectRoot = async (value: string) => {
    const path = await import("node:path");
    return path.resolve(projectRoot, value);
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
        let entries: Awaited<ReturnType<typeof fs.readdir>>;

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

  return {
    async readFile(context) {
      const fs = await import("node:fs/promises");
      const absolute = await resolveInsideProjectRoot(context.filePath);
      return { text: await fs.readFile(absolute, "utf8") };
    },
    async writeFile(context) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const absolute = await resolveInsideProjectRoot(context.filePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, context.text, "utf8");
      walkCache.clear();
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
    didWriteFile() {
      walkCache.clear();
      gitCache.clear();
    }
  };
}
