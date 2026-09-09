export interface SystemSettings {
  kb_environment_url: string;
  kb_integration_key_configured: boolean;
}

export interface UpdateSystemSettingsRequest {
  kb_environment_url: string;
  kb_integration_key?: string;
}

export interface KBFolder {
  id: string;
  name: string;
  folderPath: string;
  parentId: string;
}

export interface GetKBFoldersResponse {
  folders: KBFolder[];
  totalCount: number;
  currentFolder: KBFolder | null;
}
