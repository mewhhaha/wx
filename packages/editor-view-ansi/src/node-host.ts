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

function getSearchRootContext(cwd: string, absoluteFilePath: string, scope: "repo" | "folder") {
  return import("node:path").then((path) => {
    const rootPath = scope === "folder" ? path.dirname(absoluteFilePath) : cwd;
    const relativeRoot = normalizeRelativePath(path.relative(cwd, rootPath));

    return {
      rootPath,
      prefix: !relativeRoot || relativeRoot === "." ? "" : `${relativeRoot.replace(/\/+$/, "")}/`
    };
  });
}

export function createNodeHostServices(options: { cwd?: string; ignoredDirectories?: Iterable<string> } = {}): EditorHostServices {
  const cwd = options.cwd ?? process.cwd();
  const ignoredDirectories = new Set(options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES);
  const walkCache = new Map<string, Promise<readonly string[]>>();

  const resolveInsideCwd = async (value: string) => {
    const path = await import("node:path");
    return path.resolve(cwd, value);
  };

  const walkFiles = (rootPath: string): Promise<readonly string[]> => {
    const cached = walkCache.get(rootPath);
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

          files.push(normalizeRelativePath(path.relative(cwd, absolute)));
        }
      }

      files.sort((left, right) => left.localeCompare(right));
      return files;
    })();

    walkCache.set(rootPath, pending);
    return pending;
  };

  return {
    async readFile(context) {
      const fs = await import("node:fs/promises");
      const absolute = await resolveInsideCwd(context.filePath);
      return { text: await fs.readFile(absolute, "utf8") };
    },
    async searchFiles(context) {
      const normalizedQuery = context.query.trim().toLowerCase();
      const absoluteFilePath = await resolveInsideCwd(context.filePath);
      const { rootPath, prefix } = await getSearchRootContext(cwd, absoluteFilePath, context.scope);
      const files = await walkFiles(rootPath);

      return files
        .filter((filePath) => filePath !== context.filePath)
        .filter((filePath) => !prefix || filePath.startsWith(prefix))
        .filter((filePath) => isLikelyTextFile(filePath))
        .filter((filePath) => !normalizedQuery || filePath.toLowerCase().includes(normalizedQuery))
        .slice(0, 200)
        .map((filePath) => ({ filePath }));
    }
  };
}
