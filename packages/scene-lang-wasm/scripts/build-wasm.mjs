import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const targetWasmPath = resolve(
  repoRoot,
  "target/wasm32-unknown-unknown/release/scene_lang_wasm.wasm"
);
const packageAssetPath = resolve(repoRoot, "packages/scene-lang-wasm/dist/scene-lang.wasm");

execFileSync(
  "cargo",
  ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", "scene-lang-wasm"],
  {
    cwd: repoRoot,
    stdio: "inherit"
  }
);

mkdirSync(dirname(packageAssetPath), { recursive: true });
copyFileSync(targetWasmPath, packageAssetPath);
