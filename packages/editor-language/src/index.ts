import type { TextChange, TextDocument } from "@mewhhaha/wx-core";

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

/** Serializable editor indentation preferences. `indentUnit` is either a tab or 1–16 spaces. */
export interface IndentationConfiguration {
  indentUnit: "\t" | string;
  tabWidth: number;
  guideWidth: number;
  lineEnding?: "\n" | "\r\n";
}

/** A best-effort answer. Providers must return this instead of allowing parser errors into editing. */
export interface IndentationResult {
  revision: number;
  status: "ok" | "stale" | "incomplete" | "error";
  /** Absolute syntax indentation depth at the requested insertion point. */
  indent?: number;
  /** Remove one or more indentation levels at the requested insertion point. */
  outdent?: number;
  /** Absolute visual column requested by an @align capture. */
  alignColumn?: number;
}

/** Optional, revision-aware syntax indentation service. Non-`ok` answers use core's plain fallback. */
export interface IndentationProvider {
  getIndentation(context: {
    document: LanguageDocumentSnapshot;
    offset: number;
    action: "enter" | "open-below" | "open-above";
    signal?: AbortSignal;
  }): Promise<IndentationResult>;
}

export interface SyntaxSelectionRange {
  from: number;
  to: number;
}

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface EditorDiagnostic {
  from: number;
  to: number;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string | number;
}

export interface CodeActionContext {
  document: LanguageDocumentSnapshot;
  selection: SyntaxSelectionRange;
  diagnostics: readonly EditorDiagnostic[];
}

export interface EditorCodeAction {
  title: string;
  kind?: string;
  diagnostics?: readonly EditorDiagnostic[];
  changes?: readonly TextChange[];
  apply?(context: CodeActionContext): Promise<readonly TextChange[] | null> | readonly TextChange[] | null;
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

export interface EditorCompletionItem {
  label: string;
  detail?: string;
  kind?: string;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  documentation?: string;
}

export interface CompletionSource {
  complete(document: LanguageDocumentSnapshot, offset: number): Promise<readonly EditorCompletionItem[]>;
}

export interface EditorLocationTarget {
  from: number;
  to: number;
  filePath?: string;
  detail?: string;
}

export interface GotoSource {
  definition?(document: LanguageDocumentSnapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
  declaration?(document: LanguageDocumentSnapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
  typeDefinition?(document: LanguageDocumentSnapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
  implementation?(document: LanguageDocumentSnapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
  references?(document: LanguageDocumentSnapshot, offset: number): Promise<readonly EditorLocationTarget[]>;
}

export interface EditorRenameChangeSet {
  filePath?: string;
  changes: readonly TextChange[];
}

export interface RenameSource {
  prepareRename?(document: LanguageDocumentSnapshot, offset: number): Promise<{ from: number; to: number } | null>;
  rename(
    document: LanguageDocumentSnapshot,
    offset: number,
    nextName: string
  ): Promise<readonly EditorRenameChangeSet[] | null>;
}

export interface EditorSymbol {
  name: string;
  detail?: string;
  kind?: string;
  from: number;
  to: number;
  filePath?: string;
  children?: readonly EditorSymbol[];
}

export interface SymbolSource {
  documentSymbols?(document: LanguageDocumentSnapshot): Promise<readonly EditorSymbol[]>;
  workspaceSymbols?(query: string, document?: LanguageDocumentSnapshot): Promise<readonly EditorSymbol[]>;
}

export interface EditorSignatureHelp {
  label: string;
  documentation?: string;
  activeParameter?: number;
}

export interface SignatureHelpSource {
  signatureHelp(document: LanguageDocumentSnapshot, offset: number): Promise<readonly EditorSignatureHelp[]>;
}

export interface EditorHover {
  content: string;
  source?: string;
}

export interface HoverSource {
  hover(document: LanguageDocumentSnapshot, offset: number): Promise<EditorHover | null>;
}

export interface DiagnosticsSource {
  diagnostics(document: LanguageDocumentSnapshot): Promise<readonly EditorDiagnostic[]>;
}

export interface CodeActionSource {
  getCodeActions(context: CodeActionContext): Promise<readonly EditorCodeAction[]>;
}

export interface Formatter {
  format(context: { document: LanguageDocumentSnapshot; selection: SyntaxSelectionRange }): Promise<readonly TextChange[]>;
}

export interface CommentToggler {
  toggleComments?(context: { document: LanguageDocumentSnapshot; selection: SyntaxSelectionRange }): Promise<readonly TextChange[]>;
  toggleBlockComments?(context: {
    document: LanguageDocumentSnapshot;
    selection: SyntaxSelectionRange;
  }): Promise<readonly TextChange[]>;
  toggleLineComments(context: { document: LanguageDocumentSnapshot; selection: SyntaxSelectionRange }): Promise<readonly TextChange[]>;
}

export type EditorLanguageServiceState = "starting" | "ready" | "failed" | "destroying" | "destroyed";
export type EditorLanguageServiceOwner = "external" | "controller" | "view";

/**
 * Optional lifecycle contract for stateful language-service bundles.
 *
 * Ownership is explicit so a view never terminates a worker supplied by a
 * controller or shared by another view. `external` is the safe default.
 */
export interface EditorLanguageServiceLifecycle {
  readonly state: EditorLanguageServiceState;
  readonly error?: Error | null;
  readonly owner?: EditorLanguageServiceOwner;
  whenReady?(): Promise<void>;
  destroy(): Promise<void> | void;
  recreate?(): EditorLanguageServices | Promise<EditorLanguageServices>;
}

export type SyntaxTextobjectMode = "around" | "inside";

export interface SyntaxTextobjectProvider {
  selectTextobject(context: {
    document: LanguageDocumentSnapshot;
    selection: SyntaxSelectionRange;
    activeOffset: number;
    object: string;
    mode: SyntaxTextobjectMode;
  }): Promise<SyntaxSelectionRange | null>;
}

export interface SyntaxNavigationProvider {
  gotoNext?(context: { document: LanguageDocumentSnapshot; activeOffset: number; kind: string }): Promise<SyntaxSelectionRange | null>;
  gotoPrev?(context: { document: LanguageDocumentSnapshot; activeOffset: number; kind: string }): Promise<SyntaxSelectionRange | null>;
}

export interface EditorLanguageServices {
  highlighter?: Highlighter;
  syntaxSelector?: SyntaxSelector;
  completion?: CompletionSource;
  goto?: GotoSource;
  rename?: RenameSource;
  symbols?: SymbolSource;
  signatureHelp?: SignatureHelpSource;
  hover?: HoverSource;
  diagnostics?: DiagnosticsSource;
  codeActions?: CodeActionSource;
  formatter?: Formatter;
  comments?: CommentToggler;
  syntaxTextobjects?: SyntaxTextobjectProvider;
  syntaxNavigation?: SyntaxNavigationProvider;
  indentation?: IndentationProvider;
  lifecycle?: EditorLanguageServiceLifecycle;
}

export type EditorLanguageServiceInput = EditorLanguageServices | readonly EditorLanguageServices[];

export interface EditorLanguageRegistration {
  id: string;
  services: EditorLanguageServices;
  aliases?: readonly string[];
  extensions?: readonly string[];
  filenames?: readonly string[];
  matchDocumentKind?: (kind: string) => boolean;
}

export interface LanguageRegistry {
  register(registration: EditorLanguageRegistration): void;
  unregister(id: string): void;
  get(id: string): EditorLanguageRegistration | null;
  resolve(kindOrId: string): EditorLanguageRegistration | null;
  resolveForFilePath(filePath: string): EditorLanguageRegistration | null;
  entries(): readonly EditorLanguageRegistration[];
  clear(): void;
}

/**
 * @deprecated Use EditorLanguageServices directly.
 */
export interface LanguageProvider extends Partial<SyntaxSelector>, Partial<IndentationProvider> {
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

  const { expandSelection, shrinkSelection, getIndentation } = provider;
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
    syntaxSelector: expandSelection || shrinkSelection ? { expandSelection, shrinkSelection } : undefined,
    indentation: getIndentation ? { getIndentation: getIndentation.bind(provider) } : undefined
  };
}

function getFileBasename(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
}

export function createLanguageRegistry(
  initialRegistrations: readonly EditorLanguageRegistration[] = []
): LanguageRegistry {
  const registrations = new Map<string, EditorLanguageRegistration>();

  for (const registration of initialRegistrations) {
    registrations.set(registration.id, registration);
  }

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
    resolveForFilePath(filePath) {
      const basename = getFileBasename(filePath);
      let matchedByExtension: EditorLanguageRegistration | null = null;
      let matchedExtensionLength = -1;

      for (const registration of registrations.values()) {
        if (registration.filenames?.includes(basename)) {
          return registration;
        }

        for (const extension of registration.extensions ?? []) {
          if (filePath.endsWith(extension) && extension.length > matchedExtensionLength) {
            matchedByExtension = registration;
            matchedExtensionLength = extension.length;
          }
        }
      }

      if (matchedByExtension) {
        return matchedByExtension;
      }

      for (const registration of registrations.values()) {
        if (registration.matchDocumentKind?.(filePath)) {
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
