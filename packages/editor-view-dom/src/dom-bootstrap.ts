export interface EditorDomElements {
  root: HTMLDivElement;
  surface: HTMLDivElement;
  rows: HTMLDivElement;
  viewportRows: HTMLDivElement;
  tooltip: HTMLDivElement;
  commandPopover: HTMLDivElement;
  status: HTMLDivElement;
  statusMode: HTMLDivElement;
  statusFile: HTMLDivElement;
  statusMeta: HTMLDivElement;
  bottomRow: HTMLDivElement;
  textarea: HTMLTextAreaElement;
}

export function createEditorDom(container: HTMLElement, lineHeight: number): EditorDomElements {
  const root = document.createElement("div");
  const surface = document.createElement("div");
  const rows = document.createElement("div");
  const viewportRows = document.createElement("div");
  const tooltip = document.createElement("div");
  const commandPopover = document.createElement("div");
  const status = document.createElement("div");
  const statusMode = document.createElement("div");
  const statusFile = document.createElement("div");
  const statusMeta = document.createElement("div");
  const bottomRow = document.createElement("div");
  const textarea = document.createElement("textarea");

  root.className = "wx-editor";
  root.dataset.wxEditor = "root";
  root.tabIndex = 0;
  root.style.setProperty("--wx-line-height", `${lineHeight}px`);

  surface.className = "wx-editor__surface";
  surface.dataset.wxEditor = "surface";

  rows.className = "wx-editor__rows";
  rows.dataset.wxEditor = "rows";

  viewportRows.className = "wx-editor__viewport";
  viewportRows.dataset.wxEditor = "viewport";

  tooltip.className = "wx-editor__tooltip";
  tooltip.dataset.wxEditorTooltip = "true";
  tooltip.hidden = true;

  commandPopover.className = "wx-editor__command-popover";
  commandPopover.dataset.wxEditorCommandPopover = "true";
  commandPopover.hidden = true;

  status.className = "wx-editor__status";
  status.dataset.wxEditor = "status";

  statusMode.className = "wx-editor__status-mode";
  statusMode.dataset.wxEditorStatusMode = "true";

  statusFile.className = "wx-editor__status-file";
  statusFile.dataset.wxEditorStatusFile = "true";

  statusMeta.className = "wx-editor__status-meta";
  statusMeta.dataset.wxEditorStatusMeta = "true";

  bottomRow.className = "wx-editor__bottom-row";
  bottomRow.dataset.wxEditorBottomRow = "true";

  textarea.className = "wx-editor__input";
  textarea.dataset.wxEditor = "input";
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.setAttribute("autocorrect", "off");

  status.append(statusMode, statusFile, statusMeta);
  rows.append(viewportRows);
  surface.append(rows, tooltip, textarea);
  root.append(surface, commandPopover, status, bottomRow);
  container.replaceChildren(root);

  return {
    root,
    surface,
    rows,
    viewportRows,
    tooltip,
    commandPopover,
    status,
    statusMode,
    statusFile,
    statusMeta,
    bottomRow,
    textarea
  };
}
