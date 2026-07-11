import { afterEach, describe, expect, it, vi } from "vitest";

import { wxHostClient } from "../src/host-client";

describe("playground host client", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("aborts a superseded workspace request while allowing its replacement to complete", async () => {
    let firstRequestAborted = false;
    let requestCount = 0;
    vi.stubGlobal("fetch", (_path: string, options: RequestInit) => {
      requestCount += 1;
      if (requestCount === 2) return Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 }));
      return new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          firstRequestAborted = true;
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      });
    });

    const first = new AbortController();
    const superseded = wxHostClient.searchWorkspace({ filePath: "src/sample.ts", query: "first", mode: "literal", case: "smart", limit: 10 }, first.signal);
    first.abort();
    const replacement = wxHostClient.searchWorkspace({ filePath: "src/sample.ts", query: "second", mode: "literal", case: "smart", limit: 10 });

    await expect(superseded).rejects.toMatchObject({ name: "AbortError" });
    await expect(replacement).resolves.toEqual({ results: [] });
    expect(firstRequestAborted).toBe(true);
  });
});
