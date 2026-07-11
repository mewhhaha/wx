/// <reference lib="deno.ns" />

import { fileURLToPath } from "node:url";
import { join } from "node:path";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliPath = join(repoRoot, "packages/editor-view-ansi/src/deno-cli.ts");
const installRoot = await Deno.makeTempDir({ prefix: "wx-deno-install-" });

try {
  const installed = await new Deno.Command(Deno.execPath(), {
    args: [
      "install",
      "--global",
      "--quiet",
      "--force",
      "--config",
      join(repoRoot, "deno.json"),
      "--conditions",
      "development",
      "--root",
      installRoot,
      "--allow-read",
      "--allow-write",
      "--allow-run=git",
      "--name",
      "wx",
      cliPath
    ],
    stdout: "piped",
    stderr: "piped"
  }).output();
  assert(installed.success, `deno install failed: ${new TextDecoder().decode(installed.stderr)}`);

  const executable = join(installRoot, "bin", Deno.build.os === "windows" ? "wx.cmd" : "wx");
  const help = await new Deno.Command(executable, {
    args: ["--help"],
    stdout: "piped",
    stderr: "piped"
  }).output();
  const stdout = new TextDecoder().decode(help.stdout);
  assert(help.success, `installed wx --help failed: ${new TextDecoder().decode(help.stderr)}`);
  assert(stdout.includes("wx (Deno terminal)"), "installed wx did not execute the Deno terminal entrypoint");
  assert(stdout.includes("Usage:"), "installed wx help omitted usage");
  console.log(`Verified deno install executable with Deno ${Deno.version.deno}`);
} finally {
  await Deno.remove(installRoot, { recursive: true });
}
