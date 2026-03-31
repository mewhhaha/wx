import { describe, expect, it } from "vitest";

import { createLanguageRegistry, languageProviderToServices, type LanguageProvider } from "./index";

describe("language registry", () => {
  it("stores and resolves keyed registrations", () => {
    const registry = createLanguageRegistry();
    const provider: LanguageProvider = {
      async open() {},
      async update() {},
      async getHighlights() {
        return [];
      }
    };

    registry.register({
      id: "typescript",
      aliases: ["ts"],
      matchDocumentKind(kind) {
        return kind.endsWith(".ts");
      },
      services: languageProviderToServices(provider) ?? {}
    });

    expect(registry.get("typescript")?.services.highlighter).toMatchObject({
      open: expect.any(Function),
      update: expect.any(Function),
      getHighlights: expect.any(Function)
    });
    expect(registry.resolve("ts")?.id).toBe("typescript");
    expect(registry.resolve("index.ts")?.id).toBe("typescript");
    expect(registry.entries()).toHaveLength(1);
    registry.unregister("typescript");
    expect(registry.get("typescript")).toBeNull();
  });

  it("wraps a legacy language provider into split services", async () => {
    const provider: LanguageProvider = {
      async open() {},
      async update() {},
      async getHighlights() {
        return [];
      },
      async expandSelection() {
        return null;
      }
    };

    const services = languageProviderToServices(provider);

    expect(await services?.highlighter?.getHighlights({ fromLine: 0, toLine: 0 }, 1)).toEqual([]);
    expect(services?.syntaxSelector?.expandSelection).toBe(provider.expandSelection);
  });
});
