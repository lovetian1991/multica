import { useQuery } from "@tanstack/react-query";
import { api } from "@multica/core/api";

export function useVersionChoices() {
  return useQuery({
    queryKey: ["work-order-version-choices"],
    // The catalog is edited from system management, whose mutations do not
    // invalidate this view-level key; override the client-wide
    // `staleTime: Infinity` so opening the picker reads the current catalog.
    staleTime: 0,
    queryFn: async () => {
      const products = await api.listProducts();
      return (await Promise.all(products.products.map(async (p) => {
        const versions = await api.listProductVersions(p.id);
        return versions.versions.map((v) => ({ value: v.id, label: `${p.name} / ${v.name}`, productId: p.id, productName: p.name, version: v }));
      }))).flat();
    },
  });
}
