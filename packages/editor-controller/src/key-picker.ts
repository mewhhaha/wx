import type { KeyRuntimeContext } from "./key-runtime-types";

export async function handlePickerKey(context: KeyRuntimeContext, key: string): Promise<boolean> {
  const picker = context.getPresentation().ui.picker;
  const modal = picker.variant === "modal";

  if (!picker.active) {
    return false;
  }

  if (key === "Escape") {
    context.closePicker("ui.picker.close");
    return true;
  }

  if ((!modal && (key === "ArrowLeft" || key === "h")) || key === "ArrowUp") {
    context.movePicker(-1);
    return true;
  }

  if ((!modal && (key === "ArrowRight" || key === "l")) || key === "ArrowDown") {
    context.movePicker(1);
    return true;
  }

  if (key === "Enter") {
    await context.acceptPicker();
    return true;
  }

  if (key === "Backspace") {
    return context.updatePickerQuery(picker.query.slice(0, -1));
  }

  if (key.length === 1 && !/^[1-9]$/.test(key)) {
    return context.updatePickerQuery(`${picker.query}${key}`);
  }

  if (/^[1-9]$/.test(key)) {
    await context.acceptPicker(Number(key) - 1);
    return true;
  }

  return false;
}
