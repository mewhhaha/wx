import type { EditorHostServices } from "@mewhhaha/wx-controller";

type ContractHost = Required<Pick<EditorHostServices, "readFile" | "writeFile" | "searchFiles" | "searchWorkspace" | "listFolders">>;
function textOf(value: { text: string } | string): string { return typeof value === "string" ? value : value.text; }

/** Shared conformance fixture for the Node and Deno filesystem adapters. */
export async function assertHostContract(host: ContractHost): Promise<void> {
  const opened = await host.readFile({ filePath: "src/example.txt" });
  if (textOf(opened) !== "before\n") throw new Error("host must read project-relative files");
  await host.writeFile({ filePath: "new/note.txt", text: "saved\n", expectedText: null });
  const saved = await host.readFile({ filePath: "new/note.txt" });
  if (textOf(saved) !== "saved\n") throw new Error("host must create and save nested files");
  const files = await host.searchFiles({ filePath: "src/example.txt", query: "note" });
  if (!files.some((entry) => entry.filePath === "new/note.txt")) throw new Error("host picker must include newly saved files");
  const folders = await host.listFolders({ filePath: "src/example.txt" });
  if (!folders.some((entry) => entry.folderPath === "new")) throw new Error("host picker must include newly created folders");
  await host.writeFile({ filePath: "new/żółć.txt", text: "😀 Needle needle\n", expectedText: null });
  const literal = await host.searchWorkspace({ filePath: "src/example.txt", query: "needle", mode: "literal", case: "sensitive", limit: 10 });
  if (literal.length !== 1 || literal[0]?.filePath !== "new/żółć.txt" || literal[0].fromColumn !== 10) throw new Error("workspace search must preserve non-ASCII paths and UTF-16 columns");
  const smart = await host.searchWorkspace({ filePath: "src/example.txt", query: "needle", mode: "literal", case: "smart", limit: 10 });
  if (smart.length !== 2 || smart[0]?.fromColumn !== 3) throw new Error("workspace smart case must be insensitive for lowercase queries");
  const regex = await host.searchWorkspace({ filePath: "src/example.txt", query: "N.e+dle", mode: "regex", case: "sensitive", limit: 1 });
  if (regex.length !== 1 || !regex[0]?.truncated) throw new Error("workspace regex search must honor bounded limits");
  await Promise.all([
    host.readFile({ filePath: "../outside.txt" }).then(() => { throw new Error("host permitted path traversal"); }, () => undefined),
    host.writeFile({ filePath: "../outside.txt", text: "no" }).then(() => { throw new Error("host permitted path traversal write"); }, () => undefined)
  ]);
}
