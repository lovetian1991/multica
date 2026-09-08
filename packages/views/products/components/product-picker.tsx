"use client";

import { useState, type ReactElement } from "react";
import { Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { productListOptions } from "@multica/core/products/queries";
import type { UpdateIssueRequest } from "@multica/core/types";
import {
  PropertyPicker,
  PickerItem,
  PickerEmpty,
  PICKER_TRIGGER_CLASS,
} from "../../issues/components/pickers/property-picker";
import { matchesPinyin } from "../../editor/extensions/pinyin-match";
import { useT } from "../../i18n";

export function ProductPicker({
  productId,
  onUpdate,
  triggerRender,
  align = "start",
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  disabled = false,
}: {
  productId: string | null;
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
  triggerRender?: ReactElement;
  align?: "start" | "center" | "end";
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useT("issues");
  const { data: products = [] } = useQuery(productListOptions());
  const current = products.find((product) => product.id === productId);
  const [filter, setFilter] = useState("");
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = disabled ? false : controlledOpen ?? internalOpen;
  const setOpen = disabled ? () => {} : onOpenChange ?? setInternalOpen;
  const query = filter.trim().toLowerCase();
  const filtered = products.filter(
    (product) =>
      product.name.toLowerCase().includes(query) ||
      matchesPinyin(product.name, query),
  );

  return (
    <div className="inline-flex min-w-0">
      <PropertyPicker
        open={open}
        onOpenChange={setOpen}
        width="w-60"
        align={align}
        searchable
        searchPlaceholder={t(($) => $.pickers.product.search_placeholder)}
        onSearchChange={setFilter}
        triggerRender={
          triggerRender ?? (
            <button type="button" disabled={disabled} className={PICKER_TRIGGER_CLASS} />
          )
        }
        trigger={
          current ? (
            <>
              <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{current.name}</span>
            </>
          ) : (
            <>
              <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{t(($) => $.pickers.product.no_product)}</span>
            </>
          )
        }
      >
        <PickerItem
          emptyValue
          selected={!productId}
          onClick={() => {
            onUpdate({ product_id: null });
            setOpen(false);
          }}
        >
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{t(($) => $.pickers.product.no_product)}</span>
        </PickerItem>

        {filtered.map((product) => (
          <PickerItem
            key={product.id}
            selected={product.id === productId}
            onClick={() => {
              onUpdate({ product_id: product.id });
              setOpen(false);
            }}
          >
            <Package className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">{product.name}</span>
          </PickerItem>
        ))}

        {products.length === 0 && (
          <div className="px-2 py-1.5 text-caption text-muted-foreground">
            {t(($) => $.pickers.product.empty)}
          </div>
        )}
        {products.length > 0 && filtered.length === 0 && query && <PickerEmpty />}
      </PropertyPicker>
    </div>
  );
}
