"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { useCreateSystemProduct } from "@multica/core/system-products";
import { useCreateProductVersion } from "@multica/core/product-versions";
import type { Product, ProductVersion } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@multica/ui/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@multica/ui/components/ui/tooltip";
import { Plus, Search, Trash2, Package } from "@multica/ui/icons";
import { useT } from "../i18n";
import { OrderField, OrderSelect } from "./controls";
import { ProductVersionPickerDialog } from "./product-version-picker";

export function useDependencyChoices() {
  return useQuery({
    queryKey: ["work-order-dependency-choices"],
    // The catalog is edited from system management, whose mutations do not
    // invalidate this view-level key; override the client-wide
    // `staleTime: Infinity` so opening the picker reads the current catalog.
    staleTime: 0,
    queryFn: async () => {
      const products = await api.listSystemProducts();
      return Promise.all(products.products.map(async (p) => ({
        ...p, versions: (await api.listSystemProductVersions(p.id)).versions,
      })));
    },
  });
}

export function DependencyEditor({ productId, dependencies, onChange, onEditVersion, disabled }: {
  productId: string; dependencies: string[]; onChange: (ids: string[]) => void;
  onEditVersion: (version: ProductVersion) => void; disabled: boolean;
}) {
  const { t } = useT("settings");
  const choices = useDependencyChoices();
  const [adding, setAdding] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingProductId, setPendingProductId] = useState("");
  const [catalogEditor, setCatalogEditor] = useState<"product" | "version" | null>(null);
  const products = choices.data?.filter((p) => p.id !== productId) ?? [];
  const selected = products.filter((p) => p.versions.some((v) => dependencies.includes(v.id)));
  const available = products.filter((p) => !selected.some((s) => s.id === p.id));
  const pendingProduct = available.find((p) => p.id === pendingProductId);
  const unresolved = dependencies.filter((id) => !products.some((p) => p.versions.some((v) => v.id === id)));
  const select = (product: typeof products[number], id: string) =>
    onChange([...dependencies.filter((v) => !product.versions.some((version) => version.id === v)), ...(id ? [id] : [])]);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-body font-semibold">{t(($) => $.work_orders.dependencies)}</h2>
      <Button variant="outline" disabled={disabled || adding || choices.isLoading || !!choices.error} onClick={() => setAdding(true)}>
        <Plus className="size-4" />{t(($) => $.work_orders.add_dependency)}
      </Button>
    </div>
    {choices.error && <p role="alert" className="text-body text-destructive">{t(($) => $.work_orders.failed)}</p>}
    {choices.isLoading && <p className="text-body text-muted-foreground">{t(($) => $.work_orders.loading)}</p>}
    {!choices.isLoading && !choices.error && dependencies.length === 0 && <p className="text-body text-muted-foreground">{t(($) => $.work_orders.no_dependencies)}</p>}
    {selected.map((p) => {
      const version = p.versions.find((v) => dependencies.includes(v.id))!;
      return <section key={p.id} className="grid min-w-0 gap-3 border-b border-surface-border pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0 self-center text-body"><p className="break-words font-medium">{p.name}</p><p className="break-all font-mono text-caption text-muted-foreground">{p.slug}</p></div>
        <OrderSelect label={`${p.name} / ${t(($) => $.work_orders.version)}`} empty={t(($) => $.work_orders.no_dependency)} value={version.id} disabled={disabled}
          options={p.versions.filter((v) => v.enabled || v.id === version.id).map((v) => ({ value: v.id, label: v.name }))}
          onChange={(id) => select(p, id)} />
        <div className="flex items-end gap-1">
          <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`${p.name} / ${t(($) => $.work_orders.code)}`} onClick={() => onEditVersion(version)} />}><Package className="size-4" /></TooltipTrigger><TooltipContent>{t(($) => $.work_orders.code)}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`${p.name} / ${t(($) => $.work_orders.remove_dependency)}`} onClick={() => select(p, "")} />}><Trash2 className="size-4" /></TooltipTrigger><TooltipContent>{t(($) => $.work_orders.remove_dependency)}</TooltipContent></Tooltip>
        </div>
      </section>;
    })}
    {adding && <section className="space-y-3 border-b border-surface-border pb-4">
      {available.length === 0 && <p className="text-body text-muted-foreground">{t(($) => $.work_orders.no_dependency_products)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={disabled || choices.isLoading || available.length === 0} onClick={() => setPickerOpen(true)}>
          <Search className="size-4" />{t(($) => $.work_orders.select_product_version)}
        </Button>
        <Button variant="outline" disabled={disabled} onClick={() => setCatalogEditor("product")}><Plus className="size-4" />{t(($) => $.products.new_product)}</Button>
        <Button variant="ghost" disabled={disabled} onClick={() => { setAdding(false); setPendingProductId(""); }}>{t(($) => $.work_orders.cancel)}</Button>
      </div>
    </section>}
    {pickerOpen && <ProductVersionPickerDialog
      products={available.map((p) => ({
        id: p.id, name: p.name, slug: p.slug,
        versions: p.versions.filter((v) => v.enabled).map((v) => ({ id: v.id, name: v.name })),
      }))}
      title={t(($) => $.work_orders.select_product_version)}
      onCreateVersion={(id) => { setPendingProductId(id); setPickerOpen(false); setCatalogEditor("version"); }}
      onSelect={(id, versionId) => {
        const product = available.find((p) => p.id === id);
        if (!product) return;
        select(product, versionId);
        setAdding(false);
        setPendingProductId("");
        setPickerOpen(false);
      }}
      onClose={() => setPickerOpen(false)} />}
    {!choices.isLoading && !choices.error && unresolved.map((id) => <div key={id} role="alert" className="flex min-w-0 items-center gap-2 text-body text-destructive">
      <span className="min-w-0 break-all">{t(($) => $.work_orders.unavailable_dependency, { id })}</span>
      <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={t(($) => $.work_orders.remove_dependency)} onClick={() => onChange(dependencies.filter((v) => v !== id))}><Trash2 className="size-4" /></Button>
    </div>)}
    {catalogEditor && <DependencyCatalogDialog product={catalogEditor === "version" ? pendingProduct : undefined} onClose={() => setCatalogEditor(null)}
      onCreated={(id) => {
        if (catalogEditor === "product") setPendingProductId(id);
        else { onChange([...dependencies, id]); setAdding(false); setPendingProductId(""); }
        setCatalogEditor(null);
      }} />}
  </section>;
}

function DependencyCatalogDialog({ product, onClose, onCreated }: {
  product?: Product; onClose: () => void; onCreated: (id: string) => void;
}) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const createProduct = useCreateSystemProduct();
  const createVersion = useCreateProductVersion(product?.id ?? "");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState(false);
  const saving = createProduct.isPending || createVersion.isPending;
  const submit = async () => {
    setError(false);
    try {
      const result = product ? await createVersion.mutateAsync({ name: name.trim(), enabled: true }) : await createProduct.mutateAsync({ name: name.trim(), slug });
      await qc.invalidateQueries({ queryKey: ["work-order-dependency-choices"] });
      await qc.invalidateQueries({ queryKey: ["work-order-version-choices"] });
      onCreated(result.id);
    } catch { setError(true); }
  };
  return <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
    <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
      <form onSubmit={(e) => { e.preventDefault(); if (!saving) void submit(); }}>
        <DialogHeader><DialogTitle>{product ? `${product.name} / ${t(($) => $.products.version_editor.create_title)}` : t(($) => $.products.product_editor.create_title)}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-5">
          <OrderField label={product ? t(($) => $.products.version_editor.name) : t(($) => $.products.product_editor.name)}>
            <Input autoFocus required maxLength={128} value={name} disabled={saving} onChange={(e) => setName(e.target.value)} />
          </OrderField>
          {!product && <OrderField label={t(($) => $.work_orders.product_slug)}><Input required maxLength={64} pattern="[a-z][a-z0-9_-]{0,63}" value={slug} disabled={saving} onChange={(e) => setSlug(e.target.value.trim().toLowerCase())} /></OrderField>}
          {error && <p role="alert" className="text-body text-destructive">{t(($) => $.products.save_failed)}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t(($) => $.work_orders.cancel)}</Button>
          <Button type="submit" aria-busy={saving} disabled={saving || !name.trim() || (!product && !/^[a-z][a-z0-9_-]{0,63}$/.test(slug))}><Plus className="size-4" />{t(($) => $.work_orders.save)}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
