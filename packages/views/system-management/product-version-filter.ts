export type ProductVersionStatusFilter = "all" | "enabled" | "disabled";

export function filterProductVersions<
  T extends { name: string; directory: string; remark: string; enabled: boolean },
>(versions: T[], query: string, status: ProductVersionStatusFilter): T[] {
  const normalized = query.trim().toLowerCase();
  return versions.filter((version) => {
    if (status === "enabled" && !version.enabled) return false;
    if (status === "disabled" && version.enabled) return false;
    if (!normalized) return true;
    return [version.name, version.directory, version.remark].some((value) =>
      value.toLowerCase().includes(normalized),
    );
  });
}
