import { defineConfig } from "tsup";

const workspacePackagePattern = /^(?:@mewhhaha\/wx-|@wx\/editor-)/;

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      demo: "src/demo.ts",
      nodeWorker: "src/treeSitterNodeWorker.ts"
    },
    format: ["esm"],
    outDir: "dist",
    target: "es2022",
    noExternal: [workspacePackagePattern]
  },
  {
    entry: {
      wx: "src/cli.ts"
    },
    format: ["esm"],
    outDir: "dist",
    target: "es2022",
    platform: "node",
    banner: {
      js: "#!/usr/bin/env node"
    },
    noExternal: [workspacePackagePattern]
  }
]);
