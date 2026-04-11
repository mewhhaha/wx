import type { EditorController } from "../../editor-controller/src/index";
import type { ThemeSpec } from "../../editor-theme/src/index";

const SURFACE_VERTICAL_PADDING = 16;
const VIEWPORT_OVERSCAN_LINES = 6;
export const VERTICAL_SCROLLOFF_ROWS = 3;

export function measureMetrics(styleHost: HTMLElement): { charWidth: number; lineHeight: number } {
  const probe = document.createElement("span");
  probe.textContent = "MMMMMMMMMM";
  probe.style.font =
    '15px/1.6 "Monaspace Argon NF", "Monaspace Argon", "Iosevka Web", "SFMono-Regular", "Monaco", monospace';
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  styleHost.append(probe);

  const rect = probe.getBoundingClientRect();
  probe.remove();

  const width = rect.width > 0 ? rect.width / 10 : 9;
  const lineHeight = rect.height > 0 ? rect.height : 24;

  return {
    charWidth: width,
    lineHeight
  };
}

export function normalizeViewport(
  viewport: { fromLine: number; toLine: number },
  lineCount: number
): { fromLine: number; toLine: number } {
  const maxLine = Math.max(0, lineCount - 1);
  const fromLine = Math.max(0, Math.min(maxLine, viewport.fromLine));
  const toLine = Math.max(fromLine, Math.min(maxLine, viewport.toLine));

  return { fromLine, toLine };
}

export function expandViewport(
  viewport: { fromLine: number; toLine: number },
  totalVisualRows: number
): { fromLine: number; toLine: number } {
  return normalizeViewport(
    {
      fromLine: viewport.fromLine - VIEWPORT_OVERSCAN_LINES,
      toLine: viewport.toLine + VIEWPORT_OVERSCAN_LINES
    },
    totalVisualRows
  );
}

export function viewportEquals(
  left: { fromLine: number; toLine: number },
  right: { fromLine: number; toLine: number }
): boolean {
  return left.fromLine === right.fromLine && left.toLine === right.toLine;
}

export function measureVisibleLineCapacity(
  metrics: { lineHeight: number },
  surface: HTMLElement
): number {
  const viewportHeight = Math.max(
    metrics.lineHeight,
    (surface.clientHeight || metrics.lineHeight * 20) - SURFACE_VERTICAL_PADDING * 2
  );
  return Math.max(1, Math.ceil(viewportHeight / metrics.lineHeight));
}

export function getContentColumns(options: {
  softWrap: boolean;
  metrics: { charWidth: number };
  surface: HTMLElement;
  root: HTMLElement;
  container: HTMLElement;
  gutterWidth: number;
}): number {
  if (!options.softWrap) {
    return Number.MAX_SAFE_INTEGER;
  }

  const surfaceWidth = options.surface.clientWidth || options.root.clientWidth || options.container.clientWidth || 800;
  const contentWidth = Math.max(options.metrics.charWidth, surfaceWidth - options.gutterWidth - 8);
  return Math.max(1, Math.floor(contentWidth / options.metrics.charWidth));
}

export function measureGutterWidth(root: HTMLElement, lineCount: number): number {
  const sample = document.createElement("div");
  const marker = document.createElement("span");
  const number = document.createElement("span");
  const change = document.createElement("span");

  sample.className = "wx-editor__gutter";
  marker.className = "wx-editor__gutter-marker";
  number.className = "wx-editor__gutter-number";
  change.className = "wx-editor__gutter-change";
  number.textContent = String(Math.max(1, lineCount));
  sample.append(marker, number, change);
  sample.style.position = "absolute";
  sample.style.visibility = "hidden";
  sample.style.pointerEvents = "none";
  root.append(sample);
  const width = Math.ceil(sample.getBoundingClientRect().width);
  sample.remove();
  return width;
}

export function refreshGutterWidth(options: {
  force?: boolean;
  gutterWidth: number;
  metrics: { charWidth: number };
  root: HTMLElement;
  lineCount: number;
  setGutterWidth(width: number): void;
}): void {
  const nextWidth = Math.max(options.metrics.charWidth * 6, measureGutterWidth(options.root, options.lineCount));

  if (!options.force && nextWidth === options.gutterWidth) {
    return;
  }

  options.setGutterWidth(nextWidth);
}

export function syncMeasuredViewportMetrics(options: {
  force?: boolean;
  controller: EditorController;
  softWrap: boolean;
  metrics: { charWidth: number; lineHeight: number };
  surface: HTMLElement;
  root: HTMLElement;
  container: HTMLElement;
  gutterWidth: number;
  visibleLineCapacity: number;
  wrapColumns: number;
  viewportSoftWrap: boolean;
}): boolean {
  const nextVisibleLineCapacity = measureVisibleLineCapacity(options.metrics, options.surface);
  const nextWrapColumns = getContentColumns({
    softWrap: options.softWrap,
    metrics: options.metrics,
    surface: options.surface,
    root: options.root,
    container: options.container,
    gutterWidth: options.gutterWidth
  });

  if (
    !options.force &&
    nextVisibleLineCapacity === options.visibleLineCapacity &&
    nextWrapColumns === options.wrapColumns &&
    options.viewportSoftWrap === options.softWrap
  ) {
    return false;
  }

  options.controller.setViewportMetrics({
    visibleRowCapacity: nextVisibleLineCapacity,
    wrapColumns: nextWrapColumns,
    softWrap: options.softWrap
  });
  return true;
}
