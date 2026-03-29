import type { LanguageProvider } from "@whx/editor-language";
import { defaultTheme, type ThemeSpec } from "@whx/editor-theme";
import { createEditor, type EditorHandle } from "@whx/editor-view-dom";

export class WhxEditorElement extends HTMLElement {
  private readonly mountPoint: HTMLDivElement;
  private editor: EditorHandle | null = null;
  private _value = "";
  private _language: LanguageProvider | null = null;
  private _theme: ThemeSpec = defaultTheme;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    this.mountPoint = document.createElement("div");
    root.append(this.mountPoint);
  }

  connectedCallback(): void {
    if (!this.editor) {
      this.editor = createEditor(this.mountPoint, {
        value: this._value,
        language: this._language,
        theme: this._theme
      });
    }
  }

  disconnectedCallback(): void {
    this.editor?.destroy();
    this.editor = null;
  }

  get value(): string {
    return this._value;
  }

  set value(nextValue: string) {
    this._value = nextValue;
    void this.editor?.setValue(nextValue);
  }

  get language(): LanguageProvider | null {
    return this._language;
  }

  set language(nextLanguage: LanguageProvider | null) {
    this._language = nextLanguage;
    void this.editor?.setLanguage(nextLanguage);
  }

  get theme(): ThemeSpec {
    return this._theme;
  }

  set theme(nextTheme: ThemeSpec) {
    this._theme = nextTheme;
    this.editor?.setTheme(nextTheme);
  }
}

export function defineWhxEditorElement(tagName = "whx-editor"): typeof WhxEditorElement {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, WhxEditorElement);
  }

  return customElements.get(tagName) as typeof WhxEditorElement;
}

