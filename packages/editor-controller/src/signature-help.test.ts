import { describe, expect, it, vi } from "vitest";
import { createSelection } from "@mewhhaha/wx-core";
import { createEditorController } from "./index";

describe("signature help", () => {
  it("shows overloads, navigates them, and exposes the active parameter", async () => {
    const signatureHelp = vi.fn(async () => [
      { label: "sum(a: number, b: number)", activeParameter: 1, documentation: "Adds numbers" },
      { label: "sum(values: number[])", activeParameter: 0 }
    ]);
    const controller = createEditorController({ value: "sum(", mode: "insert", selection: createSelection(4) });
    controller.setLanguageServices({ signatureHelp: { signatureHelp } });
    expect(await controller.requestSignatureHelp()).toBe(true);
    expect(controller.getPresentationState().ui.signatureHelp).toMatchObject({ active: true, selectedIndex: 0 });
    expect(controller.getPresentationState().ui.signatureHelp.signatures).toEqual(expect.arrayContaining([expect.objectContaining({ activeParameter: 1 })]));
    expect(controller.moveSignatureHelp(1)).toBe(true);
    expect(controller.getPresentationState().ui.signatureHelp.selectedIndex).toBe(1);
    expect(controller.dismissSignatureHelp()).toBe(true);
    expect(controller.getPresentationState().ui.signatureHelp.active).toBe(false);
  });

  it("coalesces duplicate trigger work and rejects stale responses after movement", async () => {
    let resolve!: (value: readonly { label: string; activeParameter: number }[]) => void;
    const signatureHelp = vi.fn(() => new Promise<readonly { label: string; activeParameter: number }[]>((next) => { resolve = next; }));
    const controller = createEditorController({ value: "call", mode: "insert", selection: createSelection(4) });
    controller.setLanguageServices({ signatureHelp: { signatureHelp } });
    const first = controller.requestSignatureHelp();
    const duplicate = controller.requestSignatureHelp();
    expect(signatureHelp).toHaveBeenCalledOnce();
    controller.dispatch({ selection: createSelection(0) });
    resolve([{ label: "call(value)", activeParameter: 0 }]);
    expect(await first).toBe(false);
    expect(await duplicate).toBe(true);
    expect(controller.getPresentationState().ui.signatureHelp.active).toBe(false);
  });

  it("requests automatically on configured insert triggers and completion takes precedence", async () => {
    const signatureHelp = vi.fn(async () => [{ label: "call(value)", activeParameter: 0 }]);
    const completion = vi.fn(async () => [{ label: "member" }]);
    const controller = createEditorController({ value: "call", mode: "insert", selection: createSelection(4) });
    controller.setLanguageServices({ signatureHelp: { signatureHelp }, completion: { complete: completion } });
    await controller.handleTextInput("(");
    await Promise.resolve(); await Promise.resolve();
    expect(signatureHelp).toHaveBeenCalledOnce();
    expect(controller.getPresentationState().ui.signatureHelp.active).toBe(true);
    await controller.requestCompletion();
    expect(controller.getPresentationState().ui.completion.active).toBe(true);
    expect(controller.getPresentationState().ui.signatureHelp.active).toBe(false);
  });

  it("is a nonfatal no-op without a provider", async () => {
    const controller = createEditorController();
    expect(await controller.requestSignatureHelp()).toBe(false);
    expect(controller.getPresentationState().ui.bottomMessage).toMatchObject({ tone: "warning", text: "No signature help provider" });
  });

  it("dismisses active signature help with Escape in normal mode", async () => {
    const controller = createEditorController({ value: "call(", selection: createSelection(5) });
    controller.setLanguageServices({ signatureHelp: { async signatureHelp() { return [{ label: "call(value)" }]; } } });

    await controller.requestSignatureHelp();
    await controller.handleKeyInput({ key: "Escape" });

    expect(controller.getPresentationState().ui.signatureHelp.active).toBe(false);
  });

  it("invalidates delayed results on Escape, provider reset, and destroy", async () => {
    const resolvers: Array<(value: readonly { label: string }[]) => void> = [];
    const provider = { signatureHelp: () => new Promise<readonly { label: string }[]>((resolve) => resolvers.push(resolve)) };

    const escaped = createEditorController({ value: "call(", mode: "insert", selection: createSelection(5) });
    escaped.setLanguageServices({ signatureHelp: provider });
    const escapeRequest = escaped.requestSignatureHelp();
    await escaped.handleKeyInput({ key: "Escape" });
    resolvers.shift()!([{ label: "stale escape" }]);
    expect(await escapeRequest).toBe(false);
    expect(escaped.getPresentationState().ui.signatureHelp.active).toBe(false);

    const reset = createEditorController({ value: "call(", mode: "insert", selection: createSelection(5) });
    reset.setLanguageServices({ signatureHelp: provider });
    const resetRequest = reset.requestSignatureHelp();
    reset.setLanguageServices(null);
    resolvers.shift()!([{ label: "stale reset" }]);
    expect(await resetRequest).toBe(false);
    expect(reset.getPresentationState().ui.signatureHelp.active).toBe(false);

    const destroyed = createEditorController({ value: "call(", mode: "insert", selection: createSelection(5) });
    destroyed.setLanguageServices({ signatureHelp: provider });
    const destroyRequest = destroyed.requestSignatureHelp();
    destroyed.destroy();
    resolvers.shift()!([{ label: "stale destroy" }]);
    expect(await destroyRequest).toBe(false);
    expect(destroyed.getPresentationState().ui.signatureHelp.active).toBe(false);
  });
});
