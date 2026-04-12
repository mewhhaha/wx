import type { DiagnosticSeverity, EditorDiagnostic } from "@wx/editor-language";

const DIAGNOSTIC_SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3
};

export function toneForSeverity(severity: DiagnosticSeverity): "info" | "warning" | "error" {
  return severity === "error" ? "error" : severity === "warning" ? "warning" : "info";
}

export function meetsDiagnosticThreshold(severity: DiagnosticSeverity, minimum: DiagnosticSeverity): boolean {
  return DIAGNOSTIC_SEVERITY_ORDER[severity] <= DIAGNOSTIC_SEVERITY_ORDER[minimum];
}

export function selectDiagnostic(
  entries: readonly EditorDiagnostic[],
  minimum: DiagnosticSeverity,
  excluding: EditorDiagnostic | null = null
): EditorDiagnostic | null {
  let best: EditorDiagnostic | null = null;

  for (const entry of entries) {
    if (excluding && entry === excluding) {
      continue;
    }

    if (!meetsDiagnosticThreshold(entry.severity, minimum)) {
      continue;
    }

    if (!best || DIAGNOSTIC_SEVERITY_ORDER[entry.severity] < DIAGNOSTIC_SEVERITY_ORDER[best.severity]) {
      best = entry;
    }
  }

  return best;
}

export function resolveOffsetWithinRun(
  target: HTMLElement,
  startOffset: number,
  endOffset: number | null,
  clientX: number
): number {
  if (endOffset === null || endOffset <= startOffset + 1) {
    return startOffset;
  }

  const rect = target.getBoundingClientRect();
  const width = rect.width;

  if (!Number.isFinite(width) || width <= 0) {
    return startOffset;
  }

  const runLength = endOffset - startOffset;
  const relativeX = Math.max(0, Math.min(width, clientX - rect.left));
  const ratio = width > 0 ? relativeX / width : 0;
  const index = Math.min(runLength - 1, Math.max(0, Math.floor(ratio * runLength)));
  return startOffset + index;
}

export function getTooltipAnchorForRect(
  root: HTMLElement,
  rect: DOMRect
): { left: number; top: number } {
  const rootRect = root.getBoundingClientRect();
  const left = Math.max(8, rect.left - rootRect.left);
  const top = Math.max(8, rect.bottom - rootRect.top + 6);
  return { left, top };
}
