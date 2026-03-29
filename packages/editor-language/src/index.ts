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

export interface EditorViewport {
  fromLine: number;
  toLine: number;
}

export interface LanguageDocumentSnapshot {
  revision: number;
  doc: TextDocument;
}

export interface SyntaxSelectionRange {
  from: number;
  to: number;
}

export interface LanguageProvider {
  open(document: LanguageDocumentSnapshot): Promise<void>;
  update(document: LanguageDocumentSnapshot, changes: readonly TextChange[]): Promise<void>;
  getHighlightRanges(viewport: EditorViewport, revision: number): Promise<HighlightSpan[]>;
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
  destroy?(): Promise<void> | void;
}

export interface CompletionProvider {
  complete(document: LanguageDocumentSnapshot, offset: number): Promise<unknown[]>;
}

export interface HoverProvider {
  hover(document: LanguageDocumentSnapshot, offset: number): Promise<unknown | null>;
}

export interface DiagnosticsProvider {
  diagnostics(document: LanguageDocumentSnapshot): Promise<unknown[]>;
}

export interface FormatterProvider {
  format(document: LanguageDocumentSnapshot): Promise<readonly TextChange[]>;
}

export interface EditorServices {
  completion?: CompletionProvider;
  hover?: HoverProvider;
  diagnostics?: DiagnosticsProvider;
  formatter?: FormatterProvider;
}

export interface EditorLanguageRegistration {
  provider: LanguageProvider;
  services?: EditorServices;
}

export function createLanguageRegistry() {
  let registration: EditorLanguageRegistration | null = null;

  return {
    register(next: EditorLanguageRegistration) {
      registration = next;
    },
    current(): EditorLanguageRegistration | null {
      return registration;
    },
    clear() {
      registration = null;
    }
  };
}
