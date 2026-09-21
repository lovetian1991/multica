import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const processTemplateKeys = {
  all: () => ["process-templates"] as const,
  system: () => [...processTemplateKeys.all(), "system"] as const,
  systemList: () => [...processTemplateKeys.system(), "list"] as const,
  systemDetail: (id: string) => [...processTemplateKeys.system(), "detail", id] as const,
  workspace: () => [...processTemplateKeys.all(), "workspace"] as const,
  workspaceList: () => [...processTemplateKeys.workspace(), "list"] as const,
};

export function systemProcessTemplateListOptions() {
  return queryOptions({
    queryKey: processTemplateKeys.systemList(),
    queryFn: () => api.listSystemProcessTemplates(),
    select: (data) => data.templates,
  });
}

export function workspaceProcessTemplateListOptions() {
  return queryOptions({
    queryKey: processTemplateKeys.workspaceList(),
    queryFn: () => api.listWorkspaceProcessTemplates(),
    select: (data) => data.templates,
  });
}
