import type { EditorController, EditorUpdate } from "@mewhhaha/wx-controller";
import type { EditorLanguageServiceInput, LanguageProvider } from "@mewhhaha/wx-language";
import { languageProviderToServices } from "@mewhhaha/wx-language";
import { defaultTheme, type ThemeSpec } from "@mewhhaha/wx-theme";
import { createEditor, type EditorHandle } from "@mewhhaha/wx-dom";

export class WxEditorElement extends HTMLElement {
  private readonly mountPoint: HTMLDivElement;
  private editor: EditorHandle | null = null;
  private unsubscribe = () => {};
  private _value = "";
  private _language: LanguageProvider | null = null;
  private _languageServices: EditorLanguageServiceInput | null = null;
  private _theme: ThemeSpec = defaultTheme;
  private _controller: EditorController | null = null;
  // Keep this separate from `_controller`: a controller created by the element
  // belongs to its current connection, while a supplied controller survives a
  // disconnect and remains the caller's responsibility.
  private suppliedController: EditorController | null = null;
  private pendingValue: string | null = null;
  private connection = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    this.mountPoint = document.createElement("div");
    root.append(this.mountPoint);
  }

  connectedCallback(): void {
    if (!this.editor) {
      const connection = ++this.connection;
      this.editor = createEditor(this.mountPoint, {
        controller: this.suppliedController ?? undefined,
        value: this._value,
        languageServices: this._languageServices ?? languageProviderToServices(this._language),
        theme: this._theme
      });
      this._controller = this.editor.controller;
      if (this.suppliedController && this.pendingValue !== null) {
        void this.editor.setValue(this.pendingValue);
      } else {
        this._value = this.editor.getState().doc.text;
      }
      this.pendingValue = null;
      this.unsubscribe = this.editor.subscribe((update) => this.dispatchUpdateEvents(update, connection));
    }
  }

  disconnectedCallback(): void {
    ++this.connection;
    this.unsubscribe();
    this.unsubscribe = () => {};
    this.editor?.destroy();
    this.editor = null;
    if (!this.suppliedController) this._controller = null;
  }

  get value(): string {
    return this._value;
  }

  set value(nextValue: string) {
    this._value = nextValue;
    if (this.editor) {
      void this.editor.setValue(nextValue);
    } else {
      this.pendingValue = nextValue;
    }
  }

  get controller(): EditorController | null {
    return this._controller;
  }

  set controller(nextController: EditorController | null) {
    this.suppliedController = nextController;
    this._controller = nextController;
    this.pendingValue = null;
    if (nextController) this._value = nextController.getState().doc.text;

    if (this.isConnected) {
      this.disconnectedCallback();
      this.connectedCallback();
    }
  }

  get languageServices(): EditorLanguageServiceInput | null {
    return this._languageServices;
  }

  set languageServices(nextLanguageServices: EditorLanguageServiceInput | null) {
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

  private dispatchUpdateEvents(update: EditorUpdate, connection: number): void {
    // Controller work can complete after a DOM removal. Do not let stale work
    // escape the element, and make the public value mirror real editor edits.
    if (!this.isConnected || connection !== this.connection) return;
    this._value = update.nextState.doc.text;
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
