import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const productKeys = {
  all: () => ["products"] as const,
  list: () => [...productKeys.all(), "list"] as const,
  detail: (id: string) => [...productKeys.all(), "detail", id] as const,
};

export function productListOptions() {
  return queryOptions({
    queryKey: productKeys.list(),
    queryFn: () => api.listProducts(),
    select: (data) => data.products,
  });
}

export function productDetailOptions(id: string) {
  return queryOptions({
    queryKey: productKeys.detail(id),
    queryFn: () => api.getProduct(id),
    enabled: Boolean(id),
  });
}
