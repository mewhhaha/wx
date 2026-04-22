import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { loadWxTerminalConfig, resolveWxConfigDir } from "./config";

describe("wx terminal config", () => {
  it("resolves config directory by OS heuristic", () => {
    expect(
      resolveWxConfigDir({
        platform: "linux",
        env: {},
        homeDir: "/home/tester"
      })
    ).toBe("/home/tester/.config/wx");
    expect(
      resolveWxConfigDir({
        platform: "linux",
        env: { XDG_CONFIG_HOME: "/tmp/xdg" },
        homeDir: "/home/tester"
      })
    ).toBe("/tmp/xdg/wx");
    expect(
      resolveWxConfigDir({
        platform: "darwin",
        env: {},
        homeDir: "/Users/tester"
      })
    ).toBe("/Users/tester/Library/Application Support/wx");
    expect(
      resolveWxConfigDir({
        platform: "win32",
        env: { APPDATA: "C:/Users/tester/AppData/Roaming" },
        homeDir: "C:/Users/tester"
      })
    ).toBe(resolve("C:/Users/tester/AppData/Roaming", "wx"));
    expect(
      resolveWxConfigDir({
        platform: "linux",
        env: { WX_CONFIG_HOME: "/custom/wx-home" },
        homeDir: "/home/tester"
      })
    ).toBe(resolve("/custom/wx-home"));
  });

  it("loads config.json and builds language registry from grammars folder", async () => {
    const configDir = await mkdtemp(resolve(tmpdir(), "wx-config-"));
    const grammarDir = resolve(configDir, "grammars");
    const createdServices: Array<Record<string, unknown>> = [];

    await mkdir(grammarDir, { recursive: true });
    await writeFile(
      resolve(configDir, "config.json"),
      JSON.stringify({
        theme: "mint",
        indentGuides: {
          render: false,
          character: ".",
          skipLevels: 2,
          indentWidth: 4
        },
        ignoredDirectories: [".git", "vendor"]
      })
    );
    await writeFile(
      resolve(configDir, "languages.json"),
      JSON.stringify({
        languages: [
          {
            id: "typescript",
            extensions: [".ts", ".tsx"],
            filenames: ["tsconfig.json"],
            grammar: "typescript"
          }
        ]
      })
    );
    await writeFile(resolve(grammarDir, "web-tree-sitter.js"), "export {};\n");
    await writeFile(resolve(grammarDir, "web-tree-sitter.wasm"), "wasm");
    await writeFile(resolve(grammarDir, "typescript.wasm"), "wasm");
    await writeFile(resolve(grammarDir, "typescript.scm"), "(identifier) @text\n");

    const loaded = await loadWxTerminalConfig({
      configDir,
      createLanguageServices(options) {
        createdServices.push(options as Record<string, unknown>);
        return { highlighter: {} };
      }
    });

    expect(loaded.themeName).toBe("mint");
    expect(loaded.indentGuides).toEqual({
      render: false,
      character: ".",
      skipLevels: 2,
      indentWidth: 4
    });
    expect(loaded.ignoredDirectories).toEqual([".git", "vendor"]);
    expect(loaded.languageRegistry?.resolveForFilePath("src/main.ts")?.id).toBe("typescript");
    expect(loaded.languageRegistry?.resolveForFilePath("tsconfig.json")?.id).toBe("typescript");
    expect(createdServices).toEqual([
      expect.objectContaining({
        parserRuntimeUrl: resolve(grammarDir, "web-tree-sitter.js"),
        parserWasmUrl: resolve(grammarDir, "web-tree-sitter.wasm"),
        languageWasmUrl: resolve(grammarDir, "typescript.wasm"),
        query: "(identifier) @text\n"
      })
    ]);
  });
});
