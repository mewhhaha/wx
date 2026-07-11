import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertHostContract } from "./host-contract";
import { createNodeHostServices } from "./node-host";

describe("Node host contract", () => {
  it("matches the shared Deno host filesystem behavior", async () => {
    const root = await mkdtemp(join(tmpdir(), "wx-node-host-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src/example.txt"), "before\n");
      await assertHostContract(createNodeHostServices({ projectRoot: root }));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects a symlink that resolves outside the project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "wx-node-host-"));
    const outside = await mkdtemp(join(tmpdir(), "wx-node-outside-"));
    try {
      await writeFile(join(outside, "escape.txt"), "nope\n");
      await symlink(outside, join(root, "linked"));
      await expect(createNodeHostServices({ projectRoot: root }).readFile!({ filePath: "linked/escape.txt" })).rejects.toThrow("escapes project root");
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
});
