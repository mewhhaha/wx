import {
  wxHostRoutes,
  type WxHostErrorResponse,
  type WxLineChangesRequest,
  type WxLineChangesResponse,
  type WxListFoldersRequest,
  type WxListFoldersResponse,
  type WxReadFileRequest,
  type WxReadFileResponse,
  type WxSearchFilesRequest,
  type WxSearchFilesResponse,
  type WxSearchWorkspaceRequest,
  type WxSearchWorkspaceResponse,
  type WxWriteFileRequest,
  type WxWriteFileResponse
} from "./host-contract";

export class WxHostRequestError extends Error {
  constructor(readonly status: number, readonly code: WxHostErrorResponse["error"]["code"], message: string) { super(message); }
}

export async function requestWxHostJson<Request, Response>(path: string, payload: Request, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data as WxHostErrorResponse | null;
    throw new WxHostRequestError(response.status, error?.error?.code ?? "internal_error", error?.error?.message ?? "Playground host request failed.");
  }
  return data as Response;
}

export const wxHostClient = {
  readFile: (payload: WxReadFileRequest) => requestWxHostJson<WxReadFileRequest, WxReadFileResponse>(wxHostRoutes.readFile, payload),
  searchFiles: (payload: WxSearchFilesRequest) => requestWxHostJson<WxSearchFilesRequest, WxSearchFilesResponse>(wxHostRoutes.searchFiles, payload),
  searchWorkspace: (payload: WxSearchWorkspaceRequest, signal?: AbortSignal) => requestWxHostJson<WxSearchWorkspaceRequest, WxSearchWorkspaceResponse>(wxHostRoutes.searchWorkspace, payload, signal),
  listFolders: (payload: WxListFoldersRequest) => requestWxHostJson<WxListFoldersRequest, WxListFoldersResponse>(wxHostRoutes.listFolders, payload),
  writeFile: (payload: WxWriteFileRequest) => requestWxHostJson<WxWriteFileRequest, WxWriteFileResponse>(wxHostRoutes.writeFile, payload),
  lineChanges: (payload: WxLineChangesRequest) => requestWxHostJson<WxLineChangesRequest, WxLineChangesResponse>(wxHostRoutes.lineChanges, payload)
};
