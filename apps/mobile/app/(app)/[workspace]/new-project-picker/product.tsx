/**
 * Product/version picker route for the in-progress new-project draft.
 * Reads/writes `useNewProjectDraftStore` — same pattern as status/priority.
 */
import { router } from "expo-router";
import { ProductVersionPickerBody } from "@/components/project/pickers/product-version-picker-body";
import { useNewProjectDraftStore } from "@/data/stores/new-project-draft-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";

export default function NewProjectProductPickerRoute() {
  const product = useNewProjectDraftStore((s) => s.product);
  const productVersion = useNewProjectDraftStore((s) => s.productVersion);
  const setProductSelection = useNewProjectDraftStore(
    (s) => s.setProductSelection,
  );
  const query = useNativeSearchBar("搜索产品", { autoFocus: true });

  return (
    <ProductVersionPickerBody
      productId={product?.id}
      productVersionId={productVersion?.id}
      query={query}
      onChange={(next) => {
        setProductSelection(next);
        router.back();
      }}
    />
  );
}
