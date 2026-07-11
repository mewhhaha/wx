/// <reference lib="deno.ns" />

import { join } from "node:path";
import { loadDenoTerminalConfig } from "./deno-config.ts";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function fixture(run: (root: string) => Promise<void>): Promise<void> { const root = await Deno.makeTempDir({ prefix: "wx-deno-config-" }); try { await run(root); } finally { await Deno.remove(root, { recursive: true }); } }

Deno.test("plain Deno config is lazy and creates no syntax service", async () => {
  await fixture(async (root) => {
    await Deno.mkdir(join(root, ".wx")); await Deno.writeTextFile(join(root, ".wx", "config.json"), JSON.stringify({ theme: "ph" }));
    let created = 0;
    const config = await loadDenoTerminalConfig(root, { createLanguageServices: () => { created += 1; return {}; } });
    assert(config.languageRegistry === null, "plain config unexpectedly created a registry"); assert(created === 0, "plain config unexpectedly created a language service");
  });
});

Deno.test("Deno config validates and returns the shared serializable keymap", async () => {
  await fixture(async (root) => {
    await Deno.mkdir(join(root, ".wx"));
    await Deno.writeTextFile(join(root, ".wx", "config.json"), JSON.stringify({
      keymap: { version: 1, bindings: [
        { keys: "q h", command: "motion.left", modes: ["normal"] },
        { keys: "q l", command: "motion.right", modes: ["normal"] }
      ] }
    }));
    const config = await loadDenoTerminalConfig(root);
    assert(config.keymap?.bindings?.[0]?.keys === "q h", "keymap was not returned");
    await Deno.writeTextFile(join(root, ".wx", "config.json"), JSON.stringify({ keymap: { version: 1, bindings: [{ keys: "x", command: "missing.command" }] } }));
    await loadDenoTerminalConfig(root).then(
      () => { throw new Error("invalid keymap was accepted"); },
      (error) => assert(String(error).includes("Invalid keymap configuration") && String(error).includes("invalid-command"), `unexpected keymap error: ${error}`)
    );
  });
});

Deno.test("configured Deno language registry matches aliases, extensions, and filenames", async () => {
  await fixture(async (root) => {
    const grammars = join(root, ".wx", "grammars"); await Deno.mkdir(grammars, { recursive: true });
    await Promise.all(["web-tree-sitter.wasm", "typescript.wasm", "typescript.scm", "typescript-indent.scm"].map((name) => Deno.writeTextFile(join(grammars, name), "asset")));
    await Deno.writeTextFile(join(root, ".wx", "config.json"), JSON.stringify({ languages: [{ id: "typescript", aliases: ["ts"], extensions: [".ts"], filenames: ["tsconfig.json"], grammar: "typescript", indentQueryFile: "typescript-indent.scm" }] }));
    const created: Array<Record<string, unknown>> = [];
    const config = await loadDenoTerminalConfig(root, { createLanguageServices: (options) => { created.push(options); return {}; } });
    assert(config.languageRegistry?.resolve("ts")?.id === "typescript", "alias did not resolve"); assert(config.languageRegistry?.resolveForFilePath("src/main.ts")?.id === "typescript", "extension did not resolve"); assert(config.languageRegistry?.resolveForFilePath("tsconfig.json")?.id === "typescript", "filename did not resolve"); assert(created.length === 1 && created[0]?.owner === "controller", "service is not controller-owned"); assert(typeof created[0]?.indentQuery === "string", "indent query was not loaded");
  });
});

Deno.test("Deno language config rejects escaped and missing grammar assets", async () => {
  await fixture(async (root) => {
    const grammars = join(root, ".wx", "grammars"); await Deno.mkdir(grammars, { recursive: true }); await Deno.writeTextFile(join(grammars, "web-tree-sitter.wasm"), "asset");
    await Deno.writeTextFile(join(root, ".wx", "config.json"), JSON.stringify({ languages: [{ id: "bad", wasm: "../outside.wasm" }] }));
    await loadDenoTerminalConfig(root).then(() => { throw new Error("escaped asset was accepted"); }, (error) => assert(String(error).includes("escapes .wx/grammars"), `unexpected escape error: ${error}`));
    await Deno.writeTextFile(join(root, ".wx", "config.json"), JSON.stringify({ languages: [{ id: "missing" }] }));
    await loadDenoTerminalConfig(root).then(() => { throw new Error("missing grammar was accepted"); }, (error) => assert(String(error).includes("Missing grammar wasm for missing"), `unexpected missing error: ${error}`));
  });
});

Deno.test("Deno language config rejects grammar assets reached through an in-root symlink", async () => {
  await fixture(async (root) => {
    const grammars = join(root, ".wx", "grammars"); const outside = join(root, "outside.wasm");
    await Deno.mkdir(grammars, { recursive: true }); await Deno.writeTextFile(join(grammars, "web-tree-sitter.wasm"), "asset"); await Deno.writeTextFile(outside, "asset");
    await Deno.symlink(outside, join(grammars, "escaped.wasm")); await Deno.writeTextFile(join(grammars, "bad.scm"), "(identifier) @type");
    await Deno.writeTextFile(join(root, ".wx", "config.json"), JSON.stringify({ languages: [{ id: "bad", wasm: "escaped.wasm", queryFile: "bad.scm" }] }));
    await loadDenoTerminalConfig(root).then(() => { throw new Error("symlink escape was accepted"); }, (error) => assert(String(error).includes("through a symlink"), `unexpected symlink error: ${error}`));
  });
});

Deno.test("Deno language config rejects a grammar-root symlink outside the project", async () => {
  await fixture(async (root) => {
    const outside = await Deno.makeTempDir({ prefix: "wx-deno-grammar-outside-" });
    try {
      await Deno.mkdir(join(root, ".wx"), { recursive: true });
      await Promise.all(["web-tree-sitter.wasm", "bad.wasm", "bad.scm"].map((name) => Deno.writeTextFile(join(outside, name), "asset")));
      await Deno.symlink(outside, join(root, ".wx", "grammars"));
      await Deno.writeTextFile(join(root, ".wx", "config.json"), JSON.stringify({ languages: [{ id: "bad" }] }));
      await loadDenoTerminalConfig(root).then(
        () => { throw new Error("grammar-root symlink escape was accepted"); },
        (error) => assert(String(error).includes("escapes the project root through a symlink"), `unexpected grammar-root error: ${error}`)
      );
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  });
});
