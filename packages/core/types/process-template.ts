export interface ProcessTemplateManifest {
  agents: string[];
  squads: string[];
  skills: string[];
}

export interface ProcessTemplateVersion {
  id: string;
  version: number;
  checksum: string;
  file_name: string;
  file_size: number;
  manifest?: ProcessTemplateManifest | Record<string, unknown>;
  created_by?: string;
  created_at: string;
}

export interface ProcessTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  latest_version?: ProcessTemplateVersion | null;
  installed?: boolean;
  installed_version?: ProcessTemplateVersion | null;
  applied_at?: string;
  applied_by?: string;
  can_upgrade: boolean;
}

export interface ListProcessTemplatesResponse {
  templates: ProcessTemplate[];
  total: number;
}

export interface ListProcessTemplateVersionsResponse {
  versions: ProcessTemplateVersion[];
  total: number;
}

export interface UpsertProcessTemplateInput {
  name: string;
  description?: string;
  slug?: string;
  file?: File | null;
}
