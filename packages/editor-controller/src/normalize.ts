import type { EditorLanguageServiceInput, EditorLanguageServices } from "@wx/editor-language";

export function normalizeLanguageServices(
  input: EditorLanguageServiceInput | readonly EditorLanguageServices[] | null | undefined
): EditorLanguageServices[] {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? [...(input as readonly EditorLanguageServices[])] : [input as EditorLanguageServices];
}
