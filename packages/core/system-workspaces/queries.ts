import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const systemWorkspaceKeys = {
  all: ["system-workspaces"] as const,
  list: () => [...systemWorkspaceKeys.all, "list"] as const,
};

export function systemWorkspaceListOptions() {
  return queryOptions({
    queryKey: systemWorkspaceKeys.list(),
    queryFn: () => api.listSystemWorkspaces(),
  });
}
