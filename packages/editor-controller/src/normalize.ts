import type { EditorLanguageServiceInput, EditorLanguageServices } from "@mewhhaha/wx-language";

export function normalizeLanguageServices(
  input: EditorLanguageServiceInput | readonly EditorLanguageServices[] | null | undefined
): EditorLanguageServices[] {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? [...(input as readonly EditorLanguageServices[])] : [input as EditorLanguageServices];
}
