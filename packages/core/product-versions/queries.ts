import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const productVersionKeys = {
  all: (productId: string) => ["product-versions", productId] as const,
  list: (productId: string) => [...productVersionKeys.all(productId), "list"] as const,
  detail: (productId: string, versionId: string) =>
    [...productVersionKeys.all(productId), "detail", versionId] as const,
};

export function productVersionListOptions(productId: string) {
  return queryOptions({
    queryKey: productVersionKeys.list(productId),
    queryFn: () => api.listSystemProductVersions(productId),
    select: (data) => data.versions,
    enabled: Boolean(productId),
  });
}

export function productVersionDetailOptions(productId: string, versionId: string) {
  return queryOptions({
    queryKey: productVersionKeys.detail(productId, versionId),
    queryFn: () => api.getProductVersion(productId, versionId),
    enabled: Boolean(productId) && Boolean(versionId),
  });
}
