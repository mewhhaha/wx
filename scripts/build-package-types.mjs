import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageDir = process.cwd();
const sourceDir = resolve(packageDir, "src");
const outDir = resolve(packageDir, "dist");
const tempDir = mkdtempSync(join(tmpdir(), "wx-types-"));
const tempConfigPath = join(tempDir, "tsconfig.json");

function collectSourceFiles(directory, excludedBasenames = []) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(path, excludedBasenames));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !excludedBasenames.includes(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

const packageManifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const declarationExclude = Array.isArray(packageManifest.wx?.declarationExclude)
  ? packageManifest.wx.declarationExclude
  : [];

writeFileSync(
  tempConfigPath,
  JSON.stringify(
    {
      extends: resolve(packageDir, "tsconfig.json"),
      compilerOptions: {
        noEmit: false,
        emitDeclarationOnly: true,
        declaration: true,
        declarationMap: true,
        outDir,
        rootDir: sourceDir,
        ignoreDeprecations: "6.0",
        typeRoots: [resolve(packageDir, "../../node_modules/@types")],
        tsBuildInfoFile: join(tempDir, "tsconfig.types.tsbuildinfo")
      },
      include: [],
      exclude: ["src/**/*.test.ts"],
      files: collectSourceFiles(sourceDir, declarationExclude)
    },
    null,
    2
  )
);

try {
  execFileSync("tsc", ["-p", tempConfigPath], {
    stdio: "inherit"
  });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
