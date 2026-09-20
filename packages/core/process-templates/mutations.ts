import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { UpsertProcessTemplateInput } from "../types";
import { workspaceKeys } from "../workspace/queries";
import { processTemplateKeys } from "./queries";

export function useCreateSystemProcessTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpsertProcessTemplateInput) =>
      api.createSystemProcessTemplate(data),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: processTemplateKeys.all() });
    },
  });
}

export function useUpdateSystemProcessTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpsertProcessTemplateInput) =>
      api.updateSystemProcessTemplate(id, data),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: processTemplateKeys.all() });
    },
  });
}

export function useDeleteSystemProcessTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSystemProcessTemplate(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: processTemplateKeys.all() });
    },
  });
}

function invalidateWorkspaceCatalog(queryClient: ReturnType<typeof useQueryClient>, wsId: string) {
  void queryClient.invalidateQueries({ queryKey: processTemplateKeys.workspace() });
  if (!wsId) return;
  void queryClient.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
  void queryClient.invalidateQueries({ queryKey: workspaceKeys.squads(wsId) });
  void queryClient.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
}

export function useApplyWorkspaceProcessTemplate(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.applyWorkspaceProcessTemplate(id),
    onSettled: () => invalidateWorkspaceCatalog(queryClient, wsId),
  });
}

export function useUpgradeWorkspaceProcessTemplate(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.upgradeWorkspaceProcessTemplate(id),
    onSettled: () => invalidateWorkspaceCatalog(queryClient, wsId),
  });
}
