import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const vcsKeys = {
  all: (wsId: string) => ["vcs", wsId] as const,
  connections: (wsId: string) => [...vcsKeys.all(wsId), "connections"] as const,
  deliveryProjects: (wsId: string) => [...vcsKeys.all(wsId), "delivery-projects"] as const,
  deliveries: (wsId: string, issueId: string) => [...vcsKeys.all(wsId), "deliveries", issueId] as const,
};

export const vcsConnectionsOptions = (wsId: string) =>
  queryOptions({
    queryKey: vcsKeys.connections(wsId),
    queryFn: () => api.listVCSConnections(wsId),
    enabled: !!wsId,
  });

export const deliveryProjectsOptions = (wsId: string) => queryOptions({
  queryKey: vcsKeys.deliveryProjects(wsId),
  queryFn: () => api.listDeliveryProjects(wsId),
  enabled: !!wsId,
  retry: false,
});

export const issueDeliveriesOptions = (wsId: string, issueId: string) => queryOptions({
  queryKey: vcsKeys.deliveries(wsId, issueId),
  queryFn: () => api.listIssueDeliveries(issueId),
  enabled: !!wsId && !!issueId,
  retry: false,
  refetchInterval: 15000,
});
