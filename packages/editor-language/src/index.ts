import type { TextChange, TextDocument } from "@whx/editor-core";

export type HighlightRole =
  | "text"
  | "comment"
  | "function"
  | "gutter"
  | "keyword"
  | "number"
  | "operator"
  | "punctuation"
  | "selection"
  | "string"
  | "type"
  | "cursor";

export interface HighlightSpan {
  from: number;
  to: number;
  role: HighlightRole;
}

export interface EditorLineRange {
  fromLine: number;
  toLine: number;
}

/**
 * @deprecated Use EditorLineRange.
 */
export type EditorViewport = EditorLineRange;

export interface LanguageDocumentSnapshot {
  revision: number;
  doc: TextDocument;
}

export interface SyntaxSelectionRange {
  from: number;
  to: number;
}

export interface Highlighter {
  open(document: LanguageDocumentSnapshot): Promise<void>;
  update(document: LanguageDocumentSnapshot, changes: readonly TextChange[]): Promise<void>;
  getHighlights(lines: EditorLineRange, revision: number): Promise<HighlightSpan[]>;
  destroy?(): Promise<void> | void;
}

export interface SyntaxSelector {
  expandSelection?(
    selection: SyntaxSelectionRange,
    activeOffset: number,
    revision: number
  ): Promise<SyntaxSelectionRange | null>;
  shrinkSelection?(
    selection: SyntaxSelectionRange,
    activeOffset: number,
    revision: number
  ): Promise<SyntaxSelectionRange | null>;
}

export interface CompletionSource {
  complete(document: LanguageDocumentSnapshot, offset: number): Promise<unknown[]>;
}

export interface HoverSource {
  hover(document: LanguageDocumentSnapshot, offset: number): Promise<unknown | null>;
}

export interface DiagnosticsSource {
  diagnostics(document: LanguageDocumentSnapshot): Promise<unknown[]>;
}

export interface Formatter {
  format(document: LanguageDocumentSnapshot): Promise<readonly TextChange[]>;
}

export interface EditorLanguageServices {
  highlighter?: Highlighter;
  syntaxSelector?: SyntaxSelector;
  completion?: CompletionSource;
  hover?: HoverSource;
  diagnostics?: DiagnosticsSource;
  formatter?: Formatter;
}

export interface EditorLanguageRegistration {
  id: string;
  services: EditorLanguageServices;
  aliases?: readonly string[];
  matchDocumentKind?: (kind: string) => boolean;
}

export interface LanguageRegistry {
  register(registration: EditorLanguageRegistration): void;
  unregister(id: string): void;
  get(id: string): EditorLanguageRegistration | null;
  resolve(kindOrId: string): EditorLanguageRegistration | null;
  entries(): readonly EditorLanguageRegistration[];
  clear(): void;
}

/**
 * @deprecated Use EditorLanguageServices directly.
 */
export interface LanguageProvider extends Partial<SyntaxSelector> {
  open(document: LanguageDocumentSnapshot): Promise<void>;
  update(document: LanguageDocumentSnapshot, changes: readonly TextChange[]): Promise<void>;
  getHighlights?(lines: EditorLineRange, revision: number): Promise<HighlightSpan[]>;
  getHighlightRanges?(viewport: EditorViewport, revision: number): Promise<HighlightSpan[]>;
  destroy?(): Promise<void> | void;
}

export function languageProviderToServices(provider: LanguageProvider | null): EditorLanguageServices | null {
  if (!provider) {
    return null;
  }

  const { expandSelection, shrinkSelection } = provider;
  const highlighter: Highlighter = {
    open(document) {
      return provider.open(document);
    },
    update(document, changes) {
      return provider.update(document, changes);
    },
    getHighlights(lines, revision) {
      if (provider.getHighlights) {
        return provider.getHighlights(lines, revision);
      }

      if (provider.getHighlightRanges) {
        return provider.getHighlightRanges(lines, revision);
      }

      return Promise.resolve([]);
    },
    destroy() {
      return provider.destroy?.();
    }
  };

  return {
    highlighter,
    syntaxSelector: expandSelection || shrinkSelection ? { expandSelection, shrinkSelection } : undefined
  };
}

export function createLanguageRegistry(): LanguageRegistry {
  const registrations = new Map<string, EditorLanguageRegistration>();

  return {
    register(registration) {
      registrations.set(registration.id, registration);
    },
    unregister(id) {
      registrations.delete(id);
    },
    get(id) {
      return registrations.get(id) ?? null;
    },
    resolve(kindOrId) {
      const direct = registrations.get(kindOrId);

      if (direct) {
        return direct;
      }

      for (const registration of registrations.values()) {
        if (registration.aliases?.includes(kindOrId) || registration.matchDocumentKind?.(kindOrId)) {
          return registration;
        }
      }

      return null;
    },
    entries() {
      return [...registrations.values()];
    },
    clear() {
      registrations.clear();
    }
  };
}
