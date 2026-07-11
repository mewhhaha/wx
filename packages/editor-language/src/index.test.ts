import { describe, expect, it } from "vitest";
import { createTextDocument } from "@mewhhaha/wx-core";

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

  it("resolves exact filenames before extensions", () => {
    const dockerServices = {};
    const registry = createLanguageRegistry([
      {
        id: "dockerfile",
        filenames: ["Dockerfile"],
        services: dockerServices
      },
      {
        id: "text",
        extensions: [".txt"],
        services: {}
      }
    ]);

    expect(registry.resolveForFilePath("/repo/Dockerfile")?.id).toBe("dockerfile");
    expect(registry.resolveForFilePath("/repo/Dockerfile")?.services).toBe(dockerServices);
  });

  it("prefers longest matching extension", () => {
    const declarationServices = {};
    const scriptServices = {};
    const registry = createLanguageRegistry([
      {
        id: "typescript",
        extensions: [".ts"],
        services: scriptServices
      },
      {
        id: "typescript-declaration",
        extensions: [".d.ts"],
        services: declarationServices
      }
    ]);

    expect(registry.resolveForFilePath("types/index.d.ts")?.id).toBe("typescript-declaration");
    expect(registry.resolveForFilePath("src/index.ts")?.id).toBe("typescript");
  });

  it("falls back to matchDocumentKind and returns null when unmatched", () => {
    const registry = createLanguageRegistry([
      {
        id: "scene",
        matchDocumentKind(kind) {
          return kind.endsWith(".scene");
        },
        services: {}
      }
    ]);

    expect(registry.resolveForFilePath("levels/intro.scene")?.id).toBe("scene");
    expect(registry.resolveForFilePath("notes/readme.md")).toBeNull();
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
      },
      async getIndentation({ document }) {
        return { revision: document.revision, status: "ok", indent: 1 };
      }
    };

    const services = languageProviderToServices(provider);

    expect(await services?.highlighter?.getHighlights({ fromLine: 0, toLine: 0 }, 1)).toEqual([]);
    expect(services?.syntaxSelector?.expandSelection).toBe(provider.expandSelection);
    const snapshot = { revision: 3, doc: createTextDocument("value") };
    expect(await services?.indentation?.getIndentation({ document: snapshot, offset: 0, action: "enter" }))
      .toEqual({ revision: 3, status: "ok", indent: 1 });
  });
});
