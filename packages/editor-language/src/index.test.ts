import { describe, expect, it } from "vitest";

import { createLanguageRegistry, type LanguageProvider } from "./index";

describe("language registry", () => {
  it("stores and replaces registrations", () => {
    const registry = createLanguageRegistry();
    const provider: LanguageProvider = {
      async open() {},
      async update() {},
      async getHighlightRanges() {
        return [];
      }
    };

    registry.register({
      provider,
      services: {}
    });

    expect(registry.current()?.provider).toBe(provider);
    registry.clear();
    expect(registry.current()).toBeNull();
  });
});

