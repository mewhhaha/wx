import { createEditorState, createSelection, type EditorState } from "@wx/editor-core";
import type { EditorController, EditorUpdate } from "@wx/editor-controller";
import {
  languageProviderToServices,
  type EditorCodeAction,
  type EditorLanguageServiceInput,
  type EditorLanguageServices,
  type LanguageProvider
} from "@wx/editor-language";
import type { ThemeSpec } from "@wx/editor-theme";

import type { DomEditorContext, DomEditorRuntime } from "./dom-runtime";

interface CreateDomHandleRuntimeOptions {
  controller: EditorController;
  context: DomEditorContext;
  runtime: DomEditorRuntime;
  normalizeLanguageServices(input: EditorLanguageServiceInput | null | undefined): EditorLanguageServices[];
  unsubscribeController(): void;
  disconnectResizeObserver(): void;
}

export interface DomHandleRuntime {
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

export function createDomHandleRuntime(options: CreateDomHandleRuntimeOptions): DomHandleRuntime {
  const destroyLanguageServices = () => {
    for (const services of options.context.languageServices) {
      services.highlighter?.destroy?.();
    }
  };

  const focusInput = () => {
    const textarea = options.context.root.querySelector("[data-wx-editor='input']") as HTMLTextAreaElement | null;
    textarea?.focus();
  };

  return {
    mount(container) {
      options.context.mountedContainer = container;
      options.context.mountedContainer.replaceChildren(options.context.root);
      options.runtime.refreshGutterWidth(true);
      options.runtime.refreshViewportMetricsIfNeeded(true);
      options.runtime.revealCursor();
      options.runtime.renderSurfaceSnapshot({ forceRows: true });
      options.runtime.schedulePostMountReveal();
    },
    destroy() {
      options.context.destroyed = true;
      options.disconnectResizeObserver();
      if (options.context.pendingMountFrame) {
        cancelAnimationFrame(options.context.pendingMountFrame);
        options.context.pendingMountFrame = 0;
      }
      options.unsubscribeController();
      destroyLanguageServices();
      options.context.root.remove();
    },
    focus() {
      focusInput();
    },
    format() {
      return options.controller.formatDocument();
    },
    getCodeActions() {
      return options.controller.requestCodeActions();
    },
    applyCodeAction(action) {
      return options.runtime.applyCodeActionInternal(action);
    },
    subscribe(listener) {
      return options.controller.subscribe(listener);
    },
    getState() {
      return options.controller.getState();
    },
    setFilePath(filePath) {
      options.context.bufferTitle = filePath;
      options.controller.setFilePath(filePath);
      options.runtime.patchStatus();
    },
    async setLanguageServices(languageServices) {
      destroyLanguageServices();
      options.context.languageServices = options.normalizeLanguageServices(languageServices);
      options.controller.setLanguageServices(options.context.languageServices);
      options.runtime.syncLanguageMirrors();
      options.runtime.renderSurfaceSnapshot({ forceRows: true });
    },
    async setLanguage(language) {
      await this.setLanguageServices(languageProviderToServices(language));
    },
    setTheme(theme) {
      options.context.theme = theme;
      options.controller.setThemeName(theme.name);
      options.context.availableCommandThemes = options.context.normalizeCommandThemes(options.context.commandThemes, theme);
      options.context.appliedThemeName = null;
      options.runtime.renderSurfaceSnapshot({ syncTheme: true });
    },
    async setValue(value) {
      options.controller.replaceState(createEditorState({ value, selection: createSelection(0, 0) }));
      options.controller.alignViewportToSelection("top");
      options.runtime.syncLanguageMirrors();
    }
  };
}
