import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const systemProductKeys = {
  all: () => ["system-products"] as const,
  list: () => [...systemProductKeys.all(), "list"] as const,
  detail: (id: string) => [...systemProductKeys.all(), "detail", id] as const,
};

export function systemProductListOptions() {
  return queryOptions({
    queryKey: systemProductKeys.list(),
    queryFn: () => api.listSystemProducts(),
    select: (data) => data.products,
  });
}

export function systemProductDetailOptions(id: string) {
  return queryOptions({
    queryKey: systemProductKeys.detail(id),
    queryFn: () => api.getSystemProduct(id),
    enabled: Boolean(id),
  });
}
