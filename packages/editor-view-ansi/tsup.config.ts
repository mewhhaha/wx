import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/demo.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "es2022",
  noExternal: [/@wx\/editor-/]
});
