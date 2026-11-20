import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { OrderTarget } from "./schema";
export * from "./schema";
export * from "./paths";
export const workOrderKeys = {
  catalog: ["customer-projects"] as const,
  all: (target: OrderTarget) => ["work-orders", target.wsId, !!target.system] as const,
};
export function workOrdersOptions(target: OrderTarget, all = false, search = "", page = 1) {
  return queryOptions({
    queryKey: [...workOrderKeys.all(target), "list", all, search, page],
    queryFn: () => api.listWorkOrders(target, all, search, page),
    enabled: !!target.wsId,
  });
}
