import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    demo: "src/demo.ts",
    nodeWorker: "src/treeSitterNodeWorker.ts"
  },
  format: ["esm"],
  outDir: "dist",
  target: "es2022",
  noExternal: [/@wx\/editor-/]
});
