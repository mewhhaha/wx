import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const packagesDir = join(repoRoot, "packages");
function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(relative(repoRoot, path));
  }
  return files.sort();
}
function artifactFileList() {
  const packageFiles = readdirSync(packagesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    try { return listFiles(join(packagesDir, entry.name, "dist")); }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []; throw error; }
  });
  let playgroundFiles = [];
  try { playgroundFiles = listFiles(join(repoRoot, "apps", "playground", "dist")); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  return [...packageFiles, ...playgroundFiles].sort();
}
function build() { execFileSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit" }); }
build(); const first = artifactFileList(); build(); const second = artifactFileList();
if (first.join("\n") !== second.join("\n")) throw new Error("Two clean builds produced different package artifact file lists.");
const declarationLeaks = second.filter((file) => /\/dist\/(?:src\/|.*\.test\.d\.ts(?:\.map)?$|.*\.tsbuildinfo$)/.test(file));
if (declarationLeaks.length) throw new Error(`Published package artifacts contain test or duplicate source declarations:\n${declarationLeaks.join("\n")}`);
console.log(`Verified deterministic package artifacts (${second.length} files).`);
