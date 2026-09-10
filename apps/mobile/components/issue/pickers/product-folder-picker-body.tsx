/**
 * Product/version/knowledge-base folder picker for issue forms.
 *
 * Web uses a two-column tree. On mobile the same hierarchy is stacked into a
 * native sheet: products and versions are selected above a paged list of the
 * version's first-level folder children. The selected values are committed
 * together so an issue never stores a partial product context.
 */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import type { KBFolder, Product, ProductVersion } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { productListOptions, productVersionListOptions } from "@/data/queries/products";
import { api } from "@/data/api";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "nativewind";

export interface ProductFolderSelection {
  product: Product;
  productVersion: ProductVersion;
  kbFolder: KBFolder;
}

interface Props {
  productId?: string | null;
  productVersionId?: string | null;
  folderId?: string | null;
  query: string;
  onChange: (selection: ProductFolderSelection) => void;
}

const EMPTY_PRODUCTS: Product[] = [];

export function ProductFolderPickerBody({
  productId,
  productVersionId,
  folderId,
  query,
  onChange,
}: Props) {
  const { colorScheme } = useColorScheme();
  const checkColor = colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;
  const [selectedProductId, setSelectedProductId] = useState(productId ?? null);
  const [selectedVersionId, setSelectedVersionId] = useState(productVersionId ?? null);
  const [selectedFolder, setSelectedFolder] = useState<KBFolder | null>(null);
  const [folders, setFolders] = useState<KBFolder[]>([]);
  const [folderPage, setFolderPage] = useState(0);
  const [folderTotal, setFolderTotal] = useState(0);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersLoadingMore, setFoldersLoadingMore] = useState(false);

  const productsQuery = useQuery(productListOptions());
  const products = productsQuery.data ?? EMPTY_PRODUCTS;
  const versionsQuery = useQuery(productVersionListOptions(selectedProductId));
  const versions = versionsQuery.data ?? [];
  const selectedProduct = products.find((item) => item.id === selectedProductId) ?? null;
  const selectedVersion = versions.find((item) => item.id === selectedVersionId) ?? null;
  const filteredProducts = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value
      ? products.filter((item) => item.name.toLowerCase().includes(value))
      : products;
  }, [products, query]);

  useEffect(() => {
    setSelectedProductId(productId ?? null);
    setSelectedVersionId(productVersionId ?? null);
    setSelectedFolder(null);
  }, [productId, productVersionId]);

  useEffect(() => {
    if (!selectedVersion?.folder_id) {
      setFolders([]);
      setFolderPage(0);
      setFolderTotal(0);
      setSelectedFolder(null);
      return;
    }
    let cancelled = false;
    setFolders([]);
    setFolderPage(0);
    setFolderTotal(0);
    setFoldersLoading(true);
    setFoldersLoadingMore(false);
    void api
      .getKBFolders(selectedVersion.folder_id, 1)
      .then((response) => {
        if (cancelled) return;
        setFolders(response.folders);
        setFolderPage(1);
        setFolderTotal(response.totalCount);
        setSelectedFolder(
          folderId
            ? response.folders.find((folder) => folder.id === folderId) ?? null
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setFolders([]);
          setFolderPage(0);
          setFolderTotal(0);
          setSelectedFolder(null);
        }
      })
      .finally(() => {
        if (!cancelled) setFoldersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedVersion?.folder_id, folderId]);

  const chooseProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectedVersionId(null);
    setSelectedFolder(null);
  };

  const chooseVersion = (version: ProductVersion) => {
    setSelectedVersionId(version.id);
    setSelectedFolder(null);
  };

  const loadMoreFolders = async () => {
    if (
      !selectedVersion?.folder_id ||
      foldersLoadingMore ||
      folders.length >= folderTotal
    ) {
      return;
    }
    const nextPage = folderPage + 1;
    setFoldersLoadingMore(true);
    try {
      const response = await api.getKBFolders(selectedVersion.folder_id, nextPage);
      setFolders((current) => [
        ...current,
        ...response.folders.filter((folder) => !current.some((item) => item.id === folder.id)),
      ]);
      setFolderPage(nextPage);
      setFolderTotal(response.totalCount);
    } finally {
      setFoldersLoadingMore(false);
    }
  };

  const canConfirm = Boolean(selectedProduct && selectedVersion && selectedFolder);
  const confirm = () => {
    if (selectedProduct && selectedVersion && selectedFolder) {
      onChange({ product: selectedProduct, productVersion: selectedVersion, kbFolder: selectedFolder });
    }
  };

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-3 pb-2 gap-1">
        <Text className="text-sm text-muted-foreground">选择产品版本后，再选择知识库文件夹</Text>
      </View>
      <FlatList
        data={folders}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(folder) => folder.id}
        onEndReached={loadMoreFolders}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View className="px-3">
            {productsQuery.isLoading ? (
              <ActivityIndicator className="py-4" />
            ) : (
              filteredProducts.map((product) => (
                <View key={product.id}>
                  <Pressable
                    onPress={() => chooseProduct(product)}
                    className="flex-row items-center gap-2 rounded-lg px-3 py-2.5 active:bg-secondary"
                  >
                    <Ionicons
                      name={selectedProductId === product.id ? "chevron-down" : "chevron-forward"}
                      size={16}
                      color={checkColor}
                    />
                    <Ionicons name="cube-outline" size={18} color={checkColor} />
                    <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                      {product.name}
                    </Text>
                    {selectedProductId === product.id ? (
                      <Ionicons name="checkmark" size={18} color={checkColor} />
                    ) : null}
                  </Pressable>
                  {selectedProductId === product.id ? (
                    <View className="ml-6 border-l border-border pl-2">
                      {versionsQuery.isLoading ? (
                        <ActivityIndicator className="py-2" />
                      ) : versions.length === 0 ? (
                        <Text className="px-3 py-2 text-sm text-muted-foreground">暂无版本</Text>
                      ) : (
                        versions.map((version) => (
                          <Pressable
                            key={version.id}
                            onPress={() => chooseVersion(version)}
                            className="flex-row items-center gap-2 rounded-lg px-3 py-2 active:bg-secondary"
                          >
                            <Ionicons name="folder-outline" size={16} color={checkColor} />
                            <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
                              {version.name}
                            </Text>
                            {selectedVersionId === version.id ? (
                              <Ionicons name="checkmark" size={18} color={checkColor} />
                            ) : null}
                          </Pressable>
                        ))
                      )}
                    </View>
                  ) : null}
                </View>
              ))
            )}
            <View className="mt-2 border-t border-border px-1 py-3">
              <Text className="text-sm font-medium text-foreground">
                {selectedVersion ? `${selectedVersion.name} 的子文件夹` : "请选择产品版本"}
              </Text>
            </View>
            {selectedVersion && !selectedVersion.folder_id ? (
              <Text className="px-2 pb-3 text-sm text-muted-foreground">该版本未配置知识库文件夹</Text>
            ) : null}
            {selectedVersion && foldersLoading ? <ActivityIndicator className="py-5" /> : null}
            {selectedVersion && !foldersLoading && folders.length === 0 ? (
              <Text className="px-2 pb-3 text-sm text-muted-foreground">暂无可用子文件夹</Text>
            ) : null}
          </View>
        }
        renderItem={({ item: folder }) => (
          <Pressable
            onPress={() => setSelectedFolder(folder)}
            className={`mx-3 flex-row items-center gap-3 border-b border-border px-3 py-3 active:bg-secondary ${selectedFolder?.id === folder.id ? "bg-primary/10" : ""}`}
          >
            <Ionicons name="folder-open-outline" size={18} color={checkColor} />
            <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
              {folder.name}
            </Text>
            <Text className="text-xs text-muted-foreground">{folder.id}</Text>
            {selectedFolder?.id === folder.id ? <Ionicons name="checkmark" size={20} color={checkColor} /> : null}
          </Pressable>
        )}
        ListFooterComponent={foldersLoadingMore ? <ActivityIndicator className="py-3" /> : null}
      />
      <View className="border-t border-border px-4 py-3">
        <Button disabled={!canConfirm} onPress={confirm}>
          <Text>确定</Text>
        </Button>
      </View>
    </View>
  );
}
