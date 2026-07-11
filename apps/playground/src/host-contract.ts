/** The complete, development-only HTTP contract for the playground host bridge. */
export const wxHostRoutes = {
  readFile: "/__wx__/read",
  searchFiles: "/__wx__/search",
  searchWorkspace: "/__wx__/search-workspace",
  listFolders: "/__wx__/folders",
  writeFile: "/__wx__/write",
  lineChanges: "/__wx__/line-changes"
} as const;

export type WxHostRoute = (typeof wxHostRoutes)[keyof typeof wxHostRoutes];
export type WxLineChangeKind = "added" | "modified" | "deleted";

export interface WxReadFileRequest { filePath: string; }
export interface WxReadFileResponse { text: string; }
export interface WxSearchFilesRequest { filePath: string; scope: "repo" | "folder"; query: string; }
export interface WxSearchFilesResponse { files: Array<{ filePath: string; detail?: string }>; }
export interface WxSearchWorkspaceRequest { filePath: string; query: string; mode: "literal" | "regex"; case: "sensitive" | "insensitive" | "smart"; include?: string[]; exclude?: string[]; limit: number; }
export interface WxSearchWorkspaceResponse { results: Array<{ filePath: string; line: number; fromColumn: number; toColumn: number; preview: string; truncated?: boolean }>; }
export interface WxListFoldersRequest { filePath: string; }
export interface WxListFoldersResponse { folders: Array<{ folderPath: string; detail?: string }>; }
export interface WxWriteFileRequest { filePath: string; text: string; expectedText?: string | null; }
export interface WxWriteFileResponse { ok: true; }
export interface WxLineChangesRequest { filePath: string; text: string; }
export interface WxLineChangesResponse { changes: Array<{ line: number; kind: WxLineChangeKind }>; }

export interface WxHostErrorResponse {
  error: {
    code: "bad_request" | "not_found" | "method_not_allowed" | "conflict" | "internal_error";
    message: string;
  };
}
