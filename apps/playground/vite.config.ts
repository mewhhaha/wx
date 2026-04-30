import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

type LineChangeKind = "added" | "modified" | "deleted";

interface LineChange {
  line: number;
  kind: LineChangeKind;
}

function readRequestBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

function computeLineChanges(baseText: string, currentText: string): LineChange[] {
  const baseLines = splitLines(baseText);
  const currentLines = splitLines(currentText);
  const rowCount = baseLines.length + 1;
  const columnCount = currentLines.length + 1;
  const dp = Array.from({ length: rowCount }, () => new Array<number>(columnCount).fill(0));

  for (let row = baseLines.length - 1; row >= 0; row -= 1) {
    for (let column = currentLines.length - 1; column >= 0; column -= 1) {
      dp[row]![column] =
        baseLines[row] === currentLines[column]
          ? 1 + dp[row + 1]![column + 1]!
          : Math.max(dp[row + 1]![column]!, dp[row]![column + 1]!);
    }
  }

  const matches: Array<[number, number]> = [];
  let row = 0;
  let column = 0;

  while (row < baseLines.length && column < currentLines.length) {
    if (baseLines[row] === currentLines[column]) {
      matches.push([row, column]);
      row += 1;
      column += 1;
      continue;
    }

    if (dp[row + 1]![column]! >= dp[row]![column + 1]!) {
      row += 1;
    } else {
      column += 1;
    }
  }

  const anchors: Array<[number, number]> = [[-1, -1], ...matches, [baseLines.length, currentLines.length]];
  const changes: LineChange[] = [];

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const [baseAnchor, currentAnchor] = anchors[index]!;
    const [nextBase, nextCurrent] = anchors[index + 1]!;
    const baseCount = nextBase - baseAnchor - 1;
    const currentCount = nextCurrent - currentAnchor - 1;

    if (baseCount > currentCount) {
      const deletionLine = Math.max(0, currentAnchor);
      changes.push({ line: deletionLine, kind: "deleted" });
    }

    if (currentCount <= 0) {
      continue;
    }

    const kind: LineChangeKind = baseCount === 0 ? "added" : "modified";

    for (let line = currentAnchor + 1; line < nextCurrent; line += 1) {
      changes.push({ line, kind });
    }
  }

  return changes;
}

function createWxDevBridge(repoRoot: string): Plugin {
  const normalizedRoot = `${repoRoot}${sep}`;

  function resolveWorkspacePath(filePath: string): string {
    const resolved = resolve(repoRoot, filePath);

    if (resolved !== repoRoot && !resolved.startsWith(normalizedRoot)) {
      throw new Error(`Refusing to access path outside workspace: ${filePath}`);
    }

    return resolved;
  }

  function readGitBaseline(filePath: string, fallbackText: string): string {
    try {
      return execFileSync("git", ["show", `HEAD:${filePath}`], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch {
      try {
        return readFileSync(resolveWorkspacePath(filePath), "utf8");
      } catch {
        return fallbackText;
      }
    }
  }

  function searchWorkspaceFiles(filePath: string, scope: "repo" | "folder", query: string) {
    const cwd = scope === "repo" ? repoRoot : dirname(resolveWorkspacePath(filePath));
    const normalizedQuery = query.trim().toLowerCase();
    const files = execFileSync("rg", ["--files"], {
      cwd,
      encoding: "utf8"
    })
      .split("\n")
      .filter(Boolean)
      .map((entry) => relative(repoRoot, resolve(cwd, entry)).replaceAll("\\", "/"))
      .filter((entry) => !normalizedQuery || entry.toLowerCase().includes(normalizedQuery))
      .slice(0, 50);

    return files.map((entry) => ({
      filePath: entry,
      detail: scope === "folder" ? "folder" : "repo"
    }));
  }

  function listWorkspaceFolders() {
    const folders = new Set<string>(["."]);
    const files = execFileSync("rg", ["--files"], {
      cwd: repoRoot,
      encoding: "utf8"
    })
      .split("\n")
      .filter(Boolean);

    for (const filePath of files) {
      const parts = filePath.replaceAll("\\", "/").split("/");
      parts.pop();
      let current = "";
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        folders.add(current);
      }
    }

    return [...folders]
      .sort((left, right) => (left === "." ? -1 : right === "." ? 1 : left.localeCompare(right)))
      .map((folderPath) => ({ folderPath }));
  }

  return {
    name: "wx-dev-bridge",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "POST" || !request.url) {
          if (request.method === "GET" && request.url.startsWith("/__wx__/read")) {
            try {
              const url = new URL(request.url, "http://127.0.0.1");
              const filePath = url.searchParams.get("file");

              if (!filePath) {
                response.statusCode = 400;
                response.end("Expected file query parameter.");
                return;
              }

              response.setHeader("content-type", "application/json");
              response.end(
                JSON.stringify({
                  text: readFileSync(resolveWorkspacePath(filePath), "utf8")
                })
              );
            } catch (error) {
              response.statusCode = 500;
              response.end(error instanceof Error ? error.message : String(error));
            }
            return;
          }

          if (request.method === "GET" && request.url.startsWith("/__wx__/search")) {
            try {
              const url = new URL(request.url, "http://127.0.0.1");
              const filePath = url.searchParams.get("file");
              const scope = url.searchParams.get("scope");
              const query = url.searchParams.get("q") ?? "";

              if (!filePath || (scope !== "repo" && scope !== "folder")) {
                response.statusCode = 400;
                response.end("Expected file and scope query parameters.");
                return;
              }

              response.setHeader("content-type", "application/json");
              response.end(JSON.stringify({ files: searchWorkspaceFiles(filePath, scope, query) }));
            } catch (error) {
              response.statusCode = 500;
              response.end(error instanceof Error ? error.message : String(error));
            }
            return;
          }

          if (request.method === "GET" && request.url.startsWith("/__wx__/folders")) {
            try {
              response.setHeader("content-type", "application/json");
              response.end(JSON.stringify({ folders: listWorkspaceFolders() }));
            } catch (error) {
              response.statusCode = 500;
              response.end(error instanceof Error ? error.message : String(error));
            }
            return;
          }

          next();
          return;
        }

        if (request.url !== "/__wx__/write" && request.url !== "/__wx__/line-changes") {
          next();
          return;
        }

        try {
          const rawBody = await readRequestBody(request);
          const payload = JSON.parse(rawBody) as { filePath?: string; text?: string };

          if (!payload.filePath || typeof payload.text !== "string") {
            response.statusCode = 400;
            response.end("Expected filePath and text.");
            return;
          }

          if (request.url === "/__wx__/write") {
            const resolvedPath = resolveWorkspacePath(payload.filePath);
            mkdirSync(dirname(resolvedPath), { recursive: true });
            writeFileSync(resolvedPath, payload.text, "utf8");
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ ok: true }));
            return;
          }

          const baseText = readGitBaseline(payload.filePath, payload.text);
          const changes = computeLineChanges(baseText, payload.text);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ changes }));
        } catch (error) {
          response.statusCode = 500;
          response.end(error instanceof Error ? error.message : String(error));
        }
      });
    }
  };
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.GITHUB_ACTIONS === "true" && repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig({
  base,
  plugins: [createWxDevBridge(repoRoot)],
  server: {
    port: 4173,
    fs: {
      allow: [repoRoot]
    }
  },
  worker: {
    format: "es"
  }
});
