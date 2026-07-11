import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { computeLineChanges, createWxDevBridge } from "../vite.config";
import { wxHostRoutes } from "../src/host-contract";

let root = "";
let server: ViteDevServer;
let baseUrl = "";

async function hostRequest(path: string, payload: unknown, method = "POST"): Promise<Response> {
  return await fetch(`${baseUrl}${path}`, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(payload) : undefined
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "wx-host-bridge-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "src", "allowed"), { recursive: true });
  await writeFile(join(root, "src", "sample.ts"), "export const value = 1;\n");
  await writeFile(join(root, "src", "żółć.ts"), "😀 Needle needle\n");
  await writeFile(join(root, "src", "allowed", "match.ts"), "needle\n");
  await writeFile(join(root, "src", "allowed", "excluded.ts"), "needle\n");
  await writeFile(join(root, "src", "outside.ts"), "needle\n");
  await writeFile(join(root, "src", "binary.png"), "needle\n");
  server = await createServer({ root, logLevel: "error", plugins: [createWxDevBridge(root)], server: { port: 0 } });
  await server.listen();
  baseUrl = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe("playground host bridge HTTP contract", () => {
  it("computes line markers without a quadratic LCS matrix", () => {
    expect(computeLineChanges("a\nb\nc", "a\nchanged\nc\nadded")).toEqual([
      { line: 1, kind: "modified" },
      { line: 3, kind: "added" }
    ]);
    expect(computeLineChanges("a\nb\nc", "a\nc")).toEqual([{ line: 0, kind: "deleted" }]);

    const base = Array.from({ length: 20_000 }, (_, index) => `line-${index}`).join("\n");
    const current = `${base}\nlast`;
    expect(computeLineChanges(base, current)).toEqual([{ line: 20_000, kind: "added" }]);

    // Duplicate-only blocks have no patience anchors and deliberately fall
    // back to conservative modified markers rather than allocating N×M.
    expect(computeLineChanges("same\nsame\ntail", "same\nchanged\ntail")).toEqual([{ line: 1, kind: "modified" }]);
  });

  it("serves every host operation through POST JSON", async () => {
    const read = await hostRequest(wxHostRoutes.readFile, { filePath: "src/sample.ts" });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ text: "export const value = 1;\n" });

    const search = await hostRequest(wxHostRoutes.searchFiles, { filePath: "src/sample.ts", scope: "repo", query: "sample" });
    expect(search.status).toBe(200);
    expect((await search.json()).files).toContainEqual({ filePath: "src/sample.ts", detail: "repo" });

    const contentSearch = await hostRequest(wxHostRoutes.searchWorkspace, { filePath: "src/sample.ts", query: "needle", mode: "literal", case: "smart", include: ["src/żółć.ts"], limit: 10 });
    expect(contentSearch.status).toBe(200);
    expect((await contentSearch.json()).results).toEqual([
      { filePath: "src/żółć.ts", line: 0, fromColumn: 3, toColumn: 9, preview: "😀 Needle needle" },
      { filePath: "src/żółć.ts", line: 0, fromColumn: 10, toColumn: 16, preview: "😀 Needle needle" }
    ]);

    const folders = await hostRequest(wxHostRoutes.listFolders, { filePath: "src/sample.ts" });
    expect((await folders.json()).folders).toContainEqual({ folderPath: "src" });

    const write = await hostRequest(wxHostRoutes.writeFile, { filePath: "src/sample.ts", text: "export const value = 2;\n", expectedText: "export const value = 1;\n" });
    expect(write.status).toBe(200);
    expect(await write.json()).toEqual({ ok: true });

    const changes = await hostRequest(wxHostRoutes.lineChanges, { filePath: "src/sample.ts", text: "changed\n" });
    expect(changes.status).toBe(200);
    expect((await changes.json()).changes).toEqual(expect.any(Array));
  });

  it("honors include and exclude patterns for bounded workspace search", async () => {
    const response = await hostRequest(wxHostRoutes.searchWorkspace, {
      filePath: "src/sample.ts",
      query: "needle",
      mode: "literal",
      case: "insensitive",
      include: ["src/allowed/**"],
      exclude: ["**/excluded.ts"],
      limit: 1
    });

    expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([
      { filePath: "src/allowed/match.ts", line: 0, fromColumn: 0, toColumn: 6, preview: "needle", truncated: true }
    ]);
  });

  it("uses the bounded in-process walker when ripgrep is unavailable", async () => {
    const fallbackRoot = await mkdtemp(join(tmpdir(), "wx-host-bridge-fallback-"));
    await mkdir(join(fallbackRoot, "src"), { recursive: true });
    await writeFile(join(fallbackRoot, "src", "fallback.ts"), "fallback needle\n");
    await mkdir(join(fallbackRoot, "node_modules", "ignored"), { recursive: true });
    await writeFile(join(fallbackRoot, "node_modules", "ignored", "ignored.ts"), "needle\n");
    const unavailableRipgrep = Object.assign(new Error("rg unavailable"), { code: "ENOENT" });
    const fallbackServer = await createServer({
      root: fallbackRoot,
      logLevel: "error",
      plugins: [createWxDevBridge(fallbackRoot, { runRipgrep() { throw unavailableRipgrep; } })],
      server: { port: 0 }
    });
    await fallbackServer.listen();
    const fallbackBaseUrl = fallbackServer.resolvedUrls!.local[0]!.replace(/\/$/, "");
    try {
      const response = await fetch(`${fallbackBaseUrl}${wxHostRoutes.searchWorkspace}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filePath: "src/fallback.ts", query: "needle", mode: "literal", case: "smart", limit: 10 })
      });
      expect(response.status).toBe(200);
      expect((await response.json()).results).toEqual([
        { filePath: "src/fallback.ts", line: 0, fromColumn: 9, toColumn: 15, preview: "fallback needle" }
      ]);
    } finally {
      await fallbackServer.close();
      await rm(fallbackRoot, { recursive: true, force: true });
    }
  });

  it("returns a conflict without overwriting stale content", async () => {
    await writeFile(join(root, "src", "sample.ts"), "external\n");
    const response = await hostRequest(wxHostRoutes.writeFile, { filePath: "src/sample.ts", text: "replacement\n", expectedText: "stale\n" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "conflict", message: "File changed on disk." } });
    await expect(readFile(join(root, "src", "sample.ts"), "utf8")).resolves.toBe("external\n");
  });

  it("rejects traversal, symlink escape, unknown routes, wrong methods, and malformed payloads", async () => {
    const outside = join(root, "..", "wx-host-bridge-outside.txt");
    await writeFile(outside, "outside\n");
    await symlink(outside, join(root, "src", "outside-link.ts"));

    for (const filePath of ["../wx-host-bridge-outside.txt", "src/outside-link.ts"]) {
      const response = await hostRequest(wxHostRoutes.readFile, { filePath });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad_request");
    }

    const unknown = await hostRequest("/__wx__/missing", {});
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: { code: "not_found", message: "Unknown playground host route." } });

    const wrongMethod = await hostRequest(wxHostRoutes.readFile, {}, "GET");
    expect(wrongMethod.status).toBe(405);
    expect(await wrongMethod.json()).toEqual({ error: { code: "method_not_allowed", message: "Playground host routes require POST." } });

    const malformed = await hostRequest(wxHostRoutes.readFile, {});
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("bad_request");
  });

  it("does not follow a file replaced with a symlink after containment validation", async () => {
    const raceRoot = await mkdtemp(join(tmpdir(), "wx-host-bridge-race-"));
    const outside = join(raceRoot, "..", "wx-host-bridge-race-outside.txt");
    await mkdir(join(raceRoot, "src"), { recursive: true });
    await writeFile(join(raceRoot, "src", "sample.ts"), "original\n");
    await writeFile(outside, "outside\n");
    let replaced = false;
    const raceServer = await createServer({
      root: raceRoot,
      logLevel: "error",
      plugins: [createWxDevBridge(raceRoot, {
        beforeFileOpen(filePath) {
          if (replaced || filePath !== "src/sample.ts") return;
          replaced = true;
          // This hook runs after lexical/real-path checks but before descriptor open.
          renameSync(join(raceRoot, "src", "sample.ts"), join(raceRoot, "src", "sample.old.ts"));
          symlinkSync(outside, join(raceRoot, "src", "sample.ts"));
        }
      })],
      server: { port: 0 }
    });
    await raceServer.listen();
    const raceBaseUrl = raceServer.resolvedUrls!.local[0]!.replace(/\/$/, "");
    try {
      const response = await fetch(`${raceBaseUrl}${wxHostRoutes.writeFile}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filePath: "src/sample.ts", text: "replacement\n", expectedText: "original\n" })
      });
      expect(replaced).toBe(true);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad_request");
      await expect(readFile(outside, "utf8")).resolves.toBe("outside\n");
    } finally {
      await raceServer.close();
      await rm(raceRoot, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });
});
