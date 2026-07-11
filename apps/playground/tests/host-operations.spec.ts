import { expect, test } from "./browser-test";

type HostResult = {
  read: { text: string };
  search: Array<{ filePath: string; detail?: string }>;
  folders: Array<{ folderPath: string }>;
  write: { text: string };
  changes: Array<{ line: number; kind: string }>;
};

test("controller host adapter uses the Vite POST bridge for every host operation", async ({ page }) => {
  const requests: Array<{ pathname: string; payload: unknown }> = [];
  page.on("request", (request) => {
    if (!request.url().includes("/__wx__/")) return;
    requests.push({ pathname: new URL(request.url()).pathname, payload: request.postDataJSON() });
  });

  await page.goto("./?host-test=1");
  await expect(page.locator("[data-wx-editor='root']").first()).toBeVisible();

  const result = await page.evaluate(async (): Promise<HostResult> => {
    type Adapter = {
      readFile(context: { filePath: string }): Promise<{ text: string }>;
      searchFiles(context: { filePath: string; query: string }): Promise<Array<{ filePath: string; detail?: string }>>;
      listFolders(context: { filePath: string }): Promise<Array<{ folderPath: string }>>;
      writeFile(context: { filePath: string; text: string; expectedText?: string | null }): Promise<void>;
      getLineChanges(context: { filePath: string; text: string }): Promise<Array<{ line: number; kind: string }>>;
    };
    const adapter = (window as Window & { __wxHostTestAdapter?: Adapter }).__wxHostTestAdapter;
    if (!adapter) throw new Error("The development host adapter was not exposed.");
    const filePath = "apps/playground/src/main.ts";
    const [read, search, folders, changes] = await Promise.all([
      adapter.readFile({ filePath }),
      adapter.searchFiles({ filePath, query: "main" }),
      adapter.listFolders({ filePath }),
      adapter.getLineChanges({ filePath, text: "changed\n" })
    ]);
    // A successful compare-and-write of the exact bytes proves the controller
    // adapter's mutation path while leaving the checked-out file unchanged.
    await adapter.writeFile({ filePath, text: read.text, expectedText: read.text });
    return { read, search, folders, write: { text: read.text }, changes };
  });

  expect(result.read.text).toContain("const shaderFilePath");
  expect(result.search).toContainEqual({ filePath: "apps/playground/src/main.ts", detail: "repo" });
  expect(result.folders).toContainEqual({ folderPath: "apps/playground/src" });
  expect(result.write.text).toBe(result.read.text);
  expect(result.changes.length).toBeGreaterThan(0);

  expect(requests).toEqual(expect.arrayContaining([
    { pathname: "/__wx__/read", payload: { filePath: "apps/playground/src/main.ts" } },
    { pathname: "/__wx__/search", payload: { filePath: "apps/playground/src/main.ts", scope: "repo", query: "main" } },
    { pathname: "/__wx__/folders", payload: { filePath: "apps/playground/src/main.ts" } },
    { pathname: "/__wx__/line-changes", payload: { filePath: "apps/playground/src/main.ts", text: "changed\n" } }
  ]));
  expect(requests).toContainEqual({
    pathname: "/__wx__/write",
    payload: { filePath: "apps/playground/src/main.ts", text: result.read.text, expectedText: result.read.text }
  });
});
