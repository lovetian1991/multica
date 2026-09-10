/**
 * Product and knowledge-base folder queries for issue pickers.
 *
 * Products are deployment-scoped, while folder children are selected from a
 * product version's configured root folder. Query keys stay independent from
 * workspace ids because the backend catalog is global.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const productKeys = {
  all: () => ["products"] as const,
  list: () => [...productKeys.all(), "list"] as const,
  versions: (productId: string) => [...productKeys.all(), "versions", productId] as const,
};

export const productListOptions = () =>
  queryOptions({
    queryKey: productKeys.list(),
    queryFn: ({ signal }) => api.listProducts({ signal }),
    select: (response) => response.products,
  });

export const productVersionListOptions = (productId: string | null) =>
  queryOptions({
    queryKey: productKeys.versions(productId ?? ""),
    queryFn: ({ signal }) => api.listProductVersions(productId ?? "", { signal }),
    select: (response) => response.versions,
    enabled: Boolean(productId),
  });
