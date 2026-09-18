/**
 * Resolve product + version objects from ids so create-issue can inherit a
 * project's binding and show names on the chip without the user opening the
 * product picker.
 */
import type { Product, ProductVersion } from "@multica/core/types";
import { api } from "@/data/api";

export async function resolveProductVersion(
  productId: string | null | undefined,
  versionId: string | null | undefined,
): Promise<{ product: Product; productVersion: ProductVersion } | null> {
  if (!productId || !versionId) return null;
  const [{ products }, { versions }] = await Promise.all([
    api.listProducts(),
    api.listProductVersions(productId),
  ]);
  const product = products.find((item) => item.id === productId);
  const productVersion = versions.find((item) => item.id === versionId);
  if (!product || !productVersion) return null;
  return { product, productVersion };
}

/** Inherit product/version from a project when the user didn't pick a folder. */
export async function resolveProjectProductVersion(project: {
  product_id?: string | null;
  product_version_id?: string | null;
} | null | undefined) {
  return resolveProductVersion(project?.product_id, project?.product_version_id);
}
