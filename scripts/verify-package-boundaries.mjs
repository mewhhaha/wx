import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = resolve(import.meta.dirname, "..");
const portablePackages = ["editor-core", "editor-language", "editor-layout", "editor-theme", "editor-controller"];
const defaultBrowserEntrypoints = [
  "packages/editor-view-dom/src/index.ts",
  "packages/editor-element/src/index.ts",
  "packages/editor-tree-sitter/src/index.ts"
];
const NODE_ONLY_SPECIFIER = /^(?:node:)?(?:fs|path|child_process|worker_threads|process|module)(?:\/|$)/;
const IMPORT_SPECIFIER = /(?:from\s*|import\s*)["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
const CROSS_PACKAGE_SRC_IMPORT = /(?:from\s*|import\s*\()["'](?:\.\.\/)+[^"']+\/src(?:\/[^"']+)?["']/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function collectTypeScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(file));
    else if (entry.isFile() && file.endsWith(".ts") && !file.endsWith(".test.ts")) files.push(file);
  }
  return files;
}

function selectSourceExport(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  return (
    selectSourceExport(value.development) ??
    selectSourceExport(value.import) ??
    selectSourceExport(value.default) ??
    selectSourceExport(value.types)
  );
}

function buildWorkspacePackageIndex(repoRoot) {
  const packagesDir = join(repoRoot, "packages");
  const index = new Map();

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = join(packagesDir, entry.name);
    const manifestPath = join(packageDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (typeof manifest.name === "string") index.set(manifest.name, { packageDir, manifest });
  }

  return index;
}

function resolveExistingSource(path) {
  const extension = extname(path);
  const candidates = [
    path,
    extension === ".js" ? `${path.slice(0, -3)}.ts` : null,
    extension ? null : `${path}.ts`,
    extension ? null : `${path}.tsx`,
    join(path, "index.ts")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return resolve(candidate);
  }
  return null;
}

function resolveWorkspaceSpecifier(specifier, packageIndex) {
  const packageName = [...packageIndex.keys()]
    .sort((left, right) => right.length - left.length)
    .find((name) => specifier === name || specifier.startsWith(`${name}/`));
  if (!packageName) return null;

  const entry = packageIndex.get(packageName);
  const suffix = specifier.slice(packageName.length);
  const subpath = suffix ? `.${suffix}` : ".";
  const exportsMap = entry.manifest.exports;
  const exportValue = exportsMap && typeof exportsMap === "object" ? exportsMap[subpath] : null;
  const target = selectSourceExport(exportValue);
  if (!target) throw new Error(`Workspace package ${packageName} does not expose ${subpath}`);
  const resolved = resolveExistingSource(resolve(entry.packageDir, target));
  if (!resolved) throw new Error(`Workspace export ${specifier} points to missing source ${target}`);
  return resolved;
}

function importedSpecifiers(source) {
  return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? match[2]).filter(Boolean);
}

export function verifyBrowserEntrypoints({
  repoRoot,
  browserEntrypoints = defaultBrowserEntrypoints
}) {
  const packageIndex = buildWorkspacePackageIndex(repoRoot);

  for (const entrypoint of browserEntrypoints) {
    const entrypointPath = resolve(repoRoot, entrypoint);
    const visited = new Set();

    const visit = (file, chain) => {
      const normalized = resolve(file);
      if (visited.has(normalized)) return;
      visited.add(normalized);
      const source = readFileSync(normalized, "utf8");

      for (const specifier of importedSpecifiers(source)) {
        if (NODE_ONLY_SPECIFIER.test(specifier)) {
          const trace = [...chain, relative(repoRoot, normalized)].join(" -> ");
          throw new Error(`Browser entrypoint ${entrypoint} reaches Node-only import ${specifier} via ${trace}`);
        }

        let next = null;
        if (specifier.startsWith(".")) next = resolveExistingSource(resolve(dirname(normalized), specifier));
        else next = resolveWorkspaceSpecifier(specifier, packageIndex);
        if (next) visit(next, [...chain, relative(repoRoot, normalized)]);
      }
    };

    visit(entrypointPath, []);
  }
}

function verifyPortablePackages(repoRoot) {
  for (const packageName of portablePackages) {
    const packageDir = join(repoRoot, "packages", packageName);
    const nodePackage = readJson(join(packageDir, "package.json"));
    const denoPackage = readJson(join(packageDir, "deno.json"));
    if (nodePackage.version !== denoPackage.version || nodePackage.name !== denoPackage.name) {
      throw new Error(`${packageName} package.json and deno.json must have matching name and version`);
    }

    for (const file of collectTypeScriptFiles(join(packageDir, "src"))) {
      for (const specifier of importedSpecifiers(readFileSync(file, "utf8"))) {
        if (NODE_ONLY_SPECIFIER.test(specifier)) {
          throw new Error(`Portable package ${packageName} imports Node-only module ${specifier} in ${relative(repoRoot, file)}`);
        }
      }
    }
  }
}

export function verifyPackageBoundaries(repoRoot = defaultRepoRoot) {
  verifyPortablePackages(repoRoot);
  const packagesDir = join(repoRoot, "packages");
  const leaks = collectTypeScriptFiles(packagesDir)
    .filter((file) => CROSS_PACKAGE_SRC_IMPORT.test(readFileSync(file, "utf8")))
    .map((file) => relative(repoRoot, file));
  if (leaks.length) throw new Error(`Cross-package src imports are forbidden:\n${leaks.join("\n")}`);
  verifyBrowserEntrypoints({ repoRoot });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  verifyPackageBoundaries();
  console.log("Package runtime and source boundaries verified.");
}
