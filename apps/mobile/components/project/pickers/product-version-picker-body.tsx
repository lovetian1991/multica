/**
 * Product + version picker for project create/detail. Projects bind to a
 * product version only — knowledge-base folders stay on the issue picker.
 *
 * Drill-down matches web `ProjectProductVersionPicker`: product list, then
 * enabled versions, plus a none row to clear the binding.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useColorScheme } from "nativewind";
import type { Product, ProductVersion } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import {
  productListOptions,
  productVersionListOptions,
} from "@/data/queries/products";
import { THEME } from "@/lib/theme";

type Row =
  | { kind: "none" }
  | { kind: "back" }
  | { kind: "product"; product: Product }
  | { kind: "version"; version: ProductVersion }
  | { kind: "empty"; message: string };

interface Props {
  productId?: string | null;
  productVersionId?: string | null;
  query: string;
  onChange: (
    next: { product: Product; productVersion: ProductVersion } | null,
  ) => void;
}

const EMPTY_PRODUCTS: Product[] = [];

export function ProductVersionPickerBody({
  productId,
  productVersionId,
  query,
  onChange,
}: Props) {
  const { colorScheme } = useColorScheme();
  const theme = colorScheme === "dark" ? THEME.dark : THEME.light;
  const checkColor = theme.primary;
  const [drillProductId, setDrillProductId] = useState<string | null>(null);

  const productsQuery = useQuery(productListOptions());
  const products = productsQuery.data ?? EMPTY_PRODUCTS;
  const versionsQuery = useQuery(productVersionListOptions(drillProductId));
  const versions = (versionsQuery.data ?? []).filter(
    (version) => version.enabled || version.id === productVersionId,
  );

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (name: string) => !q || name.toLowerCase().includes(q);

    if (drillProductId) {
      if (versionsQuery.isLoading) return [{ kind: "back" }];
      const versionRows: Row[] = versions
        .filter((version) => match(version.name))
        .map((version) => ({ kind: "version" as const, version }));
      if (versions.length === 0) {
        return [
          { kind: "back" },
          { kind: "empty", message: "暂无可用版本" },
        ];
      }
      if (versionRows.length === 0) {
        return [{ kind: "back" }, { kind: "empty", message: "没有匹配的版本" }];
      }
      return [{ kind: "back" }, ...versionRows];
    }

    const productRows: Row[] = products
      .filter((product) => match(product.name))
      .map((product) => ({ kind: "product" as const, product }));
    if (productsQuery.isLoading) return [];
    if (products.length === 0) {
      return [
        { kind: "none" },
        { kind: "empty", message: "暂无产品" },
      ];
    }
    if (q) return productRows;
    return [{ kind: "none" }, ...productRows];
  }, [
    drillProductId,
    products,
    productsQuery.isLoading,
    query,
    versions,
    versionsQuery.isLoading,
  ]);

  const isSelected = (row: Row) => {
    if (row.kind === "none") return !productId;
    if (row.kind === "product") return row.product.id === productId;
    if (row.kind === "version") return row.version.id === productVersionId;
    return false;
  };

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-3 pb-2">
        <Text className="text-sm text-muted-foreground">
          {drillProductId ? "选择一个已启用的版本" : "先选产品，再选版本"}
        </Text>
      </View>
      {productsQuery.isLoading && !drillProductId ? (
        <ActivityIndicator className="py-8" />
      ) : (
        <FlatList
          data={rows}
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(row, index) => {
            if (row.kind === "none") return "none";
            if (row.kind === "back") return "back";
            if (row.kind === "empty") return `empty:${index}`;
            if (row.kind === "product") return `p:${row.product.id}`;
            return `v:${row.version.id}`;
          }}
          ListFooterComponent={
            drillProductId && versionsQuery.isLoading ? (
              <ActivityIndicator className="py-4" />
            ) : null
          }
          renderItem={({ item }) => {
            if (item.kind === "empty") {
              return (
                <Text className="px-5 py-3 text-sm text-muted-foreground">
                  {item.message}
                </Text>
              );
            }
            if (item.kind === "back") {
              return (
                <Pressable
                  onPress={() => setDrillProductId(null)}
                  className="flex-row items-center gap-3 rounded-lg px-4 py-3 active:bg-secondary"
                >
                  <Ionicons
                    name="chevron-back"
                    size={18}
                    color={checkColor}
                  />
                  <Text className="flex-1 text-base text-foreground">返回</Text>
                </Pressable>
              );
            }
            const selected = isSelected(item);
            return (
              <Pressable
                onPress={() => {
                  if (item.kind === "none") {
                    onChange(null);
                    return;
                  }
                  if (item.kind === "product") {
                    setDrillProductId(item.product.id);
                    return;
                  }
                  const product =
                    products.find((p) => p.id === item.version.product_id) ??
                    products.find((p) => p.id === drillProductId);
                  if (!product) return;
                  onChange({ product, productVersion: item.version });
                }}
                className="flex-row items-center gap-3 rounded-lg px-4 py-3 active:bg-secondary"
              >
                <Ionicons
                  name={item.kind === "none" ? "remove-circle-outline" : "cube-outline"}
                  size={18}
                  color={checkColor}
                />
                <Text
                  className={
                    item.kind === "none"
                      ? "flex-1 text-base text-muted-foreground"
                      : "flex-1 text-base text-foreground"
                  }
                  numberOfLines={1}
                >
                  {item.kind === "none"
                    ? "未绑定"
                    : item.kind === "product"
                      ? item.product.name
                      : item.version.name}
                </Text>
                {item.kind === "product" ? (
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={theme.mutedForeground}
                  />
                ) : null}
                {selected ? (
                  <Ionicons name="checkmark" size={20} color={checkColor} />
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
