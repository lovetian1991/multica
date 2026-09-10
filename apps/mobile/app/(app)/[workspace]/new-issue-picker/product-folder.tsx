import { router } from "expo-router";
import { ProductFolderPickerBody } from "@/components/issue/pickers/product-folder-picker-body";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";

export default function NewIssueProductFolderPickerRoute() {
  const product = useNewIssueDraftStore((state) => state.product);
  const productVersion = useNewIssueDraftStore((state) => state.productVersion);
  const kbFolder = useNewIssueDraftStore((state) => state.kbFolder);
  const setProductSelection = useNewIssueDraftStore((state) => state.setProductSelection);
  const query = useNativeSearchBar("搜索产品", { autoFocus: true });

  return (
    <ProductFolderPickerBody
      productId={product?.id}
      productVersionId={productVersion?.id}
      folderId={kbFolder?.id}
      query={query}
      onChange={(selection) => {
        setProductSelection(selection);
        router.back();
      }}
    />
  );
}
