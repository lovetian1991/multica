/**
 * Project product/version picker route — presented as a formSheet by the
 * parent Stack. Self-contained: reads project from cache, fires
 * useUpdateProject on selection, then router.back()s.
 */
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ProductVersionPickerBody } from "@/components/project/pickers/product-version-picker-body";
import { projectDetailOptions } from "@/data/queries/projects";
import { useUpdateProject } from "@/data/mutations/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";

export default function ProjectProductPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: project } = useQuery(projectDetailOptions(wsId, id));
  const updateProject = useUpdateProject(id);
  const query = useNativeSearchBar("搜索产品", { autoFocus: true });

  return (
    <ProductVersionPickerBody
      productId={project?.product_id}
      productVersionId={project?.product_version_id}
      query={query}
      onChange={(next) => {
        updateProject.mutate({
          product_id: next?.product.id ?? null,
          product_version_id: next?.productVersion.id ?? null,
        });
        router.back();
      }}
    />
  );
}
