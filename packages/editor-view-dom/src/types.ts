import type { EditorState } from "@mewhhaha/wx-core";
import type {
  EditorCodeAction,
  EditorLanguageServiceInput,
  LanguageProvider
} from "@mewhhaha/wx-language";
import type {
  EditorController,
  EditorHostServices,
  EditorLineChange,
  EditorLineChangeKind,
  EditorUpdate
} from "@mewhhaha/wx-controller";
import type { ThemeSpec } from "@mewhhaha/wx-theme";

export interface CreateEditorOptions {
  controller?: EditorController;
  filePath?: string;
  host?: EditorHostServices;
  value?: string;
  language?: LanguageProvider | null;
  languageServices?: EditorLanguageServiceInput | null;
  theme?: ThemeSpec;
  commandThemes?: readonly ThemeSpec[];
  softWrap?: boolean;
  indentGuides?: {
    render?: boolean;
    character?: string;
    skipLevels?: number;
  };
}

export interface EditorHandle {
  controller: EditorController;
  mount(container: HTMLElement): void;
  destroy(): void;
  focus(): void;
  format(): Promise<boolean>;
  getCodeActions(): Promise<readonly EditorCodeAction[]>;
  applyCodeAction(action: EditorCodeAction): Promise<boolean>;
  subscribe(listener: (update: EditorUpdate) => void): () => void;
  getState(): EditorState;
  setFilePath(filePath: string): void;
  setLanguageServices(languageServices: EditorLanguageServiceInput | null): Promise<void>;
  setLanguage(language: LanguageProvider | null): Promise<void>;
  setTheme(theme: ThemeSpec): void;
  setValue(value: string): Promise<void>;
}

export type { EditorHostServices, EditorLineChange, EditorLineChangeKind };
