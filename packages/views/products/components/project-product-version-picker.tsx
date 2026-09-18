"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { productListOptions } from "@multica/core/products/queries";
import type { Product, ProductVersion } from "@multica/core/types";
import {
  PropertyPicker,
  PickerItem,
  PickerEmpty,
  PICKER_TRIGGER_CLASS,
} from "../../issues/components/pickers/property-picker";
import { matchesPinyin } from "../../editor/extensions/pinyin-match";
import { useT } from "../../i18n";

export function ProjectProductVersionPicker({
  productId,
  productVersionId,
  onChange,
  renderTrigger,
  align = "start",
  disabled = false,
}: {
  productId: string | null;
  productVersionId: string | null;
  onChange: (next: { product_id: string | null; product_version_id: string | null }) => void;
  renderTrigger?: (state: { label: string; hasValue: boolean }) => ReactNode;
  align?: "start" | "center" | "end";
  disabled?: boolean;
}) {
  const { t } = useT("projects");
  const { data: products = [] } = useQuery(productListOptions());
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [drillProductId, setDrillProductId] = useState<string | null>(null);

  const currentProduct = products.find((product) => product.id === productId) ?? null;
  const { data: currentVersions = [] } = useQuery({
    queryKey: ["product-versions", productId, "workspace"],
    queryFn: () => api.listProductVersions(productId as string),
    enabled: Boolean(productId),
    select: (data) => data.versions.filter((version) => version.enabled),
  });
  const currentVersion = currentVersions.find((version) => version.id === productVersionId) ?? null;

  const { data: drillVersions = [], isLoading: versionsLoading } = useQuery({
    queryKey: ["product-versions", drillProductId, "workspace"],
    queryFn: () => api.listProductVersions(drillProductId as string),
    enabled: Boolean(open && drillProductId),
    select: (data) => data.versions.filter((version) => version.enabled),
  });

  const query = filter.trim().toLowerCase();
  const filteredProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          product.name.toLowerCase().includes(query) || matchesPinyin(product.name, query),
      ),
    [products, query],
  );
  const filteredVersions = useMemo(
    () =>
      drillVersions.filter(
        (version) =>
          version.name.toLowerCase().includes(query) || matchesPinyin(version.name, query),
      ),
    [drillVersions, query],
  );

  const hasValue = Boolean(productId && productVersionId);
  const label = hasValue
    ? [currentProduct?.name, currentVersion?.name].filter(Boolean).join(" / ") || t(($) => $.product.bound)
    : t(($) => $.product.none);

  const close = () => {
    setOpen(false);
    setFilter("");
    setDrillProductId(null);
  };

  const chooseProduct = (product: Product) => {
    setDrillProductId(product.id);
    setFilter("");
  };

  const chooseVersion = (version: ProductVersion) => {
    onChange({ product_id: version.product_id, product_version_id: version.id });
    close();
  };

  return (
    <div className="inline-flex min-w-0">
      <PropertyPicker
        open={disabled ? false : open}
        onOpenChange={(next) => {
          if (disabled) return;
          setOpen(next);
          if (!next) {
            setFilter("");
            setDrillProductId(null);
          }
        }}
        width="w-60"
        align={align}
        searchable
        searchPlaceholder={
          drillProductId
            ? t(($) => $.product.search_version)
            : t(($) => $.product.search)
        }
        onSearchChange={setFilter}
        triggerRender={
          renderTrigger ? (
            <>{renderTrigger({ label, hasValue })}</>
          ) : (
            <button type="button" disabled={disabled} className={PICKER_TRIGGER_CLASS} />
          )
        }
        trigger={
          <>
            <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </>
        }
      >
        {drillProductId ? (
          <>
            <PickerItem
              selected={false}
              onClick={() => {
                setDrillProductId(null);
                setFilter("");
              }}
            >
              <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t(($) => $.product.back)}</span>
            </PickerItem>
            {versionsLoading ? (
              <div className="px-2 py-1.5 text-caption text-muted-foreground">
                {t(($) => $.product.loading_versions)}
              </div>
            ) : (
              filteredVersions.map((version) => (
                <PickerItem
                  key={version.id}
                  selected={version.id === productVersionId}
                  onClick={() => chooseVersion(version)}
                >
                  <Package className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{version.name}</span>
                </PickerItem>
              ))
            )}
            {!versionsLoading && drillVersions.length === 0 && (
              <div className="px-2 py-1.5 text-caption text-muted-foreground">
                {t(($) => $.product.no_versions)}
              </div>
            )}
            {!versionsLoading && drillVersions.length > 0 && filteredVersions.length === 0 && query && (
              <PickerEmpty />
            )}
          </>
        ) : (
          <>
            <PickerItem
              emptyValue
              selected={!productId}
              onClick={() => {
                onChange({ product_id: null, product_version_id: null });
                close();
              }}
            >
              <Package className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{t(($) => $.product.none)}</span>
            </PickerItem>
            {filteredProducts.map((product) => (
              <PickerItem
                key={product.id}
                selected={product.id === productId}
                onClick={() => chooseProduct(product)}
              >
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">{product.name}</span>
              </PickerItem>
            ))}
            {products.length === 0 && (
              <div className="px-2 py-1.5 text-caption text-muted-foreground">
                {t(($) => $.product.empty)}
              </div>
            )}
            {products.length > 0 && filteredProducts.length === 0 && query && <PickerEmpty />}
          </>
        )}
      </PropertyPicker>
    </div>
  );
}
