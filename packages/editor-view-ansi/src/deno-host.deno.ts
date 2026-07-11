import { assertHostContract } from "./host-contract.ts";
import { createDenoHostServices, resolveDenoProjectRoot } from "./deno-host.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function assertRejects(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { return; }
  throw new Error("Expected operation to reject");
}

Deno.test("Deno host passes the shared filesystem contract and contains paths", async () => {
  const root = await Deno.makeTempDir({ prefix: "wx-deno-host-" });
  try {
    await Deno.mkdir(`${root}/src`);
    await Deno.writeTextFile(`${root}/src/example.txt`, "before\n");
    await assertHostContract(createDenoHostServices({ projectRoot: root }));
  } finally { await Deno.remove(root, { recursive: true }); }
});

Deno.test("Deno project root uses Git when available and cwd otherwise", async () => {
  const root = await Deno.makeTempDir({ prefix: "wx-deno-root-" });
  try {
    await Deno.mkdir(`${root}/nested`, { recursive: true });
    assertEquals(await resolveDenoProjectRoot(`${root}/nested`), `${root}/nested`);
    const init = await new Deno.Command("git", { args: ["init", "-q", root], stdout: "null", stderr: "null" }).output();
    if (init.success) assertEquals(await resolveDenoProjectRoot(`${root}/nested`), root);
    await assertRejects(() => createDenoHostServices({ projectRoot: root }).readFile!({ filePath: "../escape" }));
  } finally { await Deno.remove(root, { recursive: true }); }
});
