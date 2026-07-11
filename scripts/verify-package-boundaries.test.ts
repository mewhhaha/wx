import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyBrowserEntrypoints } from "./verify-package-boundaries.mjs";

const temporaryRoots: string[] = [];

async function fixturePackage(root: string, directory: string, name: string, source: string): Promise<void> {
  const packageRoot = join(root, "packages", directory);
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name,
      exports: {
        ".": {
          development: { import: "./src/index.ts" },
          import: "./dist/index.js"
        }
      }
    })
  );
  await writeFile(join(packageRoot, "src", "index.ts"), source);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("browser package boundary verification", () => {
  it("follows workspace package exports and reports a transitive Node import", async () => {
    const root = await mkdtemp(join(tmpdir(), "wx-boundary-"));
    temporaryRoots.push(root);
    await fixturePackage(root, "browser", "@fixture/browser", 'export { value } from "@fixture/portable";');
    await fixturePackage(root, "portable", "@fixture/portable", 'import { readFileSync } from "node:fs";\nexport const value = readFileSync;');

    expect(() =>
      verifyBrowserEntrypoints({
        repoRoot: root,
        browserEntrypoints: ["packages/browser/src/index.ts"]
      })
    ).toThrow(/reaches Node-only import node:fs.*browser.*portable/s);
  });

  it("accepts a browser-safe transitive workspace graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "wx-boundary-"));
    temporaryRoots.push(root);
    await fixturePackage(root, "browser", "@fixture/browser", 'export { value } from "@fixture/portable";');
    await fixturePackage(root, "portable", "@fixture/portable", "export const value = 1;");

    expect(() =>
      verifyBrowserEntrypoints({
        repoRoot: root,
        browserEntrypoints: ["packages/browser/src/index.ts"]
      })
    ).not.toThrow();
  });
});
