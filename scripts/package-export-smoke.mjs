import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdir(join(tmpdir(), "wx-export-smoke-"), { recursive: true }).then(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  return await mkdtemp(join(tmpdir(), "wx-export-smoke-"));
});

const packages = [
  ["@mewhhaha/wx-core", "packages/editor-core"],
  ["@mewhhaha/wx-language", "packages/editor-language"],
  ["@mewhhaha/wx-layout", "packages/editor-layout"],
  ["@mewhhaha/wx-theme", "packages/editor-theme"],
  ["@mewhhaha/wx-controller", "packages/editor-controller"],
  ["@mewhhaha/wx-dom", "packages/editor-view-dom"],
  ["@mewhhaha/wx-element", "packages/editor-element"],
  ["@wx/editor-tree-sitter", "packages/editor-tree-sitter"],
  ["@wx/editor-view-ansi", "packages/editor-view-ansi"],
  ["@wx/scene-lang-wasm", "packages/scene-lang-wasm"],
  ["@wx/scene-lang-worker", "packages/scene-lang-worker"]
];

try {
  for (const [specifier, packagePath] of packages) {
    const linkPath = join(tempRoot, "node_modules", ...specifier.split("/"));
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(resolve(repoRoot, packagePath), linkPath, "dir");
  }

  const entryPath = join(tempRoot, "entry.mjs");
  await writeFile(
    entryPath,
    `
globalThis.HTMLElement ??= class HTMLElement {};

const modules = [
  "@mewhhaha/wx-core",
  "@mewhhaha/wx-language",
  "@mewhhaha/wx-layout",
  "@mewhhaha/wx-theme",
  "@mewhhaha/wx-controller",
  "@mewhhaha/wx-dom",
  "@mewhhaha/wx-element",
  "@wx/editor-tree-sitter",
  "@wx/editor-tree-sitter/node",
  "@wx/editor-view-ansi",
  "@wx/scene-lang-wasm",
  "@wx/scene-lang-worker"
];

for (const specifier of modules) {
  await import(specifier);
}

const sceneWasmUrl = import.meta.resolve("@wx/scene-lang-wasm/scene-lang.wasm");
if (!sceneWasmUrl.endsWith("/dist/scene-lang.wasm")) {
  throw new Error(\`Unexpected scene wasm export path: \${sceneWasmUrl}\`);
}
`
  );

  await import(pathToFileURL(entryPath).href);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
