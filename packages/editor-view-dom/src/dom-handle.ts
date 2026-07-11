import { createEditorState, createSelection, type EditorState } from "@mewhhaha/wx-core";
import type { EditorController, EditorUpdate } from "@mewhhaha/wx-controller";
import {
  languageProviderToServices,
  type EditorCodeAction,
  type EditorLanguageServiceInput,
  type EditorLanguageServices,
  type LanguageProvider,
  type LanguageRegistry
} from "@mewhhaha/wx-language";
import type { ThemeSpec } from "@mewhhaha/wx-theme";

import type { DomEditorContext, DomEditorRuntime } from "./dom-runtime";

interface CreateDomHandleRuntimeOptions {
  controller: EditorController;
  context: DomEditorContext;
  runtime: DomEditorRuntime;
  ownsController: boolean;
  normalizeLanguageServices(input: EditorLanguageServiceInput | null | undefined): EditorLanguageServices[];
  unsubscribeController(): void;
  disconnectResizeObserver(): void;
  cleanupWindowListeners?(): void;
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
  setLanguageRegistry(registry: LanguageRegistry | null): Promise<void>;
  resetLanguageServices(): Promise<void>;
  setLanguage(language: LanguageProvider | null): Promise<void>;
  setTheme(theme: ThemeSpec): void;
  setValue(value: string): Promise<void>;
}

export function createDomHandleRuntime(options: CreateDomHandleRuntimeOptions): DomHandleRuntime {
  let destroyed = false;
  const destroyLanguageServices = (languageServices = options.context.languageServices) => {
    const destroyed = new Set<NonNullable<EditorLanguageServices["lifecycle"]>>();
    for (const services of languageServices) {
      const lifecycle = services.lifecycle;
      if (!lifecycle || lifecycle.owner !== "view" || destroyed.has(lifecycle)) continue;
      destroyed.add(lifecycle);
      void Promise.resolve(lifecycle.destroy()).catch(() => undefined);
    }
  };
  const destroyRemovedLanguageServices = (previous: readonly EditorLanguageServices[]) => {
    const nextServices = new Set(options.context.languageServices);
    const destroyed = new Set<NonNullable<EditorLanguageServices["lifecycle"]>>();
    for (const services of previous) {
      const lifecycle = services.lifecycle;
      if (nextServices.has(services) || !lifecycle || lifecycle.owner !== "view" || destroyed.has(lifecycle)) continue;
      destroyed.add(lifecycle);
      void Promise.resolve(lifecycle.destroy()).catch(() => undefined);
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
      if (destroyed) return;
      destroyed = true;
      options.context.destroyed = true;
      options.disconnectResizeObserver();
      if (options.context.pendingMountFrame) {
        cancelAnimationFrame(options.context.pendingMountFrame);
        options.context.pendingMountFrame = 0;
      }
      options.unsubscribeController();
      options.cleanupWindowListeners?.();
      destroyLanguageServices();
      if (options.ownsController) {
        options.controller.destroy();
      }
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
      const previousLanguageServices = [...options.context.languageServices];
      options.controller.setFilePath(filePath);
      options.runtime.syncPresentationMirrors();
      destroyRemovedLanguageServices(previousLanguageServices);
      options.runtime.patchStatus();
    },
    async setLanguageServices(languageServices) {
      const previousLanguageServices = [...options.context.languageServices];
      options.context.languageServices = options.normalizeLanguageServices(languageServices);
      options.controller.setLanguageServices(options.context.languageServices);
      options.runtime.syncPresentationMirrors();
      destroyRemovedLanguageServices(previousLanguageServices);
      options.context.languageServices = [...options.controller.getPresentationState().language.services];
      options.runtime.syncLanguageMirrors();
      options.runtime.renderSurfaceSnapshot({ forceRows: true });
    },
    async setLanguageRegistry(registry) {
      const previousLanguageServices = [...options.context.languageServices];
      options.controller.setLanguageRegistry(registry);
      options.runtime.syncPresentationMirrors();
      destroyRemovedLanguageServices(previousLanguageServices);
      options.runtime.renderSurfaceSnapshot({ forceRows: true });
    },
    async resetLanguageServices() {
      const previousLanguageServices = [...options.context.languageServices];
      options.controller.resetLanguageServices();
      options.runtime.syncPresentationMirrors();
      destroyRemovedLanguageServices(previousLanguageServices);
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
