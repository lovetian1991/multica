import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ProductFolderPickerBody } from "@/components/issue/pickers/product-folder-picker-body";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";

export default function IssueProductFolderPickerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);
  const query = useNativeSearchBar("搜索产品", { autoFocus: true });

  return (
    <ProductFolderPickerBody
      productId={issue?.product_id}
      productVersionId={issue?.product_version_id}
      folderId={issue?.kb_folder_id}
      query={query}
      onChange={(selection) => {
        updateIssue.mutate({
          product_id: selection.product.id,
          product_version_id: selection.productVersion.id,
          kb_folder_id: selection.kbFolder.id,
        });
        router.back();
      }}
    />
  );
}
