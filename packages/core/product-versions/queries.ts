import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const productVersionKeys = {
  all: (productId: string) => ["product-versions", productId] as const,
  list: (productId: string) => [...productVersionKeys.all(productId), "list"] as const,
  adminList: (productId: string) => [...productVersionKeys.all(productId), "admin"] as const,
  detail: (productId: string, versionId: string) =>
    [...productVersionKeys.all(productId), "detail", versionId] as const,
};

/** Enabled versions for issue/task pickers. Disabled catalog rows stay out. */
export function productVersionListOptions(productId: string) {
  return queryOptions({
    queryKey: productVersionKeys.list(productId),
    queryFn: () => api.listProductVersions(productId),
    select: (data) => data.versions,
    enabled: Boolean(productId),
  });
}

/** Full catalog for system administration, including disabled versions. */
export function systemProductVersionListOptions(productId: string) {
  return queryOptions({
    queryKey: productVersionKeys.adminList(productId),
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
