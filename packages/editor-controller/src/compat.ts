import type { EditorHover } from "@mewhhaha/wx-language";
import type {
  EditorCommandLineKeyOptions,
  EditorCommandLineKeyResult,
  EditorController,
  EditorPresentationState
} from "./types";

interface CreateCompatibilityApiOptions {
  updatePresentationState(
    updater: (presentation: EditorPresentationState) => void,
    effectType?: string,
    options?: { defer?: boolean }
  ): void;
  openCommandLine(prompt: ":" | "/" | "?"): void;
  requestRawHover(offset: number): Promise<EditorHover | null>;
  invalidateHoverRequest(): void;
  handleCommandLineKey(
    key: string,
    options?: EditorCommandLineKeyOptions
  ): Promise<EditorCommandLineKeyResult>;
}

export function createCompatibilityApi(options: CreateCompatibilityApiOptions): Pick<
  EditorController,
  "updatePresentationState" | "openCommandLine" | "handleCommandLineKey" | "requestHover" | "dismissHover"
> {
  return {
    updatePresentationState(updater, effectType = "presentation.update", runtimeOptions = {}) {
      options.updatePresentationState(updater, effectType, runtimeOptions);
    },
    openCommandLine(prompt) {
      options.openCommandLine(prompt);
    },
    handleCommandLineKey(key, commandOptions) {
      return options.handleCommandLineKey(key, commandOptions);
    },
    requestHover(offset) {
      return options.requestRawHover(offset);
    },
    dismissHover() {
      options.invalidateHoverRequest();
    }
  };
}
