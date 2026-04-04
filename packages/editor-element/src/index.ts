import type { EditorController, EditorUpdate } from "@wx/editor-controller";
import type { EditorLanguageServices, LanguageProvider } from "@wx/editor-language";
import { languageProviderToServices } from "@wx/editor-language";
import { defaultTheme, type ThemeSpec } from "@wx/editor-theme";
import { createEditor, type EditorHandle } from "@wx/editor-view-dom";

export class WxEditorElement extends HTMLElement {
  private readonly mountPoint: HTMLDivElement;
  private editor: EditorHandle | null = null;
  private unsubscribe = () => {};
  private _value = "";
  private _language: LanguageProvider | null = null;
  private _languageServices: EditorLanguageServices | null = null;
  private _theme: ThemeSpec = defaultTheme;
  private _controller: EditorController | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    this.mountPoint = document.createElement("div");
    root.append(this.mountPoint);
  }

  connectedCallback(): void {
    if (!this.editor) {
      this.editor = createEditor(this.mountPoint, {
        controller: this._controller ?? undefined,
        value: this._value,
        languageServices: this._languageServices ?? languageProviderToServices(this._language),
        theme: this._theme
      });
      this._controller = this.editor.controller;
      this.unsubscribe = this.editor.subscribe((update) => this.dispatchUpdateEvents(update));
    }
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.unsubscribe = () => {};
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

  get controller(): EditorController | null {
    return this._controller;
  }

  set controller(nextController: EditorController | null) {
    this._controller = nextController;

    if (this.isConnected) {
      this.disconnectedCallback();
      this.connectedCallback();
    }
  }

  get languageServices(): EditorLanguageServices | null {
    return this._languageServices;
  }

  set languageServices(nextLanguageServices: EditorLanguageServices | null) {
    this._languageServices = nextLanguageServices;
    void this.editor?.setLanguageServices(nextLanguageServices);
  }

  get language(): LanguageProvider | null {
    return this._language;
  }

  set language(nextLanguage: LanguageProvider | null) {
    this._language = nextLanguage;
    this._languageServices = languageProviderToServices(nextLanguage);
    void this.editor?.setLanguage(nextLanguage);
  }

  get theme(): ThemeSpec {
    return this._theme;
  }

  set theme(nextTheme: ThemeSpec) {
    this._theme = nextTheme;
    this.editor?.setTheme(nextTheme);
  }

  private dispatchUpdateEvents(update: EditorUpdate): void {
    this.dispatchEvent(new CustomEvent("wx-update", { detail: update }));

    if (update.modeChanged) {
      this.dispatchEvent(new CustomEvent("wx-mode-change", { detail: update.nextState.mode }));
    }

    if (update.selectionChanged) {
      this.dispatchEvent(new CustomEvent("wx-selection-change", { detail: update.nextState.selection }));
    }
  }
}

export function defineWxEditorElement(tagName = "wx-editor"): typeof WxEditorElement {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, WxEditorElement);
  }

  return customElements.get(tagName) as typeof WxEditorElement;
}
